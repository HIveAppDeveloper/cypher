"""Server-only Nicrron catalog and OpenAI-compatible chat transport."""
import asyncio
import math
import re
from datetime import datetime, timezone
from time import monotonic

import httpx

from app.config import settings

BASE_URL = "https://api.nicrron.ai/v1"
CATALOG_TTL = 300
_MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,100}/[a-z0-9][a-z0-9._-]{0,140}$", re.I)
_catalog: dict[str, dict] = {}
_catalog_at = 0.0
_catalog_checked_at: str | None = None
_catalog_lock = asyncio.Lock()


class NicrronError(RuntimeError):
    """Provider failure with a safe status only; never retain the response body."""

    def __init__(self, status_code: int | None):
        self.status_code = status_code
        status = status_code if isinstance(status_code, int) else 502
        super().__init__(f"Nicrron request failed (HTTP {status}).")


def _catalog_response() -> dict:
    return {
        "provider": "nicrron",
        "configured": True,
        "status": "ready",
        "models": sorted(_catalog.values(), key=lambda item: (item["name"].casefold(), item["id"])),
        "checked_at": _catalog_checked_at,
    }


def configured() -> bool:
    return bool(settings.NICRRON_API_KEY.strip())


def valid_model_id(model: str) -> bool:
    return isinstance(model, str) and model == model.strip() and bool(_MODEL_ID.fullmatch(model))


def _safe_model(row: object) -> dict | None:
    if not isinstance(row, dict):
        return None
    model_id = row.get("id")
    if not valid_model_id(model_id) or row.get("modality") != "chat" or row.get("deprecated") is True:
        return None
    name = row.get("name")
    description = row.get("description")
    context = row.get("context_length")
    pricing = row.get("pricing")
    providers = row.get("providers")
    safe_pricing = {}
    if isinstance(pricing, dict):
        for key in ("prompt", "completion"):
            value = pricing.get(key)
            if isinstance(value, (str, int)) and len(str(value)) <= 40:
                safe_pricing[key] = str(value)
            elif isinstance(value, float) and math.isfinite(value):
                safe_pricing[key] = str(value)
    return {
        "id": model_id,
        "name": str(name)[:160] if isinstance(name, str) else model_id,
        "description": str(description)[:500] if isinstance(description, str) else "",
        "modality": "chat",
        "context_length": context if isinstance(context, int) and context > 0 else None,
        "pricing": safe_pricing,
        "providers": [str(item)[:80] for item in providers[:20] if isinstance(item, str)] if isinstance(providers, list) else [],
    }


async def model_catalog(*, refresh: bool = False) -> dict:
    """Return the live chat catalog, using a short cache on API and worker processes."""
    global _catalog, _catalog_at, _catalog_checked_at
    if not configured():
        return {"provider": "nicrron", "configured": False, "status": "not_configured", "models": [], "checked_at": None}
    if not refresh and _catalog and monotonic() - _catalog_at < CATALOG_TTL:
        return _catalog_response()
    async with _catalog_lock:
        if not refresh and _catalog and monotonic() - _catalog_at < CATALOG_TTL:
            return _catalog_response()
        try:
            # Nicrron's catalog is public; do not attach the user's secret to this request.
            async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
                response = await client.get(f"{BASE_URL}/models", headers={"Accept": "application/json"})
            if not 200 <= response.status_code < 300:
                raise NicrronError(response.status_code)
            body = response.json()
            rows = body.get("data") if isinstance(body, dict) else None
            if not isinstance(rows, list):
                raise NicrronError(502)
            parsed = {}
            for row in rows:
                item = _safe_model(row)
                if item:
                    parsed[item["id"]] = item
            if not parsed:
                raise NicrronError(502)
        except NicrronError:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as error:
            raise NicrronError(getattr(getattr(error, "response", None), "status_code", None)) from error
        _catalog = parsed
        _catalog_at = monotonic()
        _catalog_checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return _catalog_response()


async def require_chat_model(model: str) -> dict:
    if not valid_model_id(model):
        raise NicrronError(400)
    if not configured():
        raise NicrronError(401)
    catalog = await model_catalog()
    item = next((row for row in catalog["models"] if row["id"] == model), None)
    if item is None:
        # One forced refresh avoids rejecting newly published or restored models.
        catalog = await model_catalog(refresh=True)
        item = next((row for row in catalog["models"] if row["id"] == model), None)
    if item is None:
        raise NicrronError(404)
    return item


async def test_connection() -> dict:
    """Verify the configured key with one small chat completion; return no raw body."""
    if not configured():
        return {"state": "unavailable", "message": "NICRRON_API_KEY is not configured on the backend and worker."}
    try:
        async with httpx.AsyncClient(timeout=35, follow_redirects=False) as client:
            response = await client.post(
                f"{BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {settings.NICRRON_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "nicrron/fastest",
                    "messages": [{"role": "user", "content": "Reply with exactly: Connection verified."}],
                    "max_tokens": 16,
                    "stream": False,
                },
            )
        if response.status_code in {401, 403}:
            return {"state": "access_denied", "message": "Nicrron rejected the configured API key or model access."}
        if response.status_code == 402:
            return {"state": "billing_required", "message": "Nicrron credits or account billing need attention."}
        if response.status_code == 429:
            return {"state": "rate_limited", "message": "Nicrron is rate limited. Wait briefly, then check again."}
        if response.status_code >= 500:
            return {"state": "unavailable", "message": "Nicrron is temporarily unavailable. Check again shortly."}
        if not 200 <= response.status_code < 300:
            return {"state": "unavailable", "message": "Nicrron could not verify a chat model response."}
        body = response.json()
        choices = body.get("choices") if isinstance(body, dict) else None
        message = choices[0].get("message") if isinstance(choices, list) and choices and isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            return {"state": "unavailable", "message": "Nicrron returned no chat text. Check the provider route and retry."}
        return {"state": "ready", "message": "Nicrron returned a live model response."}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"state": "unavailable", "message": "Nicrron could not be reached. Check again shortly."}
