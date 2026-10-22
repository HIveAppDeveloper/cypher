"""Compare actual creation UI -> Next cookie proxy -> FastAPI -> temporary DB.

Run with the backend's Python interpreter and installed Playwright Chromium:
  CREATION_WORKSPACE=/path/to/workspace /path/to/.venv/bin/python \
    open-grokbot/verification/creation-browser.py
No production credentials, model calls, workers, or application data participate.
"""
import asyncio
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import tarfile
import time
import urllib.request

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORKSPACE = Path(os.environ.get('CREATION_WORKSPACE', REPO.parent))
OUT = WORKSPACE / 'verification'
BASELINE = os.environ.get('CREATION_BASELINE_REF', '35ca34e')
FIXED = subprocess.check_output(['git', 'rev-parse', os.environ.get('CREATION_FIXED_REF', 'HEAD')], cwd=REPO, text=True).strip()
SESSION_SECRET = 'synthetic-creation-session-secret-0000000000000000'
BACKEND_TOKEN = 'synthetic-creation-backend-proxy-token'
CREATION_FRONTEND = [
    'src/components/BotCreator.tsx', 'src/components/WorkspaceApp.tsx',
    'src/hooks/useBots.ts', 'src/lib/api.ts',
]
RESULTS = {'baselineRef': BASELINE, 'fixedCommit': FIXED,
           'scope': 'Fresh Chromium contexts, actual Next production application/cookie proxy and FastAPI routes, temporary SQLite. Only creation modules differ.',
           'variants': {}, 'limits': [
               'The original production Create Agent error remains unverified; these are confirmed local symptoms.',
               'Synthetic locally signed sessions test cookie validation and tenant forwarding, not Google/email sign-in.',
               'Concurrent-name case holds real SELECT results at a fixture barrier to guarantee the race interleaving.',
               'No hosted database, production deployment, paid model/provider, migration, or user data was used.',
               'Chromium desktop behavior does not establish Safari, mobile focus, or production screenshot acceptance.',
           ]}


def env():
    # An allowlist prevents inherited provider/database credentials from entering
    # the builds or servers. Only fixed, explicitly synthetic auth values follow.
    allowed = {'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'PLAYWRIGHT_BROWSERS_PATH'}
    result = {key: value for key, value in os.environ.items() if key in allowed}
    result.update({'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1',
                   'NODE_OPTIONS': '--require=' + str(HERE / 'creation-loopback-only.cjs'),
                   'LITELLM_LOCAL_MODEL_COST_MAP': 'True', 'RUN_EMBEDDED_WORKER': 'false',
                   'REQUIRE_USER_AUTH': 'true', 'AUTH_SESSION_SECRET': SESSION_SECRET,
                   'BACKEND_API_TOKEN': BACKEND_TOKEN, 'GROKBOT_BACKEND_API_TOKEN': BACKEND_TOKEN,
                   'SANDBOX_BACKEND': 'vercel', 'CREATION_REPO': str(REPO),
                   'GROKBOT_ATLAS_ENGINE_ENABLED': 'false', 'REDIS_URL': ''})
    return result


def cookie(user):
    data = json.dumps({'sub': user, 'email': user + '@example.test', 'exp': int(time.time()) + 3600}, separators=(',', ':')).encode()
    payload = base64.urlsafe_b64encode(data).rstrip(b'=')
    signature = base64.urlsafe_b64encode(hmac.new(SESSION_SECRET.encode(), payload, hashlib.sha256).digest()).rstrip(b'=')
    return (payload + b'.' + signature).decode()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def http(url, method='GET'):
    with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=15) as response:
        return json.loads(response.read())


async def ready(url, process):
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError('Local server exited before readiness')
        try:
            await asyncio.to_thread(urllib.request.urlopen, url, timeout=1)
            return
        except Exception:
            await asyncio.sleep(.1)
    raise RuntimeError('Local server readiness timed out')


async def browser_context(browser, origin, tenant, network):
    context = await browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
    async def loopback_only(route):
        if route.request.url.startswith(origin + '/'):
            await route.continue_()
        else:
            network.append(route.request.url.split('?')[0])
            await route.abort('blockedbyclient')
    await context.route('**/*', loopback_only)
    await context.add_cookies([{'name': 'grokbot_session', 'value': cookie(tenant), 'url': origin, 'httpOnly': True, 'sameSite': 'Lax'}])
    page = await context.new_page()
    await page.goto(origin, wait_until='networkidle')
    return context, page


async def open_creator(page):
    await page.get_by_role('button', name='Create bot', exact=True).click()
    await page.get_by_role('heading', name='Meet your next agent.').wait_for()


async def submit_response(page):
    async with page.expect_response(lambda response: response.request.method == 'POST' and response.url.endswith('/api/bots')) as result:
        await page.get_by_role('button', name='Create agent', exact=True).click()
    response = await result.value
    return response.status, await response.json()


async def settle(backend, tenant, posts=None):
    for _ in range(100):
        value = await asyncio.to_thread(http, backend + '/__creation/state')
        seen = [record for record in value['posts'] if record['tenant'] == tenant]
        if (posts is None or len(seen) >= posts) and all('status' in record for record in seen):
            return seen, [bot for bot in value['bots'] if bot['tenant'] == tenant]
        await asyncio.sleep(.05)
    raise AssertionError('Creation requests did not settle')


async def run_variant(browser, variant, origin, backend):
    network, cases = [], {}
    contexts = []
    fixed = variant == 'fixed'

    async def session(case):
        tenant = 'creation-' + variant + '-' + case
        context, page = await browser_context(browser, origin, tenant, network)
        contexts.append(context)
        return tenant, context, page

    try:
        tenant, context, page = await session('default')
        await open_creator(page)
        status, created = await submit_response(page)
        assert status == 200 and created['name'] == 'Assistant', (status, created)
        posts, bots = await settle(backend, tenant, 1)
        assert len(bots) == 1 and posts[0]['body']['role'] == 'Assistant'
        assert posts[0]['body']['llm_provider'] == 'openai' and posts[0]['body']['llm_model'] == 'gpt-6.1-sol'
        cases['defaultPreset'] = {'status': status, 'botCount': len(bots), 'requestBody': posts[0]['body'], 'observation': 'Unmodified default creation succeeds locally in both versions.'}

        tenant, context, page = await session('invalid')
        await open_creator(page)
        await page.get_by_text('Customize this agent', exact=True).click()
        await page.locator('#bot-prompt').fill('')
        await page.get_by_text('Customize this agent', exact=True).click()
        await page.evaluate("""() => { window.creationEvents = {submit:0,invalid:0}; const form=document.querySelector('form.agent-form'); form.addEventListener('submit',()=>window.creationEvents.submit++); form.addEventListener('invalid',()=>window.creationEvents.invalid++,true); }""")
        await page.get_by_role('button', name='Create agent', exact=True).click()
        await page.wait_for_timeout(150)
        detail = await page.evaluate("""() => ({...window.creationEvents, detailsOpen:document.querySelector('.advanced-settings').open, activeElement:document.activeElement.id, validationMessage:document.querySelector('#bot-prompt').validationMessage, alert:document.querySelector('.bot-dialog [role=alert]')?.textContent || ''})""")
        posts, bots = await settle(backend, tenant)
        assert not posts and not bots
        if fixed:
            assert detail['submit'] == 1 and 'Add instructions' in detail['alert'], detail
        else:
            assert detail['submit'] == 0 and detail['invalid'] >= 1 and not detail['alert'], detail
        await page.screenshot(path=str(OUT / ('creation-' + variant + '-invalid.png')))
        cases['collapsedEmptyInstructions'] = {**detail, 'postCount': 0}

        for named in [False, True]:
            label = 'lost-named' if named else 'lost-unnamed'
            tenant, context, page = await session(label)
            await open_creator(page)
            if named:
                await page.locator('#bot-name').fill('Synthetic researcher')
            intercepted = []
            async def lose_first_response(route):
                if route.request.method == 'POST' and not intercepted:
                    response = await route.fetch()
                    intercepted.append({'status': response.status, 'body': await response.json()})
                    await route.abort('failed')
                else:
                    await route.continue_()
            await page.route('**/api/bots', lose_first_response)
            await page.get_by_role('button', name='Create agent', exact=True).click()
            await page.locator('.bot-dialog [role=alert]').wait_for()
            assert intercepted and intercepted[0]['status'] == 200
            assert await page.locator('#bot-name').input_value() == ('Synthetic researcher' if named else '')
            status, replay = await submit_response(page)
            posts, bots = await settle(backend, tenant, 2)
            if fixed:
                assert status == 200 and len(bots) == 1 and replay['id'] == intercepted[0]['body']['id'], (status, bots)
                assert posts[0]['body']['client_request_id'] == posts[1]['body']['client_request_id']
            elif named:
                assert status == 409 and len(bots) == 1 and 'already in use' in replay['detail'], (status, bots)
            else:
                assert status == 200 and len(bots) == 2 and replay['id'] != intercepted[0]['body']['id'], (status, bots)
            await page.screenshot(path=str(OUT / ('creation-' + variant + '-' + label + '.png')))
            cases[label] = {'firstServerStatus': intercepted[0]['status'], 'retryStatus': status, 'botCount': len(bots), 'sameAgentId': replay.get('id') == intercepted[0]['body']['id'], 'replyDetail': replay.get('detail'), 'requestBodies': [record['body'] for record in posts]}

        tenant, context, page = await session('double')
        await open_creator(page)
        await page.eval_on_selector('form.agent-form', '(form) => { form.requestSubmit(); form.requestSubmit(); }')
        posts, bots = await settle(backend, tenant, 1 if fixed else 2)
        assert len(posts) == (1 if fixed else 2), posts
        cases['sameTickDoubleSubmit'] = {'postCount': len(posts), 'statuses': [record['status'] for record in posts], 'botCount': len(bots)}

        tenant, context, page = await session('concurrent')
        pages = [page] + [await context.new_page() for _ in range(3)]
        await asyncio.gather(*[other.goto(origin, wait_until='networkidle') for other in pages[1:]])
        await asyncio.gather(*[open_creator(other) for other in pages])
        await asyncio.to_thread(http, backend + '/__creation/race/4', 'POST')
        responses = await asyncio.gather(*[submit_response(other) for other in pages])
        posts, bots = await settle(backend, tenant, 4)
        statuses = [status for status, _ in responses]
        if fixed:
            assert statuses == [200] * 4 and len(bots) == 4 and len({bot['name'] for bot in bots}) == 4, (statuses, bots)
        else:
            assert 409 in statuses and len(bots) < 4, (statuses, bots)
        cases['concurrentOptionalNames'] = {'statuses': statuses, 'botCount': len(bots), 'names': sorted(bot['name'] for bot in bots), 'schedule': 'Four real SQLite optional-name SELECTs held until all four complete, then inserts continue.'}

        auth_context = await browser.new_context(service_workers='block')
        contexts.append(auth_context)
        unsigned = await auth_context.request.get(origin + '/api/bots')
        assert unsigned.status == 401
        tenant, context, page = await session('isolation')
        visible = await page.evaluate("""async () => { const response=await fetch('/api/bots',{headers:{'x-grokbot-user-id':'creation-""" + variant + """-default'}}); return {status:response.status,body:await response.json()}; }""")
        assert visible == {'status': 200, 'body': []}, visible
        cases['cookieAuthAndIsolation'] = {'unsignedStatus': unsigned.status, 'spoofedHeaderStatus': visible['status'], 'otherTenantVisibleCount': len(visible['body'])}
        assert not network, network
        return {'cases': cases, 'externalBrowserRequestsBlocked': network, 'passedCases': len(cases)}
    finally:
        for context in contexts:
            await context.close()


async def run():
    OUT.mkdir(parents=True, exist_ok=True)
    children, logs = [], []
    with tempfile.TemporaryDirectory(prefix='grokbot-creation-') as tmp:
        temp = Path(tmp)
        source = temp / 'source'
        source.mkdir()
        # Pin both complete application trees to one commit. Concurrent UI or
        # engine work cannot change the second half of this comparison.
        archive = subprocess.check_output(['git', 'archive', '--format=tar', FIXED, 'frontend', 'backend'], cwd=REPO)
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            files.extractall(source, filter='data')
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True, args=[
                    '--disable-background-networking', '--disable-component-update', '--disable-sync',
                    '--no-first-run', '--disable-breakpad', '--disable-quic',
                    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost',
                    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
                ])
                for variant in ['baseline', 'fixed']:
                    print('RUN actual browser creation ' + variant, flush=True)
                    variant_dir = temp / variant
                    frontend = variant_dir / 'frontend'
                    shutil.copytree(source / 'frontend', frontend, ignore=shutil.ignore_patterns('.env*'))
                    # Standalone tracing follows dependency symlinks. A local
                    # copy keeps traced artifacts inside this temporary tree.
                    shutil.copytree(REPO / 'frontend/node_modules', frontend / 'node_modules', symlinks=True)
                    child_env = env()
                    child_env['CREATION_REPO'] = str(source)
                    child_env['GROKBOT_DATABASE_URL'] = 'sqlite+aiosqlite:///' + str(variant_dir / 'fixture.db')
                    if variant == 'baseline':
                        for relative in CREATION_FRONTEND:
                            (frontend / relative).write_bytes(subprocess.check_output(['git', 'show', BASELINE + ':frontend/' + relative], cwd=REPO))
                        modules = variant_dir / 'modules'
                        for relative in ['app/api/bots.py', 'app/schemas/bot.py']:
                            path = modules / relative
                            path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_bytes(subprocess.check_output(['git', 'show', BASELINE + ':backend/' + relative], cwd=REPO))
                        child_env['CREATION_BASELINE_MODULES'] = str(modules)
                    backend_log = open(OUT / ('creation-' + variant + '-backend.log'), 'w')
                    logs.append(backend_log)
                    backend = subprocess.Popen([sys.executable, str(HERE / 'creation-fixture-server.py')], env=child_env, cwd=variant_dir, stdout=subprocess.PIPE, stderr=backend_log, text=True)
                    children.append(backend)
                    line = await asyncio.wait_for(asyncio.to_thread(backend.stdout.readline), 20)
                    backend_url = 'http://127.0.0.1:' + str(json.loads(line)['port'])
                    await ready(backend_url + '/health', backend)
                    child_env['BACKEND_INTERNAL_URL'] = backend_url
                    build_log_path = OUT / ('creation-' + variant + '-build.log')
                    with open(build_log_path, 'w') as build_log:
                        build = await asyncio.create_subprocess_exec('node', str(frontend / 'node_modules/next/dist/bin/next'), 'build', cwd=frontend, env=child_env, stdout=build_log, stderr=subprocess.STDOUT)
                        assert await asyncio.wait_for(build.wait(), 180) == 0, build_log_path.read_text()[-1500:]
                    port = free_port()
                    origin = 'http://127.0.0.1:' + str(port)
                    next_log = open(OUT / ('creation-' + variant + '-next.log'), 'w')
                    logs.append(next_log)
                    next_server = subprocess.Popen(['node', str(frontend / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', str(port)], cwd=frontend, env=child_env, stdout=next_log, stderr=subprocess.STDOUT)
                    children.append(next_server)
                    await ready(origin + '/login', next_server)
                    RESULTS['variants'][variant] = await run_variant(browser, variant, origin, backend_url)
                    RESULTS['variants'][variant]['creationSourceSha256'] = {
                        'frontend/' + path: hashlib.sha256((frontend / path).read_bytes()).hexdigest() for path in CREATION_FRONTEND
                    }
                    for path in ['app/api/bots.py', 'app/schemas/bot.py']:
                        effective = Path(child_env['CREATION_BASELINE_MODULES']) / path if variant == 'baseline' else source / 'backend' / path
                        RESULTS['variants'][variant]['creationSourceSha256']['backend/' + path] = hashlib.sha256(effective.read_bytes()).hexdigest()
                    RESULTS['variants'][variant]['productionBuild'] = 'passed'
                    RESULTS['variants'][variant]['integratedProxyBuilt'] = '/api/integrations/atlas/v1/chat' in build_log_path.read_text()
                    next_server.terminate()
                    backend.terminate()
                    await asyncio.to_thread(next_server.wait, 10)
                    await asyncio.to_thread(backend.wait, 10)
                    print('PASS actual browser creation ' + variant, flush=True)
                await browser.close()
            RESULTS['status'] = 'passed'
        except Exception as exc:
            RESULTS['status'] = 'failed'
            RESULTS['error'] = str(exc)
            raise
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=5)
            for log in logs:
                log.close()
            (OUT / 'creation-browser-results.json').write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    asyncio.run(run())
