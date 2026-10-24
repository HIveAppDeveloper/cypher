"""Built-in Cypher tools for asynchronous investor matching."""
from datetime import timedelta

from pydantic import ValidationError
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.db.tenancy import current_tenant_id
from app.models.investor_funnel import InvestorMatchLabel, InvestorMatchRun, InvestorUniverseSnapshot, utcnow
from app.models.user import User
from app.services.investor_funnel import prepare_outreach, record_event, search_founder_leads, sec_user_agent, snapshot


async def search_vc_founders(arguments, _bot_id):
    tenant = current_tenant_id.get()
    if not tenant:
        return {"error": "Sign in to search public founder and issuer-related-person leads."}
    query = str(arguments.get("q") or "").strip()[:120]
    industry = str(arguments.get("industry") or "").strip()[:160] or None
    state = str(arguments.get("state") or "").strip()[:80] or None
    founder_only = arguments.get("founder_only") is True
    raw_limit = arguments.get("limit", 25)
    raw_offset = arguments.get("offset", 0)
    if isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or not 1 <= raw_limit <= 100:
        return {"error": "limit must be an integer between 1 and 100."}
    if isinstance(raw_offset, bool) or not isinstance(raw_offset, int) or not 0 <= raw_offset <= 100000:
        return {"error": "offset must be an integer between 0 and 100000."}
    if len(query) == 1:
        return {"error": "Use at least two characters for q."}
    async with AsyncSessionLocal() as db:
        return await search_founder_leads(db, query, industry, state, founder_only, raw_limit, raw_offset)


async def start_investor_match(arguments, _bot_id):
    tenant = current_tenant_id.get()
    if not tenant:
        return {"error": "Sign in to start investor matching."}
    try:
        from app.api.investor_funnel import MatchInput
        body = MatchInput.model_validate(arguments)
    except ValidationError as error:
        return {"error": "Invalid thesis input.", "fields": [{"field": ".".join(map(str, item["loc"])), "message": item["msg"]} for item in error.errors()]}

    async with AsyncSessionLocal() as db:
        active = (await db.execute(select(InvestorMatchRun.id).where(
            InvestorMatchRun.tenant_id == tenant,
            InvestorMatchRun.status.in_(["pending", "running", "cancel_requested"]),
        ).limit(3))).scalars().all()
        if len(active) >= 3:
            return {"error": "This workspace already has three active investor match runs."}
        cache = await db.get(InvestorUniverseSnapshot, "current")
        fresh = bool(cache and cache.built_at and (utcnow() - cache.built_at) < timedelta(days=90))
        if not fresh:
            user = await db.get(User, tenant)
            if user is None or not sec_user_agent(user.email):
                return {"error": "Sign in with a verified email address before Cypher refreshes SEC public data."}
        values = body.model_dump()
        direction = values.pop("direction")
        thesis = {key: value for key, value in values.items() if key not in {"limit", "candidate_limit"}}
        row = InvestorMatchRun(direction=direction, thesis=thesis, limit=body.limit, candidate_limit=body.candidate_limit)
        db.add(row)
        await db.flush()
        record_event(row, "queued", source="SEC Form ADV and Form D", snapshot_cached=fresh)
        await db.commit()
        await db.refresh(row)
        return {
            "id": row.id, "status": row.status, "phase": row.phase,
            "message": "Investor matching is queued. Use get_vc_investor_match with this run ID for status and results.",
            "source_snapshot_cached": fresh,
        }


async def get_investor_match(arguments, _bot_id):
    tenant = current_tenant_id.get()
    if not tenant:
        return {"error": "Sign in to read investor matching runs."}
    run_id = str(arguments.get("run_id", ""))
    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(InvestorMatchRun).where(
            InvestorMatchRun.id == run_id,
            InvestorMatchRun.tenant_id == tenant,
        ))).scalar_one_or_none()
        if row is None:
            return {"error": "Investor matching run not found in this workspace."}
        return snapshot(row, await db.get(InvestorUniverseSnapshot, "current"))


async def label_investor_match(arguments, _bot_id):
    tenant = current_tenant_id.get()
    if not tenant:
        return {"error": "Sign in to rate investor matches."}
    run_id = str(arguments.get("run_id", ""))
    firm_id = str(arguments.get("firm_id", ""))
    label_value = arguments.get("label")
    if isinstance(label_value, bool) or label_value not in (-1, 1):
        return {"error": "label must be 1 for useful or -1 for not useful."}
    note = str(arguments.get("note", "")).strip()[:500]
    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(InvestorMatchRun).where(
            InvestorMatchRun.id == run_id,
            InvestorMatchRun.tenant_id == tenant,
        ))).scalar_one_or_none()
        if row is None or row.status not in {"completed", "partial"}:
            return {"error": "A completed investor match containing this firm is required."}
        if row.direction != "investors_for_thesis":
            return {"error": "Workspace firm ratings apply to investor matches only."}
        if not any(result.get("id") == firm_id for result in (row.results or [])):
            return {"error": "That firm is not in the selected run."}
        saved = (await db.execute(select(InvestorMatchLabel).where(
            InvestorMatchLabel.tenant_id == tenant,
            InvestorMatchLabel.firm_id == firm_id,
        ).limit(1))).scalar_one_or_none()
        if saved is None:
            db.add(InvestorMatchLabel(firm_id=firm_id, label=label_value, note=note))
        else:
            saved.label, saved.note, saved.updated_at = label_value, note, utcnow()
        await db.commit()
        return {"firm_id": firm_id, "label": label_value, "note": note, "saved": True}


async def prepare_investor_outreach(arguments, _bot_id):
    tenant = current_tenant_id.get()
    if not tenant:
        return {"error": "Sign in to prepare investor outreach."}
    run_id, result_id = str(arguments.get("run_id", "")), str(arguments.get("result_id", ""))
    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(InvestorMatchRun).where(
            InvestorMatchRun.id == run_id,
            InvestorMatchRun.tenant_id == tenant,
        ))).scalar_one_or_none()
        if row is None or row.status not in {"completed", "partial"}:
            return {"error": "A completed match run in this workspace is required."}
        result = next((item for item in (row.results or []) if item.get("id") == result_id), None)
        if result is None:
            return {"error": "That company or investor is not in the selected run."}
        return prepare_outreach(row, result)
