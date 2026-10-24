"""Founder dossiers for the final shortlist, and a chatbot that answers a VC's questions from them.

`run.py dossier` gathers more evidence on each shortlisted founder (mostly free sources), then Claude
(via Nicrron or Anthropic) writes one structured, sourced dossier per founder. Every fact must cite a
source from the evidence; facts citing anything else are dropped. Output:
  out/founders/<fund>/dossiers/<lead id>.json   one per founder
  out/founders/<fund>/dossiers.json             all of them, for a chatbot

`run.py chat` loads dossiers.json and lets the VC ask questions, answered only from the dossiers.
"""
import hashlib
import json
import os
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from . import builders, judge
from .sec import person_key
from .web import site_pages


# ---------- dossier schema ----------
class Fact(BaseModel):
    fact: str = Field(description="One specific, checkable statement")
    source: str = Field(description="The SOURCE id from the evidence, e.g. S3, that supports it")


class BeliefFit(BaseModel):
    belief: str = Field(description="One of the fund's beliefs, copied as written")
    verdict: Literal["supports", "neutral", "contradicts", "unknown"]
    evidence: str = Field(description="Why, in one or two sentences")
    source: str = Field(description="SOURCE id, or empty if verdict is unknown")


class Person(BaseModel):
    name: str
    role: str = Field(description="Their role at the company, from the evidence")
    location: str
    links: list[str] = Field(description="Profile, company or code URLs from the evidence")


class Company(BaseModel):
    name: str
    what_they_build: str
    customers: str = Field(description="Who they sell to, from the evidence, or 'unknown'")
    stage: str = Field(description="pre-company, pre-seed, seed, series A, later, or unknown")
    raised: str = Field(description="Funding facts from filings or the site, or 'unknown'")
    website: str


class Dossier(BaseModel):
    summary: str = Field(description="Three sentences a partner reads first: who, what, why this fund should care or not")
    person: Person
    co_founders: list[str] = Field(description="Other founders or officers named in the evidence")
    company: Company
    background: list[Fact] = Field(description="Career, education, prior companies, domain experience")
    founder_signals: list[Fact] = Field(description="Shipped work, traction, repeat founding, public building")
    thesis_fit: list[BeliefFit] = Field(description="One entry per fund belief")
    fit_score: int = Field(description="1-5 overall fit with the fund's thesis")
    strengths: list[str]
    risks: list[str]
    open_questions: list[str] = Field(description="Questions the VC should ask on the first call, specific to this founder")
    conversation_openers: list[str] = Field(description="Two or three ways to open the outreach that reference their actual work")
    unknowns: list[str] = Field(description="Important things the evidence could not answer")
    confidence: Literal["low", "medium", "high"] = Field(description="How much evidence there is")


SYSTEM = """You prepare founder dossiers for a venture fund. You get the fund's thesis and beliefs and a numbered list of evidence about one founder (SOURCE S1, S2, ...): SEC filings, company web pages, GitHub, Hacker News, papers and data-provider profiles.
- Use only the evidence. Every fact cites the SOURCE id it comes from. Never use outside knowledge about the person, and never guess.
- If sources disagree, or a website may belong to a different company, say so in risks.
- Be concrete: names, products, customers, numbers, dates.
- Questions and openers must be specific to this founder's work, not generic.
- Leave things unknown rather than inventing them; list the important gaps in unknowns."""


# ---------- evidence ----------
MAX_SOURCE, MAX_TOTAL = 3000, 14000  # smaller requests finish reliably through the gateway


def _src(sources, label, url, text):
    text = re.sub(r"\s+", " ", text or "").strip()
    used = sum(len(s["text"]) for s in sources)
    if text and used < MAX_TOTAL:
        sources.append({"id": f"S{len(sources) + 1}", "label": label, "url": url, "text": text[: min(MAX_SOURCE, MAX_TOTAL - used)]})


def gather(lead, data: Path, startups_by_key, akta_client=None):
    """Evidence for one founder, as numbered sources. Free unless an akta.pro client is passed."""
    S = []
    _src(S, "Shortlist record", lead.get("url", ""), json.dumps({k: lead.get(k) for k in
         ("person", "people", "company", "location", "industry", "headline", "stage", "signals", "also")}, default=str))
    # The earlier screening judgment is Claude's own summary, not evidence, so it is not a source here.
    # Other startups the same people are officers of, from Form D
    for name in lead.get("people", [])[:4]:
        if " " not in name:
            continue
        first, last = name.split(" ", 1)
        for c in startups_by_key.get(person_key(first, last.split()[-1]), []):
            # Same name in another state is usually a different person (common names match strangers)
            if c["company"] != lead["company"] and (not lead.get("state") or c["state"] == lead.get("state")):
                filings = "; ".join(f'{f["date"]}: {f["industry"]}, offered {f["amount"]}, sold {f["sold"]}, {f["investors"]} investors' for f in c["filings"][:4])
                _src(S, f"Form D name match (same name and state, may still be a different person): {name} is an officer of {c['company']}", f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={c["cik"]}',
                     f'{c["company"]} ({c["city"]}, {c["state"]}, incorporated {c["year_inc"] or "n/a"}). Officers: {", ".join(o["name"] for o in c["officers"])}. Filings: {filings}')
    # This company's own filing history
    keys = lead.get("officer_keys") or [person_key(n.split(" ", 1)[0], n.split()[-1]) for n in lead.get("people", []) if " " in n]
    own = next((c for k in keys for c in startups_by_key.get(k, []) if c["company"] == lead["company"]), None)
    if own:
        _src(S, f"Form D filings for {lead['company']}", lead.get("url", ""), "; ".join(
            f'{f["date"]}: {f["industry"]}, offered {f["amount"]}, sold {f["sold"]}, {f["investors"]} investors, first sale {f["first_sale"]}' for f in own["filings"]))
    # Company website: home plus team/about/blog pages (cached)
    if lead.get("website"):
        try:
            for p in site_pages({"id": lead["id"], "website": lead["website"]}, data / "web", deep=True):
                _src(S, "Company web page" + (f" ({lead.get('website_note')})" if lead.get("website_note") else ""), p["url"], p.get("text", ""))
        except Exception:
            pass
    cache = data / "signals"
    handle = lead.get("handle") or (lead.get("contact") or "").rstrip("/").split("/")[-1].split("id=")[-1]
    lead = {**lead, "handle": handle}
    if lead["source"] == "GitHub" and lead.get("handle"):
        try:
            u = builders._get_json(f"https://api.github.com/users/{lead['handle']}", cache=cache, ttl=7 * 86400)
            repos = builders._get_json(f"https://api.github.com/users/{lead['handle']}/repos?sort=updated&per_page=30", cache=cache, ttl=86400)
            top = sorted(repos, key=lambda r: -r.get("stargazers_count", 0))[:8] if isinstance(repos, list) else []
            _src(S, "GitHub profile", f"https://github.com/{lead['handle']}", f'{u.get("name")} · {u.get("bio")} · company {u.get("company")} · {u.get("location")} · '
                 f'followers {u.get("followers")} · joined {str(u.get("created_at"))[:10]} · repos: ' + "; ".join(f'{r["name"]} ({r["stargazers_count"]}★): {r.get("description") or ""}' for r in top))
        except Exception:
            pass
    if lead["source"] == "Show HN" and lead.get("handle"):
        try:
            u = builders._get_json(f"https://hn.algolia.com/api/v1/users/{lead['handle']}", cache=cache, ttl=7 * 86400)
            _src(S, "Hacker News profile", f"https://news.ycombinator.com/user?id={lead['handle']}", f'karma {u.get("karma")}; about: {u.get("about") or ""}')
        except Exception:
            pass
    if lead["source"] == "arXiv" and lead.get("person"):
        try:
            q = urllib.parse.quote(f'au:"{lead["person"]}"')
            raw = builders._get_json(f"https://export.arxiv.org/api/query?search_query={q}&sortBy=submittedDate&max_results=10", cache=cache).get("raw", "")
            titles = re.findall(r"<entry>[\s\S]*?<title>([\s\S]*?)</title>", raw)
            _src(S, f"arXiv papers by {lead['person']}", f"https://arxiv.org/a/{urllib.parse.quote(lead['person'])}", "; ".join(re.sub(r"\s+", " ", t) for t in titles))
        except Exception:
            pass
    if akta_client and lead.get("website"):
        try:
            res = akta_client.company_sections(lead["website"], ["management_profile"])
            _src(S, "akta.pro management profile", f"akta.pro ({lead['website']})", json.dumps((res.get("data") or {}).get("management_profile"), default=str))
        except Exception as e:
            _src(S, "akta.pro management profile (not available)", "", str(e)[:200])
    return S


def evidence_text(S):
    return "\n\n".join(f"SOURCE {s['id']} · {s['label']} · {s['url'] or 'no url'}\n{s['text']}" for s in S)


def _clean(d: Dossier, S):
    """Drop facts whose SOURCE id isn't in the evidence, and attach the real URL for each cited source."""
    ids = {s["id"]: s for s in S}
    out = d.model_dump()
    dropped = 0
    for key in ("background", "founder_signals"):
        kept = []
        for f in out[key]:
            if f["source"] in ids:
                kept.append({**f, "url": ids[f["source"]]["url"], "source_label": ids[f["source"]]["label"]})
            else:
                dropped += 1
        out[key] = kept
    for b in out["thesis_fit"]:
        if b["source"] in ids:
            b["url"] = ids[b["source"]]["url"]
        elif b["verdict"] != "unknown":
            b["verdict"], b["source"] = "unknown", ""
            dropped += 1
    out["fit_score"] = max(1, min(5, out["fit_score"]))
    out["sources"] = [{"id": s["id"], "label": s["label"], "url": s["url"]} for s in S]
    out["dropped_unsourced_facts"] = dropped
    return out


# ---------- build ----------
def build(th, t, data: Path, ids, leads_by_id, akta_client=None, workers=2):
    which = judge.provider()
    if which is None:
        raise SystemExit("No Claude key: set NICRRON_API_KEY or ANTHROPIC_API_KEY in lead-funnel/.env.")
    if which == "anthropic":
        import anthropic
        client = anthropic.Anthropic()
        ask = lambda user: judge._ask_anthropic(client, t.get("run", {}).get("judge_effort", "high"), user, Dossier, SYSTEM)
        tag = f"anthropic:{judge.MODEL}"
    else:
        nic = judge._Nicrron(Dossier, SYSTEM, max_retries=1, stream=True)  # long answers time out unstreamed
        ask, tag = nic.ask, f"nicrron:{judge.NICRRON_MODEL}"
    startups = json.loads((data / "startups.json").read_text())["startups"]
    by_key = {}
    for c in startups:
        for o in c["officers"]:
            by_key.setdefault(o["key"], []).append(c)
    fund = f"Fund: {t.get('fund_name', '')}\n{t['one_liner']}\n{t['thesis'].strip()}\nBeliefs:\n" + "\n".join(f"- {b}" for b in t["beliefs"])
    outdir = th.out / "dossiers"
    outdir.mkdir(parents=True, exist_ok=True)
    cache = data / "dossier_cache"
    cache.mkdir(parents=True, exist_ok=True)

    def one(lid):
        lead = leads_by_id[lid]
        S = gather(lead, data, by_key, akta_client)
        ev = evidence_text(S)
        key = hashlib.sha1((tag + fund + ev).encode()).hexdigest()[:20]
        cp = cache / f"{key}.json"
        if cp.exists():
            out = json.loads(cp.read_text())
        else:
            d, err = ask(f"FUND\n{fund}\n\nFOUNDER EVIDENCE ({len(S)} sources)\n{ev}")
            if err:
                return lid, {"error": err}, len(S)
            out = _clean(d, S)
            out["provider"] = tag
            cp.write_text(json.dumps(out))
        out = {"lead_id": lid, "rank": ids.index(lid) + 1, "screening_score": lead["score"], "generated": date.today().isoformat(), **out}
        (outdir / (re.sub(r"[^A-Za-z0-9_-]", "_", lid) + ".json")).write_text(json.dumps(out, indent=2))
        return lid, out, len(S)

    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(one, ids))
    good = [r[1] for r in results if "error" not in r[1]]
    bundle = {"fund": t.get("fund_name", ""), "thesis": t["one_liner"], "beliefs": t["beliefs"], "generated": date.today().isoformat(),
              "how_to_use": "Each founder entry is a sourced dossier. Answer the VC only from these entries and cite source ids/urls.",
              "founders": sorted(good, key=lambda d: d["rank"])}
    (th.out / "dossiers.json").write_text(json.dumps(bundle, indent=2))
    return results


# ---------- chat ----------
CHAT_SYSTEM = """You are an analyst assistant for a venture fund. You help the partner decide which founders to meet and how.
Answer only from the founder dossiers provided; each fact has a source. Cite the founder and source URL when you state a fact.
If the dossiers don't answer something, say so and suggest what to ask the founder. Be direct and brief; compare founders when asked.
Items marked "unverified" rest on an earlier AI screening, not primary evidence; say so if you use them.
Do not invent facts about anyone."""


def _index(bundle):
    return "\n".join(f'#{d["rank"]} {d["person"]["name"]} · {d["company"]["name"]} · fit {d["fit_score"]}/5 · {d["summary"][:240]}' for d in bundle["founders"])


def compact(d):
    """A founder's dossier without the long lists, for questions that span the whole shortlist."""
    return {"rank": d["rank"], "summary": d["summary"], "person": {k: d["person"][k] for k in ("name", "role", "location")},
            "company": d["company"], "fit_score": d["fit_score"], "confidence": d["confidence"],
            "thesis_fit": [{k: b.get(k, "") for k in ("belief", "verdict", "evidence", "url")} for b in d["thesis_fit"]],
            "strengths": d["strengths"][:4], "risks": d["risks"][:4],
            "key_facts": [{"fact": f["fact"], "url": f.get("url", "")} for f in (d["founder_signals"] + d["background"])[:6]]}


def _relevant(bundle, question, last):
    q = question.lower()
    hits = [d for d in bundle["founders"] if any(w and w in q for w in
            [d["person"]["name"].lower(), d["person"]["name"].split()[-1].lower(), d["company"]["name"].lower().split()[0].strip(",.")])
            or re.search(rf"#?\b{d['rank']}\b", q)]
    return hits or last or bundle["founders"][:3]


def _named(bundle, question):
    q = question.lower()
    return [d for d in bundle["founders"] if any(w and w in q for w in
            [d["person"]["name"].lower(), d["person"]["name"].split()[-1].lower(), d["company"]["name"].lower().split()[0].strip(",.")])
            or re.search(rf"#{d['rank']}\b", q)]


def reply(history, question, bundle, last, complete):
    """Named founders get their full dossiers. A question naming nobody (e.g. 'who fits belief X?') gets a
    compact dossier for every founder, so the answer covers the whole shortlist."""
    named = _named(bundle, question)
    if named:
        focus, body = named, "FULL DOSSIERS FOR THE FOUNDERS IN THIS QUESTION\n" + json.dumps(named, indent=1)[:90000]
    elif last and re.search(r"\b(they|them|their|he|she|his|her|this one|that one|both|those)\b", question.lower()):
        focus, body = last, "FULL DOSSIERS FOR THE FOUNDERS BEING DISCUSSED\n" + json.dumps(last, indent=1)[:90000]
    else:
        focus = bundle["founders"]
        body = "COMPACT DOSSIERS FOR ALL FOUNDERS (ask about one by name for the full dossier)\n" + json.dumps([compact(d) for d in focus], separators=(",", ":"))
    context = (f"FUND: {bundle['fund']} · {bundle['thesis']}\nBELIEFS: " + "; ".join(bundle["beliefs"]) + f"\n\n{body}")
    messages = history + [{"role": "user", "content": f"{context}\n\nQUESTION: {question}"}]
    return complete(CHAT_SYSTEM, messages), focus


def completer():
    """A plain text completion function for the configured provider."""
    which = judge.provider()
    if which == "anthropic":
        import anthropic
        client = anthropic.Anthropic()

        def complete(system, messages):
            r = client.messages.create(model=judge.MODEL, max_tokens=4000, system=system, messages=messages,
                                       output_config={"effort": "medium"})
            return "".join(b.text for b in r.content if b.type == "text")
        return complete, f"Anthropic {judge.MODEL}"
    if which == "nicrron":
        import openai
        client = openai.OpenAI(base_url=judge.NICRRON_BASE, api_key=os.environ["NICRRON_API_KEY"], timeout=300)

        def complete(system, messages):
            r = client.chat.completions.create(model=judge.NICRRON_MODEL, max_tokens=4000, messages=[{"role": "system", "content": system}] + messages,
                                               extra_headers={"x-nicrron-cache": "false"})
            return r.choices[0].message.content or ""
        return complete, f"Nicrron {judge.NICRRON_MODEL}"
    raise SystemExit("No Claude key: set NICRRON_API_KEY or ANTHROPIC_API_KEY in lead-funnel/.env.")
