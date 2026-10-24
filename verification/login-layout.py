"""Offline login layout regression with the observed fixed-width SDK DOM shape.

Run with the project Python environment: python verification/login-layout.py.
No Google script, credentials, sign-in, model, server or external request is used.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
CSS = "\n".join((ROOT / "frontend/src/app" / name).read_text() for name in ("globals.css", "workspace-ux.css", "grok-workspace.css"))
HTML = """<main class="login-page"><section class="login-card" aria-labelledby="login-title"><span class="login-mark">G</span><h1 id="login-title">Welcome to GrokBot</h1><p class="login-copy">One workspace for your conversations, agents, and connected tools.</p><div class="google-login"><div></div><div class="g_id_signin"><div style="position:relative"><div><div role="button" tabindex="0" style="width:340px;max-width:400px;min-width:min-content;display:flex;align-items:center;gap:8px;border:1px solid #ddd;border-radius:24px;padding:10px 12px;cursor:pointer" onclick="document.body.dataset.syntheticClicked='yes'"><span aria-hidden="true" style="flex:none;width:18px">G</span><span id="google-label" style="flex:1;text-align:center;white-space:nowrap">Continue with Google</span></div></div></div></div></div><p class="login-divider">or continue with email</p><form class="email-login-form"><label for="email">Email address</label><input id="email" type="email" placeholder="you@example.com"><button class="login-email-button" type="button">Continue with email</button></form><p class="login-privacy">Sign in or create your private workspace. No password needed.</p>STATE</section></main>"""

async def main():
    results = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        context = await browser.new_context(service_workers="block")
        await context.route("**/*", lambda route: route.abort("blockedbyclient"))
        try:
            page = await context.new_page()
            page.set_default_timeout(3000)
            for width, height in ((320,844),(390,844),(768,1000),(1440,1000)):
                await page.set_viewport_size({"width":width,"height":height})
                for state, content in (("empty",""),("error",'<p class="login-error" role="alert">Google sign-in could not load. Use email below or allow accounts.google.com in your browser.</p>'),("sent",'<div class="email-login-sent"><strong>Check your inbox</strong><p>A sign-in link was sent to synthetic-fixture-with-a-long-address@example.test.</p></div>')):
                    await page.set_content('<style>'+CSS+'</style>'+HTML.replace('STATE',content))
                    bounds=await page.evaluate("""() => { const card=document.querySelector('.login-card').getBoundingClientRect(); const google=document.querySelector('[role=button]').getBoundingClientRect(); const label=document.querySelector('#google-label'); const input=document.querySelector('input').getBoundingClientRect(); return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,cardRight:card.right,cardLeft:card.left,googleRight:google.right,googleLeft:google.left,inputRight:input.right,labelFits:label.scrollWidth<=label.clientWidth}; }""")
                    assert bounds['documentWidth'] <= width, bounds
                    assert 0 <= bounds['cardLeft'] and bounds['cardRight'] <= width, bounds
                    assert bounds['cardLeft'] <= bounds['googleLeft'] < bounds['googleRight'] <= bounds['cardRight'], bounds
                    assert bounds['inputRight'] <= bounds['cardRight'] and bounds['labelFits'], bounds
                    button=page.get_by_role('button',name='Continue with Google',exact=True)
                    await button.focus()
                    assert await button.evaluate('(el)=>el===document.activeElement')
                    await button.click()
                    assert await page.locator('body').get_attribute('data-synthetic-clicked')=='yes'
                    results.append({'state':state,'height':height,**bounds})
            print(json.dumps({'status':'passed','cases':results,'limits':['Synthetic SDK DOM matches the observed width/min-content structure; no Google script or live login was executed.','Actual released SDK rendering still requires read-only visual inspection.']},indent=2))
        finally:
            await context.close()
            await browser.close()

asyncio.run(main())
