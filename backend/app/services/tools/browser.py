"""
Browser Tool — AI-powered web browser automation for No-API UI Operation.

Uses the browser-use library with Playwright to navigate web UIs, interact
with elements, fill forms, and extract content — enabling bots to operate
any web application without needing an API.
"""

import asyncio
import base64
import json
from datetime import datetime
import logging
import re
from uuid import uuid4
from typing import Optional
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, Browser, Page, BrowserContext

logger = logging.getLogger(__name__)


class BrowserTool:
    """Browser automation tool using Playwright.

    Provides AI-native web interaction capabilities — bots can log into
    accounts, navigate UIs, fill forms, click buttons, and extract data
    from any web application.
    """

    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._contexts: dict[str, BrowserContext] = {}
        self._pages: dict[str, Page] = {}

    async def _ensure_browser(self):
        """Lazily initialize the browser instance."""
        if not self._browser:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            logger.info("Browser instance started")

    async def _get_page(self, session_id: str = "default") -> Page:
        """Get or create a browser page for a session.

        Sessions allow bots to maintain separate browser states (cookies,
        logins, etc.) across interactions.
        """
        await self._ensure_browser()

        if session_id in self._pages and self._pages[session_id].is_closed():
            pages=[p for p in self._contexts[session_id].pages if not p.is_closed()]
            self._pages[session_id]=pages[-1] if pages else await self._contexts[session_id].new_page()
        if session_id not in self._pages:
            storage_state = await self._load_state(session_id)
            context = await self._browser.new_context(
                storage_state=storage_state,
                viewport={"width": 1280, "height": 720},
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()
            self._contexts[session_id] = context
            self._pages[session_id] = page
            # Human sign-in and agent clicks can open an OAuth popup. Keep the
            # visible browser view on the current page in the same private context.
            context.on('page',lambda opened:self._pages.__setitem__(session_id,opened))
            logger.info(f"Created new browser session: {session_id}")

        return self._pages[session_id]

    async def _load_state(self, session_id):
        from app.db.session import AsyncSessionLocal
        from app.models.context import BrowserSession
        from app.services.plugins import reveal
        try:
            async with AsyncSessionLocal() as db:
                saved = await db.get(BrowserSession, session_id)
                return json.loads(reveal(saved.state)) if saved else None
        except Exception:
            logger.warning("Saved browser session could not be restored")
            return None

    async def _save_state(self, session_id):
        from app.db.session import AsyncSessionLocal
        from app.models.context import BrowserSession
        from app.services.plugins import seal
        try:
            state = json.dumps(await self._contexts[session_id].storage_state())
            if len(state) > 1000000:
                logger.warning("Browser state exceeded persistence limit")
                return
            async with AsyncSessionLocal() as db:
                saved = await db.get(BrowserSession, session_id)
                if saved is None:
                    saved = BrowserSession(bot_id=session_id); db.add(saved)
                saved.state=seal(state);saved.updated_at=datetime.utcnow()
                await db.commit()
        except Exception:
            logger.warning("Browser session could not be saved")

    async def navigate_to(self, url: str, session_id: str = "default") -> dict:
        """Navigate to a URL and return page info.

        Args:
            url: The URL to navigate to.
            session_id: Browser session identifier for state isolation.

        Returns:
            Dict with title, url, and status.
        """
        if urlsplit(url).scheme not in {"http", "https"}:
            return {"success": False, "error": "Use an HTTP or HTTPS website URL.", "url": url}
        try:
            page = await self._get_page(session_id)
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Analytics/live connections may never become idle. DOM content is
            # enough to read; a network-idle timeout must not discard the page.
            await self._save_state(session_id)
            title = await page.title()
            status = response.status if response else None
            if status==404:
                return {'success':False,'title':title,'url':page.url,'status':status,'error':'Page not found (HTTP 404). Do not invent content for this URL.'}
            blocked = status is not None and status >= 400
            challenge = ("/sorry/" in page.url and "google." in (urlsplit(page.url).hostname or '')) or title.lower() in {"just a moment...", "attention required! | cloudflare", "bot or not?"}
            if blocked or challenge:
                return {"success": False, "title": title, "url": page.url, "status": status, "error": "The website denied access or requires a browser challenge. Use search_web for research or another public source. Do not treat this as an empty search result."}
            text=await page.inner_text('body',timeout=5000)
            if not text.strip():
                try:
                    await page.wait_for_function("document.body && document.body.innerText.trim().length > 0",timeout=3000)
                    text=await page.inner_text('body',timeout=5000)
                    title=await page.title()
                except Exception:
                    return {'success':False,'title':title,'url':page.url,'status':status,'render_pending':True,'error':'No readable page content rendered within the bounded wait. This is not evidence of no results or no availability. Retry the rendered page or use another source.'}
            sections=await self._sections(page)
            text_budget=max(2000,12000-sum(len(s['text']) for s in sections))
            return {
                "success": True,
                "title": title,
                "url": page.url,
                "status": status,
                "text_content": text[:text_budget],
                'content_sections':sections,
                "controls": await self._controls(page),
            }
        except Exception as e:
            logger.error(f"Navigation to {url} failed: {e}")
            return {"success": False, "error": str(e), "url": url}

    async def click(
        self, selector: str, session_id: str = "default", timeout: int = 5000
    ) -> dict:
        """Click an element on the current page.

        Args:
            selector: CSS selector or text content to click.
            session_id: Browser session identifier.
            timeout: Max wait time in milliseconds.

        Returns:
            Dict indicating success or failure.
        """
        page = await self._get_page(session_id)
        try:
            # Resolve before acting. Never retry a dispatched click as text:
            # a post-click error may occur after a consequential action ran.
            try:
                target=page.locator(selector)
                count=await target.count()
            except Exception:
                count=0
            if count==0:
                target=page.get_by_text(selector,exact=True)
                count=await target.count()
            if count!=1:
                return {'success':False,'selector':selector,'matches':count,'error':'Choose one exact selector from controls; no click was performed.','controls':await self._controls(page)}
            await target.click(timeout=timeout)

            page=await self._get_page(session_id)
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
            await self._save_state(session_id)
            return {"success": True, "selector": selector,'url':page.url,'title':await page.title(),'controls':await self._controls(page)}
        except Exception as e:
            logger.error(f"Click on '{selector}' failed: {e}")
            return {"success": False, "error": str(e), "selector": selector}

    async def _controls(self,page,instruction=''):
        """Return bounded, unambiguous selectors for currently visible controls."""
        return await page.evaluate("""({prefix,fieldsFirst}) => {
            const nodes=[...document.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"]')]
                .filter(el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden');
            const card='article,[role="listitem"],[data-testid$="-card"],[itemtype$="/Product"]';
            const rank=el=>{
                if(el.closest('nav,aside,header,footer,[role="navigation"],[role="complementary"]'))return 4;
                if(fieldsFirst && el.matches('input,textarea,select'))return 0;
                if(el.closest(card))return fieldsFirst?1:0;
                if(el.matches('button,a,[role="button"]'))return fieldsFirst?2:1;
                return fieldsFirst?3:2;
            };
            // Results must not disappear behind a long list of filter checkboxes.
            // An explicit extraction request for fields brings those back first.
            nodes.sort((a,b)=>rank(a)-rank(b));
            return nodes.slice(0,100).map((el,index)=>{
                const id=prefix+'-'+index;el.setAttribute('data-grokbot-control',id);
                return {selector:'[data-grokbot-control="'+id+'"]',tag:el.tagName.toLowerCase(),
                    type:el.getAttribute('type')||'',name:el.getAttribute('name')||'',
                    label:(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,200),
                    ...(el.tagName==='A'?{href:el.href}:{}),disabled:!!el.disabled};
            });
        }""",{'prefix':uuid4().hex[:12],'fieldsFirst':bool(re.search(r'\b(filters?|forms?|fields?|inputs?|checkboxes)\b',instruction,re.I))})

    async def _sections(self,page):
        """Keep bounded result cards together with their prices and conditions."""
        return await page.evaluate("""() => {
            const candidates=[...document.querySelectorAll('article,[role="listitem"],[data-testid$="-card"],[itemtype$="/Product"]')];
            const seen=new Set();const result=[];
            for(const el of candidates){
                if(el.closest('nav,aside,header,footer')||!el.getClientRects().length)continue;
                const heading=el.querySelector('h1,h2,h3,h4,[role="heading"]');
                const text=el.innerText?.trim();
                if(!heading||!text||seen.has(text))continue;
                seen.add(text);result.push({heading:heading.innerText.trim().slice(0,180),text:text.slice(0,600)});
                if(result.length>=20)break;
            }
            return result;
        }""")

    async def type_text(
        self,
        selector: str,
        text: str,
        session_id: str = "default",
        clear_first: bool = True,
    ) -> dict:
        """Type text into an input element.

        Args:
            selector: CSS selector for the input field.
            text: Text to type.
            session_id: Browser session identifier.
            clear_first: Whether to clear existing content before typing.

        Returns:
            Dict indicating success or failure.
        """
        page = await self._get_page(session_id)
        try:
            if clear_first:
                await page.fill(selector, text, timeout=5000)
            else:
                await page.type(selector, text, timeout=5000)
            await self._save_state(session_id)
            return {"success": True, "selector": selector, "text_length": len(text)}
        except Exception as e:
            logger.error(f"Type into '{selector}' failed: {e}")
            return {"success": False, "error": str(e), "selector": selector}

    async def screenshot(
        self, session_id: str = "default", full_page: bool | None = None
    ) -> dict:
        """Capture a screenshot of the current page.

        Args:
            session_id: Browser session identifier.
            full_page: Capture the entire page, or automatically do so for small pages.

        Returns:
            Dict with base64-encoded screenshot and page info.
        """
        page = await self._get_page(session_id)
        try:
            if full_page is None:
                full_page=await page.evaluate('Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)<=2400')
            screenshot_bytes = await page.screenshot(
                full_page=full_page, type="png"
            )
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            await self._save_state(session_id)
            title = await page.title()
            return {
                "success": True,
                "screenshot_base64": screenshot_b64,
                "title": title,
                "url": page.url,
                "size_bytes": len(screenshot_bytes),
                "full_page": full_page,
            }
        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return {"success": False, "error": str(e)}

    async def extract_content(
        self, instruction: str, session_id: str = "default"
    ) -> dict:
        """Extract structured content from the current page.

        Uses selectors and text extraction to pull data from the page.
        The instruction guides what to extract.

        Args:
            instruction: Natural language description of what to extract.
            session_id: Browser session identifier.

        Returns:
            Dict with extracted text content and page metadata.
        """
        page = await self._get_page(session_id)
        try:
            # Extract all visible text content
            text_content = await page.evaluate("""
                () => {
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: (node) => {
                                const style = window.getComputedStyle(node.parentElement);
                                if (style.display === 'none' || style.visibility === 'hidden') {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return node.textContent.trim()
                                    ? NodeFilter.FILTER_ACCEPT
                                    : NodeFilter.FILTER_REJECT;
                            }
                        }
                    );
                    const texts = [];
                    let node;
                    while (node = walker.nextNode()) {
                        texts.push(node.textContent.trim());
                    }
                    return texts.join('\\n');
                }
            """)

            # Extract links
            links = await page.evaluate("""
                () => {
                    const visible = a => !!a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden';
                    const all = [...document.querySelectorAll('a[href]')].filter(visible);
                    // Content links precede large menus; retain navigation too.
                    // title/aria-label often contain the full untruncated label.
                    const content = all.filter(a => a.closest('main, article, [role="main"], .content, .page_inner') && !a.closest('nav, aside, header, footer, .side_categories'));
                    const ordered = [...new Set([...content, ...all])];
                    return ordered.slice(0, 100).map(a => ({
                        text: a.textContent.trim().slice(0, 300),
                        title: (a.getAttribute('title') || a.getAttribute('aria-label') || '').slice(0, 500),
                        href: a.href
                    }));
                }
            """)

            sections=await self._sections(page)
            text_budget=max(2000,12000-sum(len(s['text']) for s in sections))
            # Extract form fields
            forms = await page.evaluate("""
                () => Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
                    type: el.type || el.tagName.toLowerCase(),
                    name: el.name || el.id,
                    placeholder: el.placeholder || '',
                    value: el.type === 'password' || /password|secret|token|key|credit|card|cvv/i.test((el.name || '')+' '+(el.id || '')) ? '[redacted]' : el.value || ''
                }))
            """)

            await self._save_state(session_id)
            title = await page.title()
            return {
                "success": True,
                "instruction": instruction,
                "title": title,
                "url": page.url,
                "text_content": text_content[:text_budget],
                'content_sections':sections,
                "links": links,
                "forms": forms,
                "controls": await self._controls(page,instruction),
            }
        except Exception as e:
            logger.error(f"Content extraction failed: {e}")
            return {"success": False, "error": str(e)}

    async def fill_form(
        self, fields: dict, session_id: str = "default"
    ) -> dict:
        """Fill multiple form fields at once.

        Args:
            fields: Dict mapping CSS selectors to values.
            session_id: Browser session identifier.

        Returns:
            Dict with results for each field.
        """
        page = await self._get_page(session_id)
        results = {}
        for selector, value in fields.items():
            try:
                await page.fill(selector, str(value), timeout=5000)
                results[selector] = {"success": True}
            except Exception as e:
                results[selector] = {"success": False, "error": str(e)}

        return {"success": all(r["success"] for r in results.values()), "fields": results}

    async def execute_action(
        self, action: str, params: dict, session_id: str = "default"
    ) -> dict:
        """Execute a named browser action — unified entry point for the tool registry.

        Args:
            action: One of 'navigate', 'click', 'type', 'screenshot', 'extract', 'fill_form'.
            params: Parameters for the action.
            session_id: Browser session identifier.

        Returns:
            Dict with action results.
        """
        action_map = {
            "navigate": lambda: self.navigate_to(params.get("url", ""), session_id),
            "click": lambda: self.click(params.get("selector", ""), session_id),
            "type": lambda: self.type_text(
                params.get("selector", ""), params.get("text", ""), session_id
            ),
            "screenshot": lambda: self.screenshot(session_id),
            "extract": lambda: self.extract_content(
                params.get("instruction", ""), session_id
            ),
            "fill_form": lambda: self.fill_form(params.get("fields", {}), session_id),
        }

        handler = action_map.get(action)
        if not handler:
            return {"success": False, "error": f"Unknown action: {action}"}

        return await handler()

    async def close_session(self, session_id: str = "default"):
        """Close a browser session and clean up resources."""
        if session_id in self._contexts:
            await self._contexts[session_id].close()
            del self._contexts[session_id]
            del self._pages[session_id]
            logger.info(f"Closed browser session: {session_id}")

    async def close(self):
        """Shut down the browser entirely."""
        for session_id in list(self._contexts.keys()):
            await self.close_session(session_id)
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("Browser tool shut down")
