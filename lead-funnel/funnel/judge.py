"""Claude reads each finalist's own pages and filings and judges fit with the founder's thesis.

Two ways to reach Claude Opus 5.5:
- "anthropic": the Anthropic API directly (ANTHROPIC_API_KEY). Schema-guaranteed output, effort control, refusal fallback.
- "nicrron": the Nicrron gateway (NICRRON_API_KEY), OpenAI-compatible. Output is requested as JSON and validated here.
"""
import hashlib
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
from pydantic import BaseModel, Field, ValidationError

MODEL = "claude-opus-5-5"
NICRRON_BASE = "https://api.nicrron.ai/v1"
NICRRON_MODEL = "anthropic/claude-opus-5-5"  # pinned; "nicrron/auto" could route to a different model each run


class Judgment(BaseModel):
    alignment: int = Field(description="1-5. 5 = their own words argue the founder's core belief; 3 = right sector, no shared belief; 1 = poor fit or no evidence")
    why: str = Field(description="Two sentences, specific to this firm, citing what they wrote or backed")
    quote: str = Field(description="One sentence copied exactly, character for character, from the firm's pages that best shows shared thinking. Empty string if none")
    quote_url: str = Field(description="URL of the page the quote came from, or empty")
    best_partner: str = Field(description="Name from the partner list most likely to champion this deal, or empty")
    shared_beliefs: list[str] = Field(description="Beliefs from the founder's list this firm visibly shares")
    concerns: list[str] = Field(description="Reasons this firm might pass: conflicts, stage mismatch, thin evidence")
    conflict: bool = Field(description="True if they back a direct competitor")


SYSTEM = """You match a founder's thesis to venture investors. The founder wants investors who think the way they do, not just investors in the right sector.
Judge only on the evidence given: the firm's own web pages, its fund filings and the startups its partners sit on the board of.
- Reward shared beliefs, especially contrarian ones, over generic sector overlap.
- The quote must be copied exactly from the pages provided. Never paraphrase it or write one yourself. If nothing fits, return an empty quote.
- Thin or missing evidence caps alignment at 2.
- The founder's past labels show their taste; weigh what they liked and disliked."""


def _firm_brief(f, max_chars=14000):
    seats = "\n".join(f'- {s["company"]} ({s["industry"]}, {s["date"]}) via {s["person"]}' for s in f["board_seats"][:25]) or "- none found"
    funds = "\n".join(f'- {x["name"]} filed {x["date"]}, target {x["amount"] and f"${x["amount"]/1e6:.0f}M" or "undisclosed"}' for x in f["funds"][:6]) or "- none in the last 2 years"
    port = "\n".join(f'- {p["company"]} ({p["round"]}, {p["date"]}{", lead" if p["lead"] else ""}): {p["news"][:160]}' for p in f.get("portfolio", [])[:25]) or "- not available"
    partners = ", ".join(f'{p["name"]} ({p["title"][:60]})' for p in list(f["people"].values())[:15]) or "unknown"
    pages, budget = [], max_chars
    for p in f.get("pages", []):
        chunk = p["text"][: max(0, budget)]
        if chunk:
            pages.append(f"=== PAGE {p['url']} ===\n{chunk}")
            budget -= len(chunk)
    return (f"FIRM: {f['name']} ({f.get('city') or ''} {f['state']}) website {f.get('website') or 'none'}\n"
            f"Private fund assets: {f['aum'] and f'${f["aum"]/1e6:.0f}M' or 'unknown'}\nRecent fund filings:\n{funds}\n"
            f"Partners on filings: {partners}\nBoard seats (startup Form D filings):\n{seats}\nInvestments (akta.pro):\n{port}\n\n" + ("\n\n".join(pages) or "No web pages available."))


def _taste(labels, firms_by_id):
    rows = []
    for fid, (label, note) in labels.items():
        f = firms_by_id.get(fid)
        if f:
            rows.append(f'- {"LIKED" if label > 0 else "DISLIKED"}: {f["name"]}' + (f" — {note}" if note else ""))
    return "\n".join(rows[-20:]) or "No labels yet."


def _verify_quote(j, f):
    """Drop quotes that are not literally in the evidence (pages, or a builder's repo/paper text)."""
    squash = lambda s: re.sub(r"\s+", " ", s).strip().lower()
    hay = squash(" ".join([p["text"] for p in f.get("pages", [])] + ([f["text"]] if f.get("kind") == "builder" else [])))
    j_ok = bool(j.quote) and squash(j.quote) in hay
    return {**j.model_dump(), "quote": j.quote if j_ok else "", "quote_verified": j_ok}


def provider():
    """JUDGE_PROVIDER picks explicitly; otherwise use whichever key is set, Anthropic first."""
    choice = os.environ.get("JUDGE_PROVIDER", "").strip().lower()
    if choice in ("anthropic", "nicrron"):
        return choice
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return "anthropic"
    if os.environ.get("NICRRON_API_KEY"):
        return "nicrron"
    return None


def _ask_anthropic(client, effort, user, schema=Judgment, system=SYSTEM):
    try:
        resp = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            output_format=schema,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.AuthenticationError:
        raise SystemExit("Anthropic API key was rejected. Check ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError:
        return None, "rate limited"
    except anthropic.APIStatusError as e:
        return None, f"API error {e.status_code}: {e.message[:120]}"
    except anthropic.APIConnectionError:
        return None, "network error"
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        return None, f"no judgment (stop_reason {resp.stop_reason})"
    return resp.parsed_output, None


def json_rules(schema):
    return "\n\nReply with one JSON object only, no prose or code fences, matching this JSON Schema:\n" + json.dumps(schema.model_json_schema())


def _parse_json(text, schema=Judgment):
    text = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    return schema.model_validate_json(text[start:end + 1] if start >= 0 else text)


class _Nicrron:
    """OpenAI-compatible chat completions on the Nicrron gateway.
    Tries strict json_schema output first; if the gateway rejects it, falls back to prompt-only JSON."""

    def __init__(self, schema=Judgment, system=SYSTEM, max_retries=2, stream=False):
        import openai
        self.schema, self.system, self.stream = schema, system, stream
        self.openai = openai
        self.client = openai.OpenAI(base_url=NICRRON_BASE, api_key=os.environ["NICRRON_API_KEY"], max_retries=max_retries, timeout=600)
        self.schema_ok = True
        schema = self.schema.model_json_schema()
        schema["additionalProperties"] = False
        self.response_format = {"type": "json_schema", "json_schema": {"name": "judgment", "strict": True, "schema": schema}}

    def _call(self, messages):
        kw = {"model": NICRRON_MODEL, "max_tokens": 16000, "messages": messages,
              "extra_headers": {"x-nicrron-cache": "false"}}  # the funnel keeps its own cache
        if self.stream:
            return self._streamed(kw)
        if self.schema_ok:
            try:
                return self.client.chat.completions.create(response_format=self.response_format, **kw)
            except self.openai.BadRequestError as e:
                if "response_format" not in str(e) and "json_schema" not in str(e):
                    raise
                self.schema_ok = False  # gateway or model doesn't take schemas; rely on the prompt
        return self.client.chat.completions.create(**kw)

    def _streamed(self, kw):
        """Long answers: stream so the gateway sees output early and doesn't time out waiting.
        Returns an object shaped like a non-streamed response."""
        import types
        extra = {"response_format": self.response_format} if self.schema_ok else {}
        try:
            stream = self.client.chat.completions.create(stream=True, **extra, **kw)
        except self.openai.BadRequestError as e:
            if not extra or ("response_format" not in str(e) and "json_schema" not in str(e)):
                raise
            self.schema_ok = False
            stream = self.client.chat.completions.create(stream=True, **kw)
        parts, finish = [], None
        for chunk in stream:
            if chunk.choices:
                parts.append(chunk.choices[0].delta.content or "")
                finish = chunk.choices[0].finish_reason or finish
        msg = types.SimpleNamespace(content="".join(parts))
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg, finish_reason=finish or "stop")])

    def ask(self, user):
        o = self.openai
        messages = [{"role": "system", "content": self.system + json_rules(self.schema)}, {"role": "user", "content": user}]
        try:
            for attempt in range(2):
                resp = self._call(messages)
                choice = resp.choices[0]
                text = choice.message.content or ""
                if choice.finish_reason == "length":
                    return None, "no judgment (hit max_tokens)"
                try:
                    return _parse_json(text, self.schema), None
                except (ValidationError, ValueError) as e:
                    if attempt:
                        return None, f"invalid JSON from gateway: {str(e)[:120]}"
                    messages += [{"role": "assistant", "content": text},
                                 {"role": "user", "content": f"That was not valid against the schema ({str(e)[:300]}). Reply with the corrected JSON object only."}]
        except o.AuthenticationError:
            raise SystemExit("Nicrron rejected the API key. Check NICRRON_API_KEY in lead-funnel/.env.")
        except o.NotFoundError as e:
            raise SystemExit(f"Nicrron could not find model {NICRRON_MODEL}: {str(e)[:200]}")
        except o.RateLimitError:
            return None, "rate limited (or out of Nicrron balance)"
        except o.APIStatusError as e:
            return None, f"Nicrron error {e.status_code}: {str(e)[:120]}"
        except o.APIConnectionError:
            return None, "network error"


def judge_all(firms, thesis_text, labels, firms_by_id, cache_dir: Path, effort="high", workers=6):
    which = provider()
    if which is None:
        raise SystemExit("No judge key: set ANTHROPIC_API_KEY or NICRRON_API_KEY in lead-funnel/.env.")
    if which == "anthropic":
        client = anthropic.Anthropic()
        ask, model_tag = (lambda user: _ask_anthropic(client, effort, user)), f"anthropic:{MODEL}:{effort}"
    else:
        nic = _Nicrron()
        ask, model_tag = nic.ask, f"nicrron:{NICRRON_MODEL}"  # effort isn't passed through the gateway
    taste = _taste(labels, firms_by_id)
    cache_dir.mkdir(parents=True, exist_ok=True)

    def one(f):
        brief = _firm_brief(f)
        key = hashlib.sha1((model_tag + thesis_text + taste + brief).encode()).hexdigest()[:20]
        path = cache_dir / f"{key}.json"
        if path.exists():
            return json.loads(path.read_text())
        judgment, err = ask(f"FOUNDER THESIS\n{thesis_text}\n\nFOUNDER'S PAST LABELS\n{taste}\n\nINVESTOR EVIDENCE\n{brief}")
        if err:
            return {"error": err}
        out = _verify_quote(judgment, f)
        out["alignment"] = max(1, min(5, out["alignment"]))
        out["provider"] = model_tag
        path.write_text(json.dumps(out))
        return out

    with ThreadPoolExecutor(workers) as pool:
        for f, j in zip(firms, pool.map(one, firms)):
            f["judgment"] = j
    return firms, which


# ---------- founder sourcing: a fund's thesis judged against a founder or startup ----------
class FounderJudgment(BaseModel):
    fit: int = Field(description="1-5 fit with the fund's thesis. 5 = building exactly what the fund's beliefs predict; 3 = right space, unclear angle; 1 = off-thesis or no evidence")
    founder_quality: int = Field(description="1-5 from the evidence: shipped work, traction, repeat founding, domain depth. 3 if unknown")
    why: str = Field(description="Two sentences on why this founder deserves (or doesn't deserve) a meeting, citing the evidence")
    quote: str = Field(description="One sentence copied exactly from the evidence (their site, repo or paper) that best shows the fit. Empty string if none")
    quote_url: str = Field(description="URL the quote came from, or empty")
    contact: str = Field(description="Best person to contact: a name from the evidence, or empty")
    what_they_build: str = Field(description="One plain sentence on what the company or project does")
    stage_read: str = Field(description="pre-company, pre-seed, seed, series A, later, or unknown")
    shared_beliefs: list[str] = Field(description="Beliefs from the fund's list this founder's work visibly supports")
    concerns: list[str] = Field(description="Reasons to pass or check: thin evidence, wrong stage, portfolio overlap, website may be a different company")
    conflict: bool = Field(description="True if it competes with a company in the fund's portfolio")


FOUNDER_SYSTEM = """You are a venture associate sourcing founders for a fund. You get the fund's thesis and beliefs and the public evidence on one founder or startup:
Form D filings, the company website, GitHub repos, Show HN launches or papers.
- Judge fit with the fund's specific beliefs, not just the sector.
- Judge founder quality only from evidence: shipped work, traction, repeat founding, domain depth. Do not reward polish or hype.
- The quote must be copied exactly from the evidence provided. Never paraphrase or invent one; return an empty quote if nothing fits.
- A website may have been guessed from the company name. If it does not look like the same company as the Form D filing, say so in concerns and judge without it.
- Thin evidence caps both scores at 2. The fund's past labels show its taste; weigh what it liked and disliked."""


def lead_brief(l, max_chars=12000):
    s = l.get("signals", {})
    facts = [f"Source: {l['source']} ({l['kind']}, {l['stage']})", f"Headline: {l['headline']}"]
    if l.get("company"):
        facts.append(f"Company: {l['company']}" + (f" · {l['industry']}" if l.get("industry") else ""))
    if l.get("person"):
        facts.append(f"People: {', '.join(l.get('people') or [l['person']])}")
    if l.get("location"):
        facts.append(f"Location: {l['location']}")
    if l["kind"] == "startup":
        facts.append(f"Incorporated: {s.get('year_inc') or 'not stated'}; filings: {s.get('filings')}; amount sold: {s.get('round_sold')}")
        if s.get("repeat_founders"):
            facts.append("Repeat founders (officers of another startup in the data): " + ", ".join(s["repeat_founders"]))
        if s.get("backed_by"):
            facts.append("Directors who are partners at venture firms: " + ", ".join(s["backed_by"]))
    if l.get("also"):
        facts.append(f"Also: {l['also']}")
    for m in l.get("more", [])[:5]:
        facts.append(f"Also: {m}")
    if l.get("website"):
        facts.append(f"Website: {l['website']}" + (f" ({l['website_note']})" if l.get("website_note") else ""))
    facts.append(f"Description: {l['text'][:2000]}")
    pages, budget = [], max_chars
    for p in l.get("pages", []):
        chunk = p["text"][: max(0, budget)]
        if chunk:
            pages.append(f"=== PAGE {p['url']} ===\n{chunk}")
            budget -= len(chunk)
    return "\n".join(facts) + "\n\n" + ("\n\n".join(pages) or "No web pages available.")


def judge_founders(leads, fund_text, labels, leads_by_id, cache_dir: Path, effort="high", workers=6):
    which = provider()
    if which is None:
        raise SystemExit("No judge key: set ANTHROPIC_API_KEY or NICRRON_API_KEY in lead-funnel/.env.")
    if which == "anthropic":
        client = anthropic.Anthropic()
        ask = lambda user: _ask_anthropic(client, effort, user, FounderJudgment, FOUNDER_SYSTEM)
        model_tag = f"anthropic:{MODEL}:{effort}"
    else:
        nic = _Nicrron(FounderJudgment, FOUNDER_SYSTEM)
        ask, model_tag = nic.ask, f"nicrron:{NICRRON_MODEL}"
    rows = []
    for lid, (label, note) in labels.items():
        l = leads_by_id.get(lid)
        if l:
            rows.append(f'- {"LIKED" if label > 0 else "DISLIKED"}: {l.get("person") or ""} / {l.get("company") or l["headline"]}' + (f" — {note}" if note else ""))
    taste = "\n".join(rows[-20:]) or "No labels yet."
    cache_dir.mkdir(parents=True, exist_ok=True)

    def one(l):
        brief = lead_brief(l)
        key = hashlib.sha1(("founders:" + model_tag + fund_text + taste + brief).encode()).hexdigest()[:20]
        path = cache_dir / f"{key}.json"
        if path.exists():
            return json.loads(path.read_text())
        judgment, err = ask(f"FUND THESIS\n{fund_text}\n\nFUND'S PAST LABELS\n{taste}\n\nFOUNDER EVIDENCE\n{brief}")
        if err:
            return {"error": err}
        out = _verify_quote(judgment, l)
        out["fit"], out["founder_quality"] = max(1, min(5, out["fit"])), max(1, min(5, out["founder_quality"]))
        out["provider"] = model_tag
        path.write_text(json.dumps(out))
        return out

    with ThreadPoolExecutor(workers) as pool:
        for l, j in zip(leads, pool.map(one, leads)):
            l["judgment"] = j
    return leads, which
