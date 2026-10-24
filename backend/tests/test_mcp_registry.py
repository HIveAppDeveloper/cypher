import pytest

from app.services import mcp_registry


def test_registry_remote_becomes_connectable_only_with_concrete_https_url():
    item = mcp_registry.server_to_catalog({
        "server": {
            "name": "io.example/weather",
            "title": "Weather",
            "description": "Forecast tools",
            "version": "1.2.0",
            "websiteUrl": "https://example.com",
            "remotes": [{"type": "streamable-http", "url": "https://mcp.example.com/mcp"}],
        },
        "status": "active",
    })
    assert item["url"] == "https://mcp.example.com/mcp"
    assert item["transport"] == "streamable-http"
    assert item["setup_note"] == ""
    assert item["source"] == "https://example.com"
    assert item["domains"] == ["example.com", "mcp.example.com"]


@pytest.mark.parametrize(
    "remote",
    [
        {"type": "streamable-http", "url": "https://mcp.example.com/{account}/mcp"},
        {"type": "streamable-http", "url": "https://mcp.example.com/mcp?token=secret"},
        {"type": "streamable-http", "url": "http://mcp.example.com/mcp"},
    ],
)
def test_registry_does_not_offer_unsafe_or_template_urls_as_one_tap(remote):
    item = mcp_registry.server_to_catalog({"server": {"name": "io.example/server", "remotes": [remote]}})
    assert item["url"] == ""
    assert item["setup_note"]


def test_local_package_is_discoverable_but_not_misrepresented_as_connected():
    item = mcp_registry.server_to_catalog({
        "server": {
            "name": "io.example/local",
            "description": "Runs on a local machine",
            "packages": [{"registryType": "npm", "identifier": "@example/local-mcp"}],
        }
    })
    assert item["url"] == ""
    assert item["transport"] == "local"
    assert "local package" in item["setup_note"]


def test_registry_filters_deprecated_and_deleted_listings():
    assert mcp_registry.server_to_catalog({"server": {"name": "io.example/old"}, "status": "deprecated"}) is None
    assert mcp_registry.server_to_catalog({"server": {"name": "io.example/removed"}, "status": "deleted"}) is None


@pytest.mark.asyncio
async def test_registry_search_uses_official_search_and_opaque_cursor(monkeypatch):
    seen = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "servers": [{"server": {"name": "io.example/drive", "title": "Drive"}}],
                "metadata": {"nextCursor": "opaque:next/page"},
            }

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, params):
            seen.append((url, params))
            return Response()

    monkeypatch.setattr(mcp_registry, "http_client", lambda **kwargs: Client())
    result = await mcp_registry.search_registry("drive", "opaque:cursor with space")
    assert seen == [(mcp_registry.REGISTRY_SERVERS, {
        "search": "drive", "version": "latest", "limit": 50, "cursor": "opaque:cursor with space"
    })]
    assert result["items"][0]["name"] == "Drive"
    assert result["next_cursor"] == "opaque:next/page"
