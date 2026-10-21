"""Search HTTP and browser error boundaries, including false-success regressions."""
import json
from types import SimpleNamespace

import httpx
import pytest

from app.config import settings
from app.services.tools import web_search
from app.services.tools.browser import BrowserTool
from app.services.tools.registry import ToolRegistry


def payload():
    return {"status": "completed", "output": [
        {"type": "web_search_call", "status": "completed", "action": {"type": "search", "sources": [{"type": "url", "url": "https://example.org/profile"}]}},
        {"type": "message", "content": [{"type": "output_text", "text": "A public profile.", "annotations": [{"type": "url_citation", "url": "https://example.org/profile", "title": "Verified profile"}]}]},
    ]}


@pytest.mark.asyncio
async def test_search_uses_real_responses_http_with_bounded_native_search(monkeypatch):
    calls = []
    real_client = httpx.AsyncClient
    def respond(request):
        calls.append(json.loads(request.content))
        assert str(request.url) == "https://ai-gateway.vercel.sh/v1/responses"
        assert request.headers["authorization"] == "Bearer test-only-key"
        return httpx.Response(200, json=payload())
    monkeypatch.setattr(settings, "LLM_USE_GATEWAY", True)
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-only-key")
    monkeypatch.setattr(web_search.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    result = await web_search.search_web({"query": '"Boaz Novik"'}, "bot")
    assert result["success"] and result["sources"][0]["url"] == "https://example.org/profile"
    assert len(result["sources"]) == 1
    assert calls[0]["input"] == '"Boaz Novik"'
    assert calls[0]["tool_choice"] == "required" and calls[0]["max_tool_calls"] == 2
    assert calls[0]["tools"][0]["type"] == "web_search"
    assert calls[0]["include"] == ["web_search_call.action.sources"]
    assert not calls[0]["store"]


@pytest.mark.parametrize("output", [[], [{"type": "message", "content": [{"type": "output_text", "text": "I searched and verified it.", "annotations": []}]}], [{"type": "web_search_call", "status": "failed"}], [{"type": "web_search_call", "status": "completed", "action": {"sources": []}}]])
def test_search_never_reports_success_without_search_and_source_urls(output):
    assert not web_search.search_evidence({"output": output}, "query")["success"]


def test_search_drops_unsafe_source_urls():
    data = payload()
    data["output"][0]["action"]["sources"] += [{"url": "javascript:alert(1)"}, {"url": "https://user:password@example.org"}]
    assert len(web_search.search_evidence(data, "query")["sources"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 402, 403, 429, 500])
async def test_search_errors_do_not_leak_provider_body_or_key(monkeypatch, status):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(settings, "LLM_USE_GATEWAY", True)
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-only-private-key")
    monkeypatch.setattr(web_search.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(lambda r: httpx.Response(status, text="test-only-private-key and private diagnostic")), **kwargs))
    result = await web_search.search_web({"query": "test"}, "bot")
    assert not result["success"]
    assert "test-only-private-key" not in json.dumps(result) and "private diagnostic" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["", " " * 3, "x" * 1001, None, 123])
async def test_invalid_search_never_makes_network_request(query):
    assert not (await web_search.search_web({"query": query}, "bot"))["success"]


def test_browser_category_gets_search_but_other_categories_do_not():
    registry = ToolRegistry()
    registry.register_default_tools()
    def names(categories):
        return {t["function"]["name"] for t in registry.get_tools_for_bot(SimpleNamespace(tools_enabled=categories))}
    assert "search_web" in names(["browser"])
    assert "search_web" not in names(["filesystem"])


@pytest.mark.asyncio
@pytest.mark.parametrize("status,url,title", [(403, "https://example.org", "Denied"), (200, "https://www.google.com/sorry/index", "Google"), (200, "https://example.org", "Just a moment...")])
async def test_browser_denied_pages_are_failures(monkeypatch, status, url, title):
    browser = BrowserTool()
    async def goto(*args, **kwargs): return SimpleNamespace(status=status)
    async def get_title(): return title
    async def page(*args): return SimpleNamespace(url=url, goto=goto, title=get_title)
    async def save(*args): pass
    monkeypatch.setattr(browser, "_get_page", page)
    monkeypatch.setattr(browser, "_save_state", save)
    result = await browser.navigate_to("https://example.org", "bot")
    assert not result["success"] and "search_web" in result["error"]


@pytest.mark.asyncio
async def test_browser_reads_page_without_waiting_for_networkidle(monkeypatch):
    browser = BrowserTool()
    async def goto(*args, **kwargs): return SimpleNamespace(status=200)
    async def title(): return "A source"
    async def text(*args, **kwargs): return "Evidence on the page"
    async def page(*args): return SimpleNamespace(url="https://example.org", goto=goto, title=title, inner_text=text)
    async def save(*args): pass
    monkeypatch.setattr(browser, "_get_page", page)
    monkeypatch.setattr(browser, "_save_state", save)
    result = await browser.navigate_to("https://example.org", "bot")
    assert result["success"] and result["text_content"] == "Evidence on the page"
