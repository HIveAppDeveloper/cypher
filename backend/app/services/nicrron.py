"""Server-only Nicrron catalog and OmniRoute connection contract."""
import asyncio
import math
import re
from datetime import datetime, timezone
from time import monotonic

import httpx

from app.config import settings

BASE_URL = "https://api.nicrron.ai/v1"
CATALOG_TTL = 300
OMNIROUTE_ROUTE_TTL = 15
_MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,100}/[a-z0-9][a-z0-9._-]{0,140}$", re.I)
_catalog: dict[str, dict] = {}
_catalog_at = 0.0
_catalog_checked_at: str | None = None
_route_model_ids: set[str] = set()
_route_checked_at = 0.0
_route_lock = asyncio.Lock()
_catalog_lock = asyncio.Lock()
_CONNECTION_TEST_MODEL = "nicrron/anthropic/claude-opus-5-5"


class NicrronError(RuntimeError):
    """Provider failure with a safe status only; never retain the response body."""

    def __init__(self, status_code: int | None):
        self.status_code = status_code
        status = status_code if isinstance(status_code, int) else 502
        super().__init__(f"Nicrron request failed (HTTP {status}).")


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


def _route_ids(payload: object) -> set[str]:
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return set()
    result = set()
    for row in rows:
        public_id = row.get("id") if isinstance(row, dict) else None
        if isinstance(public_id, str) and public_id.startswith("nicrron/"):
            model_id = public_id.removeprefix("nicrron/")
            if valid_model_id(model_id):
                result.add(model_id)
    return result


def _catalog_response(model_ids: set[str]) -> dict:
    return {
        "provider": "nicrron",
        "configured": True,
        "status": "ready" if model_ids else "unavailable",
        "models": sorted(
            (_catalog[model_id] for model_id in model_ids if model_id in _catalog),
            key=lambda item: (item["name"].casefold(), item["id"]),
        ),
        "checked_at": _catalog_checked_at,
    }


async def _live_omniroute_model_ids(*, refresh: bool = False, allow_enrollment: bool = False) -> tuple[set[str], bool]:
    """Read Nicrron routes from OmniRoute; enrollment is reserved for an explicit connection check."""
    global _route_model_ids, _route_checked_at
    if not settings.OMNIROUTE_URL or not settings.OMNIROUTE_API_KEY:
        return set(), False
    from app.services import omniroute

    async with _route_lock:
        if not refresh and monotonic() - _route_checked_at < OMNIROUTE_ROUTE_TTL:
            return set(_route_model_ids), False
        try:
            ids = _route_ids(await omniroute.request("/models"))
        except Exception:
            ids = set()
        if ids:
            _route_model_ids = ids
            _route_checked_at = monotonic()
            return set(ids), False

        _route_model_ids = set()
        _route_checked_at = monotonic()
        if not allow_enrollment or not configured() or not settings.OMNIROUTE_CONTROL_KEY:
            return set(), False

        endpoint = omniroute.endpoint().removesuffix("/v1") + "/api/internal/connections/check"
        headers = omniroute.headers()
        headers["Authorization"] = "Bearer " + settings.OMNIROUTE_CONTROL_KEY
        try:
            async with httpx.AsyncClient(timeout=110, follow_redirects=False) as client:
                response = await client.post(
                    endpoint,
                    headers=headers,
                    json={
                        "provider": "nicrron",
                        "action": "connect_api_key",
                        "api_key": settings.NICRRON_API_KEY,
                    },
                )
            if not 200 <= response.status_code < 300:
                return set(), False
            result = response.json()
            if not isinstance(result, dict) or result.get("state") != "ready":
                return set(), False
            if result.get("public_model") != _CONNECTION_TEST_MODEL or result.get("transport_model") != _CONNECTION_TEST_MODEL:
                return set(), False
        except Exception:
            return set(), False

        # The OmniRoute control action checks a real completion. Wait briefly for its
        # model cache to publish the new route before exposing any picker choices.
        for attempt in range(8):
            try:
                ids = _route_ids(await omniroute.request("/models"))
            except Exception:
                ids = set()
            if ids:
                _route_model_ids = ids
                _route_checked_at = monotonic()
                return set(ids), True
            if attempt < 7:
                await asyncio.sleep(0.75)
        return set(), False


async def model_catalog(*, refresh: bool = False) -> dict:
    """Return only live Nicrron chat models that OmniRoute currently serves."""
    global _catalog, _catalog_at, _catalog_checked_at
    if not configured():
        return {"provider": "nicrron", "configured": False, "status": "not_configured", "models": [], "checked_at": None}

    model_ids, _ = await _live_omniroute_model_ids(refresh=refresh)
    if not model_ids:
        return _catalog_response(set())
    if not refresh and _catalog and monotonic() - _catalog_at < CATALOG_TTL:
        return _catalog_response(model_ids)

    async with _catalog_lock:
        if not refresh and _catalog and monotonic() - _catalog_at < CATALOG_TTL:
            return _catalog_response(model_ids)
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
        return _catalog_response(model_ids)


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
    """Enroll or probe through OmniRoute; return no raw response or credentials."""
    if not configured():
        return {"state": "unavailable", "message": "NICRRON_API_KEY is not configured on the backend and worker."}
    if not settings.OMNIROUTE_URL or not settings.OMNIROUTE_API_KEY:
        return {"state": "unavailable", "message": "OmniRoute is not configured on this runtime."}
    ids, connected_now = await _live_omniroute_model_ids(refresh=True, allow_enrollment=True)
    if not ids:
        return {"state": "unavailable", "message": "Nicrron is not available through OmniRoute. Check its connection and retry."}
    if connected_now:
        return {"state": "ready", "message": "Nicrron was connected and verified through OmniRoute."}
    from app.services import omniroute
    try:
        response = await omniroute.request(
            "/chat/completions",
            {
                "model": f"nicrron/{sorted(ids)[0]}",
                "messages": [{"role": "user", "content": "Reply with exactly: Connection verified."}],
                "max_tokens": 16,
                "stream": False,
            },
        )
        choices = response.get("choices") if isinstance(response, dict) else None
        message = choices[0].get("message") if isinstance(choices, list) and choices and isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            return {"state": "unavailable", "message": "OmniRoute could not verify a Nicrron model response. Check the connection and retry."}
        return {"state": "ready", "message": "Nicrron returned a live model response through OmniRoute."}
    except Exception:
        return {"state": "unavailable", "message": "OmniRoute could not verify a Nicrron model response. Check the connection and retry."}
