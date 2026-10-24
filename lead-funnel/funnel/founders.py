"""Founder sourcing for a fund's thesis: from every startup and builder signal down to 10-20 founders.

Leads come from four places and share one shape:
- Form D startups raising now (officers = founders)          kind "startup", stage "raising"
- GitHub, Show HN and arXiv builders who haven't raised yet   kind "builder", stage "pre-round"
- akta.pro List Generation (paid, opt-in)                     kind "company", stage "unknown"
"""
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from .score import kw_count, size_fit
from .sec import person_key

FEATURES = ["stage_fit", "recency", "geo", "relevance", "traction", "founder", "text_sim", "warm", "claude"]
DEFAULT_WEIGHTS = {"stage_fit": .10, "recency": .10, "geo": .05, "relevance": .15, "traction": .15,
                   "founder": .10, "text_sim": .15, "warm": .05, "claude": .30}
STAGE_FEATURES = {
    "source": ["stage_fit", "recency", "geo", "relevance", "traction", "founder"],
    "screen": ["stage_fit", "recency", "geo", "relevance", "traction", "founder", "text_sim"],
    "deep": ["stage_fit", "recency", "geo", "relevance", "traction", "founder", "text_sim", "warm"],
    "final": FEATURES,
}
STATES = {"NY": ["new york", "nyc", "brooklyn"], "CA": ["california", "san francisco", "bay area", "los angeles", "palo alto", "berkeley"],
          "MA": ["massachusetts", "boston", "cambridge"], "TX": ["texas", "austin", "houston", "dallas"], "WA": ["seattle", "washington"],
          "CO": ["colorado", "denver", "boulder"], "IL": ["illinois", "chicago"], "FL": ["florida", "miami"], "GA": ["georgia", "atlanta"]}


def thesis_text(t):
    return "\n".join([t["one_liner"], t["thesis"], "Beliefs: " + " ".join(t.get("beliefs", [])), "Keywords: " + ", ".join(t.get("keywords", []))])


def money(v):
    return "undisclosed" if not v else f"${v / 1e6:.1f}M" if v >= 1e6 else f"${v / 1e3:.0f}K"


# ---------- leads ----------
def startup_leads(data_dir: Path):
    out = []
    for c in json.loads((data_dir / "startups.json").read_text())["startups"]:
        o = c["officers"][0]
        out.append({
            "id": c["id"], "kind": "startup", "source": "Form D", "stage": "raising",
            "person": o["name"], "person_title": o["title"], "people": [p["name"] for p in c["officers"]][:6],
            "company": c["company"], "location": f'{c["city"]}, {c["state"]}'.strip(", "), "state": c["state"],
            "website": "", "date": c["latest_date"], "industry": c["industry"],
            "headline": f'Form D: {money(c["round_amount"])} round, {c["investor_count"]} investors so far, filed {c["latest_date"]}',
            "text": c["company"],
            "url": f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={c["cik"]}',
            "contact": "", "officer_keys": [p["key"] for p in c["officers"]],
            "signals": {"round_amount": c["round_amount"], "round_sold": c["round_sold"], "investors": c["investor_count"],
                        "filings": len(c["filings"]), "repeat_founders": c["repeat_founders"], "backed_by": c["backed_by"],
                        "year_inc": c["year_inc"], "inc_choice": c["inc_choice"], "entity": c.get("entity", "")},
        })
    return out


def akta_leads(rows):
    return [{"id": "ak:" + r["uuid"], "kind": "company", "source": "akta.pro", "stage": "unknown", "person": "", "people": [],
             "company": r.get("name", ""), "location": "", "state": "", "website": r.get("website", ""), "date": "",
             "industry": r.get("product_category", ""), "headline": f'akta.pro match: {r.get("product_category", "")}',
             "text": f'{r.get("name", "")} {r.get("product_category", "")}', "url": "", "contact": "", "signals": {}} for r in rows]


def link_people(leads):
    """A builder who is also a Form D officer is one founder with two kinds of evidence."""
    officers = {}
    for l in leads:
        for k in l.get("officer_keys", []):
            officers.setdefault(k, l)
    for l in leads:
        if l["kind"] == "builder" and " " in l["person"]:
            first, last = l["person"].split(" ", 1)
            s = officers.get(person_key(first, last.split()[-1]))
            if s:
                l["also"] = f'officer of {s["company"]} (Form D, {s["date"]})'
                s["also"] = f'{l["source"]}: {l["headline"]}'


# ---------- website discovery for Form D startups (free) ----------
LEGAL = re.compile(r"\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|ltd|limited|pbc|technologies|technology|labs|holdings|group)\b\.?", re.I)


def _brand(company):
    words = re.sub(r"[^a-z0-9 ]", " ", LEGAL.sub(" ", company.lower())).split()
    return words[:3]


def guess_sites(leads, cache_path: Path, workers=24):
    """Try likely domains (name.com, .ai, .io, get-, -hq) and keep one whose page names the company."""
    from .web import _page
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    def one(l):
        if l["id"] in cache:
            return cache[l["id"]]
        words = _brand(l["company"])
        if not words or len("".join(words)) < 4:
            return ""
        slug, phrase = "".join(words), " ".join(words)
        for host in (f"{slug}.com", f"{slug}.ai", f"{slug}.io", f"get{slug}.com", f"{slug}hq.com", f"try{slug}.com"):
            try:
                pg = _page(f"https://{host}")
            except Exception:
                continue
            if pg and (phrase in pg["text"].lower()[:4000] or slug in pg["text"].lower()[:4000].replace(" ", "")):
                return pg["url"]
        return ""
    todo = [l for l in leads if l["kind"] == "startup" and not l["website"]]
    with ThreadPoolExecutor(workers) as pool:
        for l, site in zip(todo, pool.map(one, todo)):
            cache[l["id"]] = site
            if site:
                l["website"], l["website_note"] = site, "guessed from the company name; check it is the same company"
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache))


def akta_sites(leads, client, limit=100):
    """Free akta.pro Company Search for startups the guesser missed."""
    n = 0
    for l in leads:
        if n >= limit or l["kind"] != "startup" or l["website"]:
            continue
        try:
            hits = client.search(l["company"])
        except Exception:
            break
        n += 1
        words = set(_brand(l["company"]))
        for h in hits[:3]:
            if words and words <= set(_brand(h.get("name", ""))) and h.get("website"):
                l["website"], l["website_note"] = h["website"], "from akta.pro company search"
                l["industry"] = l["industry"] + " · " + (h.get("product_category") or "")
                break
    return n


# ---------- features ----------
def _months(d, today):
    try:
        return (today - date.fromisoformat(d)).days / 30.4
    except ValueError:
        return None


def hard_filter(l, t, today):
    m = _months(l["date"], today) if l["date"] else None
    if l["kind"] == "startup":
        if m is None or m > t.get("max_months_since_filing", 18):
            return False
        y = l["signals"]["year_inc"]
        if y and y.isdigit() and int(y) < t.get("founded_after", 2019):
            return False
        if not y and l["signals"]["inc_choice"] == "overFiveYears":
            return False
        hi = t["round_size_usd"][1]
        if l["signals"]["round_amount"] and l["signals"]["round_amount"] > hi * 3:
            return False  # a later-stage round than this fund leads
        if t.get("geo_required") and l["state"] not in t["geo_required"]:
            return False
        if l["signals"].get("entity") not in t.get("entity_types", ["Corporation"]):
            return False  # venture-backed startups are almost always corporations; LLCs here are mostly vehicles
    elif l["kind"] == "builder" and m is not None and m > 12:
        return False
    return kw_count(l["company"] + " " + l["text"], t["keywords"]) > 0 or l["kind"] == "company" or l.get("industry") in t.get("industries", [])


def features(l, t, today, connections):
    s = l["signals"]
    m = _months(l["date"], today) if l["date"] else None
    lo, hi = t["round_size_usd"]
    stage = size_fit(s.get("round_amount"), lo, hi) if l["kind"] == "startup" else 0.85 if l["kind"] == "builder" else 0.6
    recency = 0.5 if m is None else 1.0 if m <= 3 else 0.8 if m <= 6 else 0.6 if m <= 12 else 0.3
    pref = t.get("geo_preferred", [])
    if not pref:
        geo = 1.0
    elif l.get("state"):
        geo = 1.0 if l.get("state") in pref else 0.4
    else:
        loc = l.get("location", "").lower()
        geo = 1.0 if any(re.search(r"\b" + re.escape(x) + r"\b", loc) for st in pref for x in STATES.get(st, []) + [st.lower()]) else 0.6
    text = f'{l["company"]} {l["text"]}' if l["kind"] != "startup" else l["company"]  # not the Form D industry label
    relevance = min(1.0, kw_count(text, t["keywords"]) / 3) * 0.7 + (0.3 if l.get("industry") in t.get("industries", []) else 0)
    if l["kind"] == "startup":
        traction = min(1.0, math.log1p(s["investors"] or 0) / math.log(30)) * 0.6 + (0.4 if (s["round_sold"] or 0) >= 0.5 * (s["round_amount"] or 1e18) else 0.15)
        founder = 1.0 if s["repeat_founders"] else 0.75 if s["backed_by"] else 0.45
    elif l["source"] == "GitHub":
        traction = min(1.0, math.log1p(s["stars_per_day"]) / math.log(200))
        founder = min(1.0, 0.3 + math.log1p(s.get("followers") or 0) / math.log(5000) * 0.7)
    elif l["source"] == "Show HN":
        traction = min(1.0, math.log1p(s["hn_points"]) / math.log(500))
        founder = 0.5
    elif l["source"] == "arXiv":
        traction, founder = 0.3, 0.45
    else:
        traction, founder = 0.4, 0.4
    if l.get("also"):
        founder = min(1.0, founder + 0.3)  # both building in public and raising
    warm, l["warm_why"] = 0.0, ""
    for c in connections:
        if l["person"] and person_key(c.get("First Name"), c.get("Last Name")) in {person_key(*p.split(" ", 1)) for p in l.get("people", [l["person"]]) if " " in p}:
            warm, l["warm_why"] = 1.0, f'You know {c["First Name"]} {c["Last Name"]}'
            break
        if l["company"] and c.get("Company") and _brand(c["Company"])[:1] == _brand(l["company"])[:1] and _brand(l["company"]):
            warm, l["warm_why"] = 0.6, f'{c["First Name"]} {c["Last Name"]} works at {c["Company"]}'
    l["features"] = {"stage_fit": round(stage, 3), "recency": recency, "geo": geo, "relevance": round(relevance, 3),
                     "traction": round(traction, 3), "founder": round(founder, 3), "warm": warm}


def penalty(l, t):
    text = " ".join([l["company"], l["text"], l.get("industry", "")] + [p["text"] for p in l.get("pages", [])])
    excl_n, kw_n = kw_count(text, t.get("exclusions", [])), kw_count(text, t["keywords"])
    excluded = "reads as " + ", ".join(k for k in t.get("exclusions", []) if kw_count(text, [k])) if excl_n >= 2 and excl_n > kw_n else ""
    conflicts = [c for c in t.get("portfolio", []) + t.get("competitors", []) if re.search(r"\b" + re.escape(c) + r"\b", text)]
    return excluded, conflicts


def stage_score(l, stage, weights):
    keys = [k for k in STAGE_FEATURES[stage] if k in l["features"]]
    total = sum(weights[k] for k in keys) or 1
    s = sum(weights[k] * l["features"][k] for k in keys) / total
    if l.get("excluded_by"):
        s *= 0.5
    if l.get("conflicts"):
        s *= 0.6  # a conflict for a fund is a portfolio overlap to review, not an automatic pass
    return round(s, 4)


def doc(l):
    label = "" if l["kind"] == "startup" else l.get("industry", "")  # Form D industry labels are generic; akta categories are not
    return " ".join([l["company"], l["person"], l["text"], label] + [p["text"] for p in l.get("pages", [])])
