"""akta.pro (Wokelo) enrichment for finalists, with a hard spending cap.

Spending rules (your card is charged past your credit cap, so these are strict):
- No paid call happens unless the run was started with --akta-new N (default 0: cached data only).
- Before every paid call, its worst-case credits are checked against this calendar month's allowance
  (AKTA_MONTHLY_CREDITS, minus AKTA_RESERVE_CREDITS kept back as margin) less what the ledger shows
  was used this month. If it doesn't fit, the call is refused and enrichment stops.
- Every paid call's actual credits_consumed is written to data/akta/ledger.json immediately.
Docs: https://docs.akta.pro (Company Search is free; Company Data is priced per section).
"""
import hashlib
import json
import os
import threading
import time
from datetime import datetime
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://api.akta.pro/api/v1"
TEXT_SECTIONS = ["firmographic"]          # 2 credits: description, focus, location
PORTFOLIO_SECTION = "mna_and_investment"  # 5 credits: the firm's investments (the most useful part)
SECTION_CREDITS = {"firmographic": 2, "business_model": 2, "strategic_signal": 1.5, "mna_and_investment": 5, "management_profile": 1}
MONTHLY_CREDITS = float(os.environ.get("AKTA_MONTHLY_CREDITS", "1250"))  # plan allowance; past it the card is charged
RESERVE_CREDITS = float(os.environ.get("AKTA_RESERVE_CREDITS", "100"))    # never spend the last 100
# Credits used in October 2026 before this ledger existed. The tool's own calls were 405 credits;
# the user reported about half the allowance used, so the larger figure is recorded.
SEED = {"2026-10": 625.0}


def _month(ts=None):
    return (ts or datetime.now().isoformat())[:7]


class Ledger:
    def __init__(self, cache_dir: Path):
        self.path = cache_dir / "ledger.json"
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {}
        if self.data.get("unit") != "credits/month":  # first run, or the older dollar-based ledger
            self.data = {"unit": "credits/month", "entries": [
                {"at": f"{m}-24", "credits": c, "note": "used before this ledger (user-reported: about half of 1,250)"} for m, c in SEED.items()]}
            self.save()

    def used(self, month=None):
        month = month or _month()
        return sum(e["credits"] for e in self.data["entries"] if e["at"][:7] == month)

    def limit(self):
        return MONTHLY_CREDITS - RESERVE_CREDITS

    def left(self):
        return self.limit() - self.used()

    def add(self, credits, what):
        self.data["entries"].append({"at": datetime.now().isoformat(timespec="seconds"), "credits": credits, "note": what})
        self.save()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=1))


class AktaError(Exception):
    pass


class BudgetStop(Exception):
    pass


_LOCK = threading.Lock()  # one akta.pro call at a time: keeps the ledger consistent and stays under the rate limit


class Akta:
    def __init__(self, key: str, cache_dir: Path, allow_paid: bool):
        self.key, self.cache, self.allow_paid = key, cache_dir, allow_paid
        self.cache.mkdir(parents=True, exist_ok=True)
        self.ledger = Ledger(cache_dir)
        self.portfolio_ok = None  # learned on the first call
        self.calls = 0
        self.credits = 0.0
        self._last = 0.0

    def _get(self, path, params, max_credits=0.0, body=None):
        with _LOCK:
            return self._request(path, params, max_credits, body)

    def _request(self, path, params, max_credits=0.0, body=None):
        if max_credits:  # paid endpoint: enforce the rules before sending anything
            if not self.allow_paid:
                raise BudgetStop("paid akta.pro calls are off for this run (pass --akta-new N to allow)")
            if max_credits > self.ledger.left():
                raise BudgetStop(f"next lookup could use {max_credits:g} credits; only {self.ledger.left():g} of this month's "
                                 f"{self.ledger.limit():g} usable credits are left ({MONTHLY_CREDITS:g} allowance minus {RESERVE_CREDITS:g} reserve)")
        wait = 2.6 - (time.time() - self._last)  # stay under 25 requests a minute
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
        url = f"{BASE}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        headers = {"x-api-key": self.key, "Accept": "application/json", "User-Agent": "lead-funnel/0.1"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, headers=headers, data=json.dumps(body).encode() if body is not None else None,
                                     method="POST" if body is not None else "GET")
        try:
            # List Generation's p99 is about 32 s and grows with query size; give paid calls room to finish.
            with urllib.request.urlopen(req, timeout=180 if max_credits else 60) as r:
                raw = r.read()  # not `body`: that name is the request payload, used below for the ledger note
                self.calls += 1
                data = json.loads(raw) if raw else {"data": []}
                used = float(data.get("credits_consumed") or 0)
                self.credits += used
                if used:
                    what = (params or {}).get("company") or (params or {}).get("query") or (body or {}).get("query") or "filters"
                    self.ledger.add(used, f"{path} {str(what)[:80]}")
                return data
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            raise AktaError(f"HTTP {e.code} on {path}: {detail}") from None
        except (TimeoutError, urllib.error.URLError, ConnectionError) as e:
            if max_credits:  # the server may have done (and billed) the work; never assume it was free
                self.ledger.add(max_credits, f"UNCONFIRMED: {path} got no reply ({type(e).__name__}); worst case recorded, check your akta.pro dashboard")
            raise AktaError(f"no reply from {path} ({type(e).__name__})") from None

    def _path(self, kind, key):
        return self.cache / f"{kind}-{hashlib.sha1(key.encode()).hexdigest()[:16]}.json"

    def has_cache(self, firm):
        """True if this firm's enrichment is already on disk, so using it costs nothing."""
        if firm.get("website"):
            return self._path("enrich", firm["website"]).exists()
        sp = self._path("search", firm["name"])
        if not sp.exists():
            return False
        hits = json.loads(sp.read_text())
        return not hits or self._path("enrich", hits[0]["uuid"]).exists()

    def _cached(self, kind, key, fn):
        path = self._path(kind, key)
        if path.exists():
            return json.loads(path.read_text())
        value = fn()  # fn calls _get, which holds the lock for the request and ledger write
        path.write_text(json.dumps(value))
        return value

    def search(self, name):
        """Free Company Search: name -> [{uuid, name, website, product_category}]. Cached forever."""
        return self._cached("search", name, lambda: self._get("/company/search", {"query": name}).get("data", []))

    def company_sections(self, company, sections):
        """Paid Company Data for chosen sections (e.g. management_profile, 1 credit). Cached forever."""
        worst = sum(SECTION_CREDITS[s] for s in sections)
        key = company + "|" + ",".join(sorted(sections))
        return self._cached("sections", key, lambda: self._get("/company/enrichment", {"company": company, "sections": ",".join(sections)}, max_credits=worst))

    def list_companies(self, query=None, filters=None, limit=100):
        """Paid List Generation: companies matching a natural-language query or structured filters.
        Costs 1.5 + 2.5 (if query) + 0.2 per company returned, with no enrichment sections."""
        worst = 1.5 + (0 if filters else 2.5) + 0.2 * limit
        key = json.dumps({"q": query, "f": filters, "n": limit}, sort_keys=True)
        body = {"limit": limit, **({"filters": filters} if filters else {"query": query})}
        return self._cached("list", key, lambda: self._get("/list/generate/companies/", None, max_credits=worst, body=body))

    def enrich_firm(self, firm):
        """Returns {'text': ..., 'investments': [...], 'uuid': ...} or raises AktaError."""
        ident = firm.get("website") or ""
        if not ident:
            hits = self.search(firm["name"])
            if not hits:
                return {"text": "", "investments": [], "uuid": None}
            ident = hits[0]["uuid"]

        def fetch():
            sections = TEXT_SECTIONS + ([PORTFOLIO_SECTION] if self.portfolio_ok is not False else [])
            worst = sum(SECTION_CREDITS[x] for x in sections)
            try:
                return self._get("/company/enrichment", {"company": ident, "sections": ",".join(sections)}, max_credits=worst)
            except AktaError as e:
                if self.portfolio_ok is None and (" 402 " in f" {e} " or " 403 " in f" {e} " or "subscription" in str(e).lower()):
                    self.portfolio_ok = False  # this plan has no portfolio data; retry without it
                    return self._get("/company/enrichment", {"company": ident, "sections": ",".join(TEXT_SECTIONS)},
                                     max_credits=sum(SECTION_CREDITS[x] for x in TEXT_SECTIONS))
                raise
        raw = self._cached("enrich", ident, fetch)
        data = raw.get("data") or {}
        if PORTFOLIO_SECTION in data and self.portfolio_ok is None:
            self.portfolio_ok = True
        invest = []
        for inv in (data.get(PORTFOLIO_SECTION) or {}).get("investment", []) or []:
            d = inv.get("announced_date") or {}
            invest.append({
                "company": (inv.get("investee") or {}).get("name", ""),
                "website": (inv.get("investee") or {}).get("website", ""),
                "round": (inv.get("round") or {}).get("label", ""),
                "date": f'{d.get("year", "")}-{d.get("month", 1):02d}' if d.get("year") else "",
                "lead": bool(inv.get("lead_investor")),
                "news": ((inv.get("news") or [{}])[0] or {}).get("title", "")[:300],
            })
        text_parts = []

        def walk(v):
            if isinstance(v, str) and len(v) > 25 and not v.startswith("http"):
                text_parts.append(v)
            elif isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
        order = ["firmographic", "business_model", "strategic_signal"]  # fixed order keeps cached judgments valid
        for k in order + sorted(k for k in data if k not in order and k != PORTFOLIO_SECTION):
            walk(data.get(k))
        return {"text": "\n".join(dict.fromkeys(text_parts))[:12000], "investments": invest, "uuid": ident}


def enrich(firms, key, cache_dir: Path, new_lookups: int = 0):
    """Cached lookups are attached for free to any firm. New (paid) lookups only go to the top
    `new_lookups` firms without a cache entry, and only while the budget allows."""
    client = Akta(key, cache_dir, allow_paid=new_lookups > 0)
    errors, stopped = [], ""
    uncached = [f for f in firms if not client.has_cache(f)]
    may_call = {f["id"] for f in uncached[:new_lookups]}
    for f in firms:
        if f["id"] not in may_call and not client.has_cache(f):
            continue
        try:
            res = client.enrich_firm(f)
        except BudgetStop as e:
            stopped = str(e)
            break
        except AktaError as e:
            errors.append(f'{f["name"]}: {e}')
            if " 401 " in f" {e} ":
                raise SystemExit("akta.pro rejected the API key. Check AKTA_API_KEY in .env.")
            if " 429 " in f" {e} ":
                errors.append("akta.pro rate or monthly limit reached; stopping Akta enrichment for this run.")
                break
            continue
        f["akta"] = res
        if res["text"]:
            f.setdefault("pages", []).append({"url": f"akta.pro ({res['uuid']})", "text": res["text"]})
        if res["investments"]:
            f["portfolio"] = res["investments"]
    return {"new_calls": client.calls, "credits": round(client.credits, 2), "used": round(client.ledger.used(), 1),
            "left": round(client.ledger.left(), 1), "limit": client.ledger.limit(),
            "portfolio_data": client.portfolio_ok, "stopped": stopped, "errors": errors[:10]}
