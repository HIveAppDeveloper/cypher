"""Synthetic-only login browser -> actual Next -> FastAPI -> temporary SQLite."""
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
ROOT = Path(os.environ.get('CREATION_WORKSPACE', REPO.parent))
OUT = ROOT / 'verification'
EXPECTED_RESEND_SECONDS = int(os.environ.get('AUTH_EXPECT_RESEND_SECONDS', '60'))
RESULT_NAME = os.environ.get('AUTH_RESULTS_NAME', 'auth-browser-results.json')
spec = importlib.util.spec_from_file_location('creation_browser_helpers', HERE / 'creation-browser.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
RESULT = {'status': 'running', 'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
          'sourceMode': 'Fresh frontend working-tree snapshot with auth source hashes; actual local backend with explicit synthetic provider stubs.',
          'expectedClientResendSeconds': EXPECTED_RESEND_SECONDS, 'cases': {},
          'limits': ['No real email was sent and no Google/OAuth provider login, credential or grant was used.',
                     'Email delivery and Google credential verification are explicit synthetic stubs; Next cookie/proxy routes and backend ownership/token storage are real.',
                     'Local Chromium desktop and 390x844 mobile emulation do not establish deployed OAuth behavior, Safari, or a real device/software keyboard.',
                     'returnTo is currently ignored by both callbacks; successful login returns to /. This does not verify deep-link restoration.',
                     'No hosted database, production deployment, application worker, paid model, user-data migration, or external message was used.']}


def http(url, method='GET', data=None):
    raw = json.dumps(data).encode() if data is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, method=method, data=raw, headers={'Content-Type': 'application/json'}), timeout=15) as response:
        return json.loads(response.read())


async def state(backend):
    return await asyncio.to_thread(http, backend + '/__auth/state')


async def context(browser, origin, blocked, mobile=False):
    browser_context = await browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1280, 'height': 900}, is_mobile=mobile, has_touch=mobile, service_workers='block')
    async def local_only(route):
        if route.request.url.startswith(origin + '/'):
            await route.continue_()
        else:
            blocked.append(route.request.url.split('?')[0])
            await route.abort('blockedbyclient')
    await browser_context.route('**/*', local_only)
    return browser_context


async def request_email(page, email):
    await page.locator('#workspace-email').fill(email)
    async with page.expect_response(lambda response: response.url.endswith('/api/auth/email/request') and response.request.method == 'POST') as pending:
        await page.get_by_role('button', name='Continue with email', exact=True).click()
    response = await pending.value
    return response.status


async def verify_link(browser_context, origin, backend, email, return_to=None):
    item = await asyncio.to_thread(http, backend + '/__auth/link?email=' + email)
    path = origin + '/api/auth/email/verify?token=' + item['token']
    if return_to:
        path += '&returnTo=' + return_to
    # The synthetic token remains transient and is never written to evidence.
    response = await browser_context.request.get(path, max_redirects=0)
    return response, path


async def run_cases(browser, origin, google_origin, backend):
    blocked, contexts = [], []
    async def new(origin=origin, mobile=False):
        value = await context(browser, origin, blocked, mobile)
        contexts.append(value)
        page = await value.new_page()
        await page.goto(origin + '/login', wait_until='networkidle')
        return value, page
    try:
        owner, page = await new()
        assert await page.locator('#g_id_onload').count() == 0
        assert await page.get_by_role('button', name='Continue with email', exact=True).is_enabled()
        await page.screenshot(path=str(OUT / 'auth-login-google-unconfigured.png'))
        RESULT['cases']['googleUnconfigured'] = {'googleWidgetCount': 0, 'emailControlEnabled': True}

        google_context, google_page = await new(google_origin)
        await google_page.locator('.google-login [role=alert]').wait_for()
        metadata = await google_page.locator('#g_id_onload').evaluate('(node)=>({client:node.dataset.client_id,uri:node.dataset.login_uri,mode:node.dataset.ux_mode})')
        assert metadata == {'client': 'synthetic-client.apps.googleusercontent.com', 'uri': google_origin + '/api/auth/google/callback', 'mode': 'redirect'}, metadata
        assert await google_page.get_by_role('button', name='Continue with email', exact=True).is_enabled()
        await google_page.screenshot(path=str(OUT / 'auth-login-google-script-error.png'))
        RESULT['cases']['googleConfiguredScriptBlocked'] = {'metadataUsesSyntheticClientAndLocalCallback': True, 'errorVisible': True, 'emailFallbackEnabled': True}

        mobile_context, mobile_page = await new(mobile=True)
        await mobile_page.locator('#workspace-email').tap()
        assert await mobile_page.evaluate('document.activeElement.id') == 'workspace-email'
        await mobile_page.keyboard.type('mobile@example.test')
        await mobile_page.keyboard.press('Tab')
        assert 'Continue with email' in await mobile_page.evaluate('document.activeElement.textContent')
        ready_layout = await mobile_page.evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
        assert ready_layout['width'] == 390 and ready_layout['scrollWidth'] <= 390, ready_layout
        button = mobile_page.get_by_role('button', name='Continue with email', exact=True)
        button_box = await button.bounding_box()
        input_box = await mobile_page.locator('#workspace-email').bounding_box()
        assert button_box['height'] >= 44 and input_box['height'] >= 44
        await mobile_page.screenshot(path=str(OUT / 'auth-login-mobile-ready.png'))
        async with mobile_page.expect_response(lambda response: response.url.endswith('/api/auth/email/request') and response.request.method == 'POST') as pending:
            await button.tap()
        assert (await pending.value).status == 503
        error = mobile_page.locator('#email-login-error')
        await error.wait_for()
        await error.scroll_into_view_if_needed()
        error_box = await error.bounding_box()
        error_layout = await mobile_page.evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight})')
        assert error_layout['scrollWidth'] <= 390 and error_box['x'] >= 0 and error_box['x'] + error_box['width'] <= 390
        assert error_box['y'] >= 0 and error_box['y'] + error_box['height'] <= error_layout['height']
        assert await mobile_page.locator('#workspace-email').input_value() == 'mobile@example.test'
        assert await button.is_enabled()
        await mobile_page.screenshot(path=str(OUT / 'auth-login-mobile-email-unavailable.png'))
        RESULT['cases']['mobileLoginAndUnavailableRecovery'] = {'viewport': {'width':390, 'height':844}, 'touchInputFocus': True, 'keyboardTabReachesSubmit': True,
            'minimumInputAndButtonHeight': min(button_box['height'],input_box['height']), 'horizontalOverflow': False, 'tapSubmitStatus':503,
            'errorFullyInViewport':True, 'draftPreserved':True, 'submitUsableAfterFailure':True, 'realDeviceKeyboardVerified':False}

        before = await state(backend)
        status = await request_email(page, 'unconfigured@example.test')
        assert status == 503
        await page.locator('#email-login-error').wait_for()
        assert await page.locator('#workspace-email').input_value() == 'unconfigured@example.test'
        after = await state(backend)
        assert after['tokenCount'] == before['tokenCount'] and after['deliveryCount'] == 0
        RESULT['cases']['emailUnconfigured'] = {'status': status, 'draftPreserved': True, 'unsentChallengeRemoved': True, 'deliveryCount': 0}

        await asyncio.to_thread(http, backend + '/__auth/mode/failure', 'POST')
        status = await request_email(page, 'failure@example.test')
        assert status == 503
        assert 'Synthetic email delivery unavailable.' in await page.locator('#email-login-error').inner_text()
        RESULT['cases']['emailDeliveryFailure'] = {'status': status, 'errorVisible': True, 'draftPreserved': await page.locator('#workspace-email').input_value() == 'failure@example.test'}

        await asyncio.to_thread(http, backend + '/__auth/mode/hold', 'POST')
        await page.locator('#workspace-email').fill('owner@example.test')
        before = await state(backend)
        await page.eval_on_selector('form.email-login-form', '(form)=>{form.requestSubmit();form.requestSubmit();}')
        await page.get_by_role('button', name='Sending sign-in link…', exact=True).wait_for()
        assert await page.locator('#workspace-email').is_disabled()
        assert await page.get_by_role('button', name='Sending sign-in link…', exact=True).is_disabled()
        await asyncio.to_thread(http, backend + '/__auth/release', 'POST')
        await page.get_by_text('Check your inbox', exact=True).wait_for()
        after = await state(backend)
        assert after['emailRequests'] == before['emailRequests'] + 1 and after['deliveryCount'] == before['deliveryCount'] + 1
        RESULT['cases']['emailBusyAndDoubleSubmit'] = {'requestCount': 1, 'inputAndButtonDisabledWhilePending': True, 'syntheticDeliveryRecorded': True}

        await asyncio.to_thread(http, backend + '/__auth/mode/success', 'POST')
        await page.clock.install()
        await page.clock.fast_forward(31000)
        await asyncio.to_thread(http, backend + '/__auth/age/31', 'POST')
        before = await state(backend)
        await page.get_by_role('button', name='Resend link', exact=True).click()
        await page.wait_for_timeout(100)
        after = await state(backend)
        delta = after['emailRequests'] - before['emailRequests']
        assert after['deliveryCount'] == before['deliveryCount']
        if EXPECTED_RESEND_SECONDS == 60:
            assert delta == 0 and 'seconds before requesting another link' in await page.locator('#email-login-error').inner_text(), (delta, after)
        else:
            assert delta == 1 and await page.locator('#email-login-error').count() == 0, (delta, after)
        RESULT['cases']['resendAt31Seconds'] = {'browserRequestCount': delta, 'newDeliveryCount': 0, 'explicitWaitError': EXPECTED_RESEND_SECONDS == 60,
                                              'observation': 'The old 30-second control posts and shows success while the backend 60-second window suppresses delivery.' if EXPECTED_RESEND_SECONDS == 30 else 'The corrected control explains the 60-second window without sending a misleading request.'}
        await page.clock.fast_forward(31000)
        await asyncio.to_thread(http, backend + '/__auth/age/31', 'POST')
        await page.get_by_role('button', name='Resend link', exact=True).click()
        await page.get_by_text('Check your inbox', exact=True).wait_for()
        for _ in range(50):
            after = await state(backend)
            if after['deliveryCount'] == before['deliveryCount'] + 1:
                break
            await asyncio.sleep(.05)
        assert after['deliveryCount'] == before['deliveryCount'] + 1
        RESULT['cases']['resendAfter62Seconds'] = {'newDeliveryCount': 1}

        response, used_path = await verify_link(owner, origin, backend, 'owner@example.test', 'https://outside.invalid')
        assert response.status in {303, 307} and response.headers['location'] == origin + '/'
        cookie_header = response.headers.get('set-cookie', '')
        assert all(flag in cookie_header for flag in ['HttpOnly', 'Secure', 'SameSite=lax', 'Max-Age=604800'])
        await page.goto(origin, wait_until='networkidle')
        assert '/login' not in page.url
        me = await page.evaluate("async()=>{const r=await fetch('/api/auth/me');return{status:r.status,body:await r.json()};}")
        assert me['status'] == 200 and me['body']['email'] == 'owner@example.test', me
        RESULT['cases']['emailCallbackCookie'] = {'status': response.status, 'sessionFlags': ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=604800'], 'signedInBackendEmailMatches': True, 'externalReturnToIgnored': True}

        repeated = await owner.request.get(used_path, max_redirects=0)
        assert repeated.headers['location'].endswith('/login?error=magic-link')
        after = await state(backend)
        assert after['rawTokenStored'] is False
        RESULT['cases']['magicLinkOneUseAndStorage'] = {'secondUseRejected': True, 'rawTokenStored': False}

        other, other_page = await new()
        assert await request_email(other_page, 'another@example.test') == 200
        response, _ = await verify_link(other, origin, backend, 'another@example.test')
        assert response.headers['location'] == origin + '/'
        await other_page.goto(origin, wait_until='networkidle')
        created = await page.evaluate("""async()=>{const r=await fetch('/api/bots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Auth isolation fixture',role:'Assistant',system_prompt:'Synthetic fixture only.',llm_provider:'openai',llm_model:'gpt-6.1-sol',client_request_id:crypto.randomUUID()})});return r.status;}""")
        assert created == 200
        visible = await other_page.evaluate("""async()=>{const r=await fetch('/api/bots',{headers:{'x-grokbot-user-id':'""" + me['body']['id'] + """'}});return{status:r.status,bots:await r.json()};}""")
        assert visible == {'status': 200, 'bots': []}
        RESULT['cases']['verifiedSessionTenantIsolation'] = {'ownAgentCreated': True, 'otherTenantVisibleCount': 0, 'forgedUserHeaderIgnored': True}

        expired, expired_page = await new()
        assert await request_email(expired_page, 'expired@example.test') == 200
        await asyncio.to_thread(http, backend + '/__auth/expire', 'POST', {'email': 'expired@example.test'})
        rejected, _ = await verify_link(expired, origin, backend, 'expired@example.test')
        assert rejected.headers['location'].endswith('/login?error=magic-link')
        await expired_page.goto(rejected.headers['location'], wait_until='networkidle')
        assert 'invalid or expired' in await expired_page.locator('.login-card [role=alert]').inner_text()
        RESULT['cases']['expiredMagicLink'] = {'rejected': True, 'recoveryMessageVisible': True}

        before = await state(backend)
        csrf_rejected = await google_context.request.post(google_origin + '/api/auth/google/callback', form={'credential': 'SYNTHETIC_GOOGLE_VALID_ACCOUNT_0000', 'g_csrf_token': 'missing-cookie'}, max_redirects=0)
        assert csrf_rejected.status == 303 and csrf_rejected.headers['location'].endswith('error=google-csrf')
        assert (await state(backend))['googleVerifications'] == before['googleVerifications']
        RESULT['cases']['googleCsrfBeforeBackend'] = {'status': 303, 'backendVerifierCalls': 0}

        await google_context.add_cookies([{'name': 'g_csrf_token', 'value': 'synthetic-csrf', 'url': google_origin}])
        conflict = await google_context.request.post(google_origin + '/api/auth/google/callback', form={'credential': 'SYNTHETIC_GOOGLE_CONFLICT_ACCOUNT_0', 'g_csrf_token': 'synthetic-csrf'}, max_redirects=0)
        assert conflict.headers['location'].endswith('error=email-required')
        await google_page.goto(conflict.headers['location'], wait_until='networkidle')
        assert 'existing workspace' in await google_page.locator('.login-card > [role=alert]').inner_text()
        RESULT['cases']['googleThirdPartyOwnershipConflict'] = {'emailRequired': True, 'existingOwnerNotReassigned': True}

        await google_context.add_cookies([{'name': 'g_csrf_token', 'value': 'synthetic-csrf', 'url': google_origin}])
        google_success = await google_context.request.post(google_origin + '/api/auth/google/callback?returnTo=https://outside.invalid', form={'credential': 'SYNTHETIC_GOOGLE_VALID_ACCOUNT_0000', 'g_csrf_token': 'synthetic-csrf'}, max_redirects=0)
        assert google_success.status == 303 and google_success.headers['location'] == google_origin + '/'
        await google_page.goto(google_origin, wait_until='networkidle')
        assert '/login' not in google_page.url
        assert not any(item['name'] == 'g_csrf_token' for item in await google_context.cookies())
        RESULT['cases']['syntheticGoogleCallbackCookie'] = {'status': 303, 'sessionAcceptedLocally': True, 'csrfCookieCleared': True, 'externalReturnToIgnored': True, 'realProviderLogin': False}

        logout = await owner.request.get(origin + '/api/auth/logout?returnTo=https://outside.invalid', max_redirects=0)
        assert logout.headers['location'] == origin + '/login' and 'Max-Age=0' in logout.headers.get('set-cookie', '')
        await page.goto(origin, wait_until='networkidle')
        assert '/login' in page.url and (await owner.request.get(origin + '/api/bots')).status == 401
        RESULT['cases']['logout'] = {'cookieExpired': True, 'workspaceRedirectsToLogin': True, 'protectedApiStatus': 401}
        assert all(url == 'https://accounts.google.com/gsi/client' for url in blocked), blocked
        RESULT['blockedExternalScriptRequests'] = sorted(set(blocked))
        RESULT['finalBackendState'] = await state(backend)
    finally:
        for value in contexts:
            await value.close()


async def run():
    OUT.mkdir(parents=True, exist_ok=True)
    children, logs = [], []
    with tempfile.TemporaryDirectory(prefix='grokbot-auth-') as temporary:
        temp = Path(temporary)
        try:
            frontend = temp / 'frontend'
            shutil.copytree(REPO / 'frontend', frontend, ignore=shutil.ignore_patterns('node_modules', '.next', '.env*'))
            shutil.copytree(REPO / 'frontend/node_modules', frontend / 'node_modules', symlinks=True)
            RESULT['sourceSha256'] = {str(path.relative_to(frontend)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [
                frontend / 'src/components/EmailLoginForm.tsx', frontend / 'src/components/GoogleLogin.tsx', frontend / 'src/app/login/page.tsx', frontend / 'src/lib/auth-server.ts',
                *list((frontend / 'src/app/api/auth').rglob('route.ts'))]}
            child_env = helpers.env()
            child_env['GROKBOT_DATABASE_URL'] = 'sqlite+aiosqlite:///' + str(temp / 'auth.db')
            backend_log = open(OUT / 'auth-backend.log', 'w')
            logs.append(backend_log)
            backend = subprocess.Popen([sys.executable, str(HERE / 'auth-fixture-server.py')], cwd=temp, env=child_env, stdout=subprocess.PIPE, stderr=backend_log, text=True)
            children.append(backend)
            line = await asyncio.wait_for(asyncio.to_thread(backend.stdout.readline), 20)
            backend_url = 'http://127.0.0.1:' + str(json.loads(line)['port'])
            await helpers.ready(backend_url + '/health', backend)
            child_env['BACKEND_INTERNAL_URL'] = backend_url
            with open(OUT / 'auth-build.log', 'w') as log:
                build = await asyncio.create_subprocess_exec('node', str(frontend / 'node_modules/next/dist/bin/next'), 'build', cwd=frontend, env=child_env, stdout=log, stderr=subprocess.STDOUT)
                assert await asyncio.wait_for(build.wait(), 180) == 0, (OUT / 'auth-build.log').read_text()[-1500:]
            RESULT['productionBuild'] = 'passed'
            origins = []
            for google in [False, True]:
                port = helpers.free_port()
                # Next normalizes loopback request.url to localhost for redirects.
                origin = 'http://localhost:' + str(port)
                origins.append(origin)
                next_env = {**child_env, 'GROKBOT_PUBLIC_URL': origin}
                if google:
                    next_env['GOOGLE_AUTH_CLIENT_ID'] = 'synthetic-client.apps.googleusercontent.com'
                log = open(OUT / ('auth-google-next.log' if google else 'auth-email-next.log'), 'w')
                logs.append(log)
                server = subprocess.Popen(['node', str(frontend / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', str(port)], cwd=frontend, env=next_env, stdout=log, stderr=subprocess.STDOUT)
                children.append(server)
                await helpers.ready(origin + '/login', server)
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True, args=['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-quic', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'])
                await run_cases(browser, origins[0], origins[1], backend_url)
                await browser.close()
            RESULT['status'] = 'passed'
            RESULT['passedCases'] = len(RESULT['cases'])
            print('PASS local synthetic auth browser cases: ' + str(RESULT['passedCases']), flush=True)
        except Exception as exc:
            RESULT['status'], RESULT['error'] = 'failed', str(exc)
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
            (OUT / RESULT_NAME).write_text(json.dumps(RESULT, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    asyncio.run(run())
