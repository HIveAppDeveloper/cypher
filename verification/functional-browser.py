"""Fresh workspace through actual Next proxy/API/SQLite/worker with fake inference.

Use the backend Python environment after `npm run build` in frontend/.
The build is copied into a private temporary snapshot; no build or app source is
changed here. Every credential is a fixed synthetic test-only value.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORKSPACE = REPO.parent
OUT = WORKSPACE / 'verification/grokbot-ux-functional'
SECRET = 'functional-fixture-only-session-key-00000000000000'
TOKEN = 'functional-fixture-only-backend-service-token'
OWNER = 'synthetic-functional-owner'
RESULT = {'status': 'running', 'cases': {}, 'scope': 'Actual Next production cookie/API proxy, FastAPI, temporary SQLite, queue/journal/worker; controlled provider responses only.',
          'limits': ['No real provider response, model charge, Google/email sign-in, external account, hosted database or production workflow is verified.',
                     'Synthetic locally signed sessions test the existing session verifier and forwarding; they are not proof of live OAuth/email configuration.',
                     'Transport-loss scenarios intentionally discard successful responses after the actual API/database write.',
                     'Desktop/mobile Chromium software checks do not establish Safari, native mobile or production visual acceptance.']}


def environment():
    keep = {'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'PLAYWRIGHT_BROWSERS_PATH'}
    result = {key: value for key, value in os.environ.items() if key in keep}
    result.update({'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1',
                   'NODE_OPTIONS': '--require=' + str(HERE / 'creation-loopback-only.cjs'),
                   'LITELLM_LOCAL_MODEL_COST_MAP': 'True', 'RUN_EMBEDDED_WORKER': 'false',
                   'REQUIRE_USER_AUTH': 'true', 'AUTH_SESSION_SECRET': SECRET,
                   'BACKEND_API_TOKEN': TOKEN, 'GROKBOT_BACKEND_API_TOKEN': TOKEN,
                   'GROKBOT_ATLAS_ENGINE_ENABLED': 'false', 'REDIS_URL': '', 'LLM_USE_GATEWAY': 'false',
                   'FUNCTIONAL_REPO': str(REPO), 'SANDBOX_BACKEND': 'vercel', 'PYTHONDONTWRITEBYTECODE': '1'})
    return result


def cookie(tenant):
    raw = json.dumps({'sub': tenant, 'email': tenant + '@example.test', 'exp': int(time.time()) + 3600}, separators=(',', ':')).encode()
    payload = base64.urlsafe_b64encode(raw).rstrip(b'=')
    signature = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload, hashlib.sha256).digest()).rstrip(b'=')
    return (payload + b'.' + signature).decode()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def read_json(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read())


async def ready(url, child):
    for _ in range(200):
        if child.poll() is not None:
            raise RuntimeError('Synthetic server exited before readiness')
        try:
            await asyncio.to_thread(urllib.request.urlopen, url, timeout=1)
            return
        except Exception:
            await asyncio.sleep(.1)
    raise TimeoutError('Synthetic server readiness timed out')


async def backend_state(backend):
    return await asyncio.to_thread(read_json, backend + '/__functional/state')


async def until_state(backend, predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = await backend_state(backend)
        if predicate(value):
            return value
        await asyncio.sleep(.03)
    raise AssertionError('Synthetic backend state did not reach the requested condition')


async def context(browser, origin, tenant=None, mobile=False):
    result = await browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000},
                                       is_mobile=mobile, has_touch=mobile, service_workers='block')
    async def guarded(route):
        if route.request.url.startswith(origin + '/'):
            await route.continue_()
        else:
            RESULT.setdefault('blockedExternalRequests', []).append(route.request.url.split('?')[0])
            await route.abort('blockedbyclient')
    await result.route('**/*', guarded)
    if tenant:
        await result.add_cookies([{'name': 'grokbot_session', 'value': cookie(tenant), 'url': origin, 'httpOnly': True, 'sameSite': 'Lax'}])
    return result


async def send(page, text):
    await page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).fill(text)
    async with page.expect_response(lambda response: response.url.endswith('/messages') and response.request.method == 'POST') as pending:
        await page.get_by_role('button', name='Send message', exact=True).click()
    response = await pending.value
    assert response.status == 202, await response.text()
    return (await response.json())['task_id']


async def reply_visible(page, text):
    await page.get_by_text('Controlled local response: ' + text, exact=True).wait_for(timeout=20000)


async def run_cases(browser, origin, backend):
    contexts = []
    try:
        unsigned = await context(browser, origin)
        contexts.append(unsigned)
        page = await unsigned.new_page()
        await page.goto(origin)
        await page.get_by_role('heading', name='Welcome to GrokBot').wait_for()
        assert (await unsigned.request.get(origin + '/api/bots')).status == 401
        RESULT['cases']['unsigned-gate'] = {'workspaceRedirectsToLogin': True, 'protectedApiStatus': 401}

        owner = await context(browser, origin, OWNER)
        contexts.append(owner)
        page = await owner.new_page()
        await page.goto(origin)
        await page.get_by_role('heading', name='What would you like to get done?').wait_for()
        assert await (await owner.request.get(origin + '/api/bots')).json() == []
        assert await (await owner.request.get(origin + '/api/conversations')).json() == []
        RESULT['cases']['fresh-workspace'] = {'agents': 0, 'conversations': 0, 'newTaskVisible': True}

        # The server really creates the first agent; only its successful response
        # is discarded. The UI must retain the same key and recover that agent.
        lost_creation = {'remaining': 1}
        async def create_transport(route):
            if route.request.method == 'POST' and lost_creation['remaining']:
                lost_creation['remaining'] -= 1
                response = await route.fetch()
                assert response.status == 200
                await route.abort('failed')
            else:
                await route.fallback()
        await owner.route('**/api/bots', create_transport)
        await page.get_by_role('button', name='Create agent', exact=True).click()
        dialog = page.get_by_role('dialog', name='Meet your next agent.')
        await dialog.get_by_label('Name optional').fill('Synthetic Workflow Agent')
        await dialog.get_by_text('Customize this agent', exact=True).click()
        for name in ('Browse websites', 'Run code', 'Work with files', 'Generate images & video', 'Use connected plugins'):
            await dialog.get_by_role('checkbox', name=name, exact=True).uncheck()
        await dialog.get_by_role('button', name='Create agent', exact=True).click()
        await dialog.get_by_role('alert').wait_for()
        first = await until_state(backend, lambda value: len(value['bots']) == 1)
        assert await dialog.get_by_label('Name optional').input_value() == 'Synthetic Workflow Agent'
        await dialog.get_by_role('button', name='Create agent', exact=True).click()
        await dialog.wait_for(state='hidden')
        await page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).wait_for()
        created = await until_state(backend, lambda value: len([p for p in value['posts'] if p['path'] == '/api/bots']) == 2 and len(value['rooms']) == 1)
        records = [p for p in created['posts'] if p['path'] == '/api/bots']
        assert len(created['bots']) == 1 and records[0]['body'] == records[1]['body']
        assert records[0]['body']['client_request_id'] and records[0]['body']['tools_enabled'] == ['none']
        bot_id, room_id = created['bots'][0]['id'], created['rooms'][0]['id']
        RESULT['cases']['create-lost-response-recovery'] = {'postCount': 2, 'persistedAgents': 1, 'sameRequestKeyAndPayload': True, 'nativeDialogRecovered': True}

        await page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).fill('Synthetic saved conversation draft.')
        await page.get_by_role('button', name='New task', exact=True).click()
        await page.get_by_role('textbox', name='Your task', exact=True).fill('Synthetic saved home task draft.')
        await page.get_by_role('button', name='Synthetic Workflow Agent', exact=True).click()
        assert await page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).input_value() == 'Synthetic saved conversation draft.'
        await page.get_by_role('button', name='New task', exact=True).click()
        assert await page.get_by_role('textbox', name='Your task', exact=True).input_value() == 'Synthetic saved home task draft.'
        await page.get_by_role('button', name='Synthetic Workflow Agent', exact=True).click()
        RESULT['cases']['draft-navigation'] = {'conversationDraftRestored': True, 'homeTaskDraftRestored': True}

        tools = page.get_by_role('button', name='Tools on', exact=True)
        if await tools.count():
            await tools.click()
        first_text = 'fixture:reply First controlled turn.'
        before = time.monotonic()
        first_task = await send(page, first_text)
        await reply_visible(page, first_text)
        initial = await until_state(backend, lambda value: any(t['id'] == first_task and t['status'] == 'completed' for t in value['tasks']))
        RESULT['cases']['actual-worker-reply'] = {'taskCompleted': True, 'renderedReply': True, 'localRenderedMilliseconds': round((time.monotonic() - before) * 1000), 'providerCalls': len(initial['calls'])}

        hold_text = 'fixture:hold Pause this controlled turn.'
        held_task = await send(page, hold_text)
        await until_state(backend, lambda value: value['active'] == 1 and any(t['id'] == held_task and t['status'] == 'running' for t in value['tasks']))
        await page.get_by_role('button', name='Stop', exact=True).wait_for()
        before_stop = time.monotonic()
        await page.get_by_role('button', name='Stop', exact=True).click()
        stopped = await until_state(backend, lambda value: any(t['id'] == held_task and t['status'] == 'cancelled' for t in value['tasks']))
        assert stopped['providerCancelled'] == 1 and stopped['active'] == 0
        assert next(b['status'] for b in stopped['bots'] if b['id'] == bot_id) == 'idle'
        await page.get_by_role('button', name='Stop', exact=True).wait_for(state='hidden', timeout=12000)
        RESULT['cases']['active-stop'] = {'realRunningTaskCancelled': True, 'controlledProviderCancelled': True, 'agentIdle': True, 'localCancelMilliseconds': round((time.monotonic() - before_stop) * 1000)}

        recovery_text = 'fixture:reply Recovery after Stop.'
        recovered_task = await send(page, recovery_text)
        await reply_visible(page, recovery_text)
        await until_state(backend, lambda value: any(t['id'] == recovered_task and t['status'] == 'completed' for t in value['tasks']))
        RESULT['cases']['after-stop-recovery'] = {'freshTurnCompleted': True}

        lost_text = 'fixture:reply Lost successful send response.'
        lost_send = {'remaining': 1}
        async def send_transport(route):
            body = route.request.post_data_json if route.request.method == 'POST' else {}
            if body.get('content') == lost_text and lost_send['remaining']:
                lost_send['remaining'] -= 1
                response = await route.fetch()
                assert response.status == 202
                await route.abort('failed')
            else:
                await route.fallback()
        await owner.route('**/api/conversations/*/messages', send_transport)
        await page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).fill(lost_text)
        await page.get_by_role('button', name='Send message', exact=True).click()
        await page.get_by_role('alert').filter(has_text='Message was not confirmed.').wait_for()
        assert await page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).input_value() == lost_text
        await page.get_by_role('button', name='Send message', exact=True).click()
        await reply_visible(page, lost_text)
        dedup = await until_state(backend, lambda value: len([p for p in value['posts'] if p['path'].endswith('/messages') and (p['body'] or {}).get('content') == lost_text]) == 2)
        posted = [p for p in dedup['posts'] if p['path'].endswith('/messages') and (p['body'] or {}).get('content') == lost_text]
        assert posted[0]['body']['client_message_id'] == posted[1]['body']['client_message_id']
        assert len([m for m in dedup['messages'] if m['sender'] == 'user' and m['content'] == lost_text]) == 1
        assert len([t for t in dedup['tasks'] if t['description'] == lost_text]) == 1
        assert len([c for c in dedup['calls'] if c['text'] == lost_text]) == 1
        RESULT['cases']['lost-send-retry'] = {'sameClientMessageId': True, 'posts': 2, 'userMessages': 1, 'tasks': 1, 'providerCalls': 1}

        error_text = 'fixture:auth-error Controlled provider failure.'
        error_task = await send(page, error_text)
        await until_state(backend, lambda value: any(t['id'] == error_task and t['status'] == 'failed' for t in value['tasks']))
        await page.get_by_text('Error reference:', exact=False).wait_for(timeout=15000)
        assert 'SYNTHETIC_PROVIDER_BODY_MUST_NOT_REACH_UI' not in await page.locator('body').inner_text()
        fresh_text = 'fixture:reply Recovery after controlled provider failure.'
        await send(page, fresh_text)
        await reply_visible(page, fresh_text)
        RESULT['cases']['provider-error-next-turn'] = {'failedTaskShown': True, 'rawProviderBodyHidden': True, 'freshTurnCompleted': True}

        await page.locator('input[type=file]').set_input_files({'name': 'workflow-fixture.txt', 'mimeType': 'text/plain', 'buffer': b'Synthetic staged text only.'})
        await page.get_by_role('button', name='Remove workflow-fixture.txt', exact=True).wait_for()
        await page.get_by_role('button', name='Remove workflow-fixture.txt', exact=True).click()
        assert await page.get_by_role('button', name='Remove workflow-fixture.txt', exact=True).count() == 0
        RESULT['cases']['attachment-stage-remove'] = {'staged': True, 'removed': True, 'uploadedToProvider': False}

        other = await context(browser, origin, 'synthetic-functional-other')
        contexts.append(other)
        assert await (await other.request.get(origin + '/api/bots')).json() == []
        assert await (await other.request.get(origin + '/api/conversations')).json() == []
        foreign_sync = await other.request.get(origin + '/api/conversations/' + room_id + '/sync')
        assert foreign_sync.status == 200 and await foreign_sync.json() == {'messages': [], 'tasks': []}
        assert (await other.request.get(origin + '/api/conversations/' + room_id)).status == 404
        assert (await other.request.post(origin + '/api/conversations/' + room_id + '/tasks/' + held_task + '/cancel')).status == 404
        assert await (await other.request.get(origin + '/api/bots', headers={'x-grokbot-user-id': OWNER})).json() == []
        RESULT['cases']['tenant-isolation'] = {'foreignListsEmpty': True, 'foreignConversation': 404, 'foreignSync': {'status': 200, 'messages': 0, 'tasks': 0}, 'foreignStop': 404, 'forgedBrowserTenantIgnored': True}

        mobile = await context(browser, origin, OWNER, mobile=True)
        contexts.append(mobile)
        mobile_page = await mobile.new_page()
        await mobile_page.goto(origin)
        await mobile_page.get_by_role('button', name='Open navigation', exact=True).click()
        await mobile_page.get_by_role('dialog', name='Workspace navigation').get_by_role('button', name='Synthetic Workflow Agent', exact=True).click()
        await mobile_page.get_by_role('dialog', name='Workspace navigation').wait_for(state='hidden')
        await mobile_page.get_by_role('textbox', name='Message Synthetic Workflow Agent', exact=True).wait_for()
        geometry = await mobile_page.evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})')
        assert geometry['width'] == 390 and geometry['documentWidth'] <= 390
        await mobile_page.screenshot(path=str(OUT / 'mobile-real-stack.png'), full_page=False)
        await page.screenshot(path=str(OUT / 'desktop-real-stack.png'), full_page=False)
        RESULT['cases']['mobile-navigation'] = {**geometry, 'drawerClosesAfterSelection': True, 'composerReachable': True}

        runtime = await (await owner.request.get(origin + '/api/runtime')).json()
        assert runtime['connected'] and runtime['database'] and runtime['worker']
        RESULT['cases']['local-runtime'] = {'connected': True, 'database': True, 'worker': True, 'productionClaimed': False}
        final = await backend_state(backend)
        RESULT['finalCounts'] = {'agents': len(final['bots']), 'conversations': len(final['rooms']), 'tasks': len(final['tasks']), 'providerCalls': len(final['calls']), 'activeControlledCalls': final['active']}
    finally:
        for item in contexts:
            await item.close()


async def run():
    OUT.mkdir(parents=True, exist_ok=True)
    children, logs = [], []
    with tempfile.TemporaryDirectory(prefix='grokbot-functional-') as temporary:
        temp = Path(temporary)
        try:
            frontend = temp / 'frontend'
            shutil.copytree(REPO / 'frontend', frontend, ignore=shutil.ignore_patterns('node_modules', '.next', '.env*'))
            shutil.copytree(REPO / 'frontend/.next', frontend / '.next', ignore=shutil.ignore_patterns('cache'))
            (frontend / 'node_modules').symlink_to(REPO / 'frontend/node_modules', target_is_directory=True)
            RESULT['buildId'] = (frontend / '.next/BUILD_ID').read_text().strip()
            RESULT['sourceSha256'] = {str(path.relative_to(frontend)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [
                frontend / 'src/components/QuickStart.tsx', frontend / 'src/components/ChatPanel.tsx', frontend / 'src/components/BotCreator.tsx', frontend / 'src/app/page.tsx', frontend / 'src/components/WorkspaceApp.tsx']}
            child_env = environment()
            child_env['GROKBOT_DATABASE_URL'] = 'sqlite+aiosqlite:///' + str(temp / 'functional.db')
            backend_log = open(OUT / 'backend.log', 'w')
            logs.append(backend_log)
            backend = subprocess.Popen([sys.executable, str(HERE / 'functional-fixture-server.py')], cwd=temp, env=child_env, stdout=subprocess.PIPE, stderr=backend_log, text=True)
            children.append(backend)
            line = await asyncio.wait_for(asyncio.to_thread(backend.stdout.readline), 30)
            if not line:
                raise RuntimeError('Backend startup did not return its local port')
            backend_url = 'http://127.0.0.1:' + str(json.loads(line)['port'])
            await ready(backend_url + '/health', backend)
            port = free_port()
            origin = 'http://localhost:' + str(port)
            child_env.update({'BACKEND_INTERNAL_URL': backend_url, 'GROKBOT_PUBLIC_URL': origin})
            next_log = open(OUT / 'next.log', 'w')
            logs.append(next_log)
            next_server = subprocess.Popen(['node', str(frontend / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', str(port)], cwd=frontend, env=child_env, stdout=next_log, stderr=subprocess.STDOUT)
            children.append(next_server)
            await ready(origin + '/login', next_server)
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True, args=['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-quic', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'])
                try:
                    await run_cases(browser, origin, backend_url)
                finally:
                    await browser.close()
            RESULT['status'] = 'passed'
            RESULT['passedCases'] = len(RESULT['cases'])
            print('PASS real local workflow cases: ' + str(RESULT['passedCases']), flush=True)
        except Exception as error:
            RESULT['status'], RESULT['error'] = 'failed', type(error).__name__ + ': ' + str(error)
            raise
        finally:
            for child in reversed(children):
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=5)
            RESULT['allFixtureProcessesStopped'] = all(child.poll() is not None for child in children)
            for log in logs:
                log.close()
            (HERE / 'functional-results.json').write_text(json.dumps(RESULT, ensure_ascii=False, indent=2) + '\n')
            (OUT / 'results.json').write_text(json.dumps(RESULT, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    asyncio.run(run())
