"""
Browser Tool — AI-powered web browser automation for No-API UI Operation.

Uses the browser-use library with Playwright to navigate web UIs, interact
with elements, fill forms, and extract content — enabling bots to operate
any web application without needing an API.
"""

import asyncio
import base64
import logging
from typing import Optional

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

        if session_id not in self._pages:
            context = await self._browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()
            self._contexts[session_id] = context
            self._pages[session_id] = page
            logger.info(f"Created new browser session: {session_id}")

        return self._pages[session_id]

    async def navigate_to(self, url: str, session_id: str = "default") -> dict:
        """Navigate to a URL and return page info.

        Args:
            url: The URL to navigate to.
            session_id: Browser session identifier for state isolation.

        Returns:
            Dict with title, url, and status.
        """
        page = await self._get_page(session_id)
        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=10000)
            title = await page.title()
            return {
                "success": True,
                "title": title,
                "url": page.url,
                "status": response.status if response else None,
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
            # Try CSS selector first, fall back to text-based
            try:
                await page.click(selector, timeout=timeout)
            except Exception:
                await page.get_by_text(selector).click(timeout=timeout)

            await page.wait_for_load_state("networkidle", timeout=5000)
            return {"success": True, "selector": selector}
        except Exception as e:
            logger.error(f"Click on '{selector}' failed: {e}")
            return {"success": False, "error": str(e), "selector": selector}

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
            return {"success": True, "selector": selector, "text_length": len(text)}
        except Exception as e:
            logger.error(f"Type into '{selector}' failed: {e}")
            return {"success": False, "error": str(e), "selector": selector}

    async def screenshot(
        self, session_id: str = "default", full_page: bool = False
    ) -> dict:
        """Capture a screenshot of the current page.

        Args:
            session_id: Browser session identifier.
            full_page: Whether to capture the entire scrollable page.

        Returns:
            Dict with base64-encoded screenshot and page info.
        """
        page = await self._get_page(session_id)
        try:
            screenshot_bytes = await page.screenshot(
                full_page=full_page, type="png"
            )
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            title = await page.title()
            return {
                "success": True,
                "screenshot_base64": screenshot_b64,
                "title": title,
                "url": page.url,
                "size_bytes": len(screenshot_bytes),
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
                () => Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
                    text: a.textContent.trim(),
                    href: a.href
                }))
            """)

            # Extract form fields
            forms = await page.evaluate("""
                () => Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
                    type: el.type || el.tagName.toLowerCase(),
                    name: el.name || el.id,
                    placeholder: el.placeholder || '',
                    value: el.value || ''
                }))
            """)

            title = await page.title()
            return {
                "success": True,
                "instruction": instruction,
                "title": title,
                "url": page.url,
                "text_content": text_content[:10000],  # Limit size
                "links": links,
                "forms": forms,
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
