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


def _verify_quote(j: Judgment, f):
    """Drop quotes that are not literally on the firm's pages, so every quote in the report is real."""
    squash = lambda s: re.sub(r"\s+", " ", s).strip().lower()
    hay = squash(" ".join(p["text"] for p in f.get("pages", [])))
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


def _ask_anthropic(client, effort, user):
    try:
        resp = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            output_format=Judgment,
            system=SYSTEM,
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


JSON_RULES = ("\n\nReply with one JSON object only, no prose or code fences, matching this JSON Schema:\n"
              + json.dumps(Judgment.model_json_schema()))


def _parse_json(text):
    text = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    return Judgment.model_validate_json(text[start:end + 1] if start >= 0 else text)


class _Nicrron:
    """OpenAI-compatible chat completions on the Nicrron gateway.
    Tries strict json_schema output first; if the gateway rejects it, falls back to prompt-only JSON."""

    def __init__(self):
        import openai
        self.openai = openai
        self.client = openai.OpenAI(base_url=NICRRON_BASE, api_key=os.environ["NICRRON_API_KEY"], max_retries=2, timeout=600)
        self.schema_ok = True
        schema = Judgment.model_json_schema()
        schema["additionalProperties"] = False
        self.response_format = {"type": "json_schema", "json_schema": {"name": "judgment", "strict": True, "schema": schema}}

    def _call(self, messages):
        kw = {"model": NICRRON_MODEL, "max_tokens": 16000, "messages": messages,
              "extra_headers": {"x-nicrron-cache": "false"}}  # the funnel keeps its own cache
        if self.schema_ok:
            try:
                return self.client.chat.completions.create(response_format=self.response_format, **kw)
            except self.openai.BadRequestError as e:
                if "response_format" not in str(e) and "json_schema" not in str(e):
                    raise
                self.schema_ok = False  # gateway or model doesn't take schemas; rely on the prompt
        return self.client.chat.completions.create(**kw)

    def ask(self, user):
        o = self.openai
        messages = [{"role": "system", "content": SYSTEM + JSON_RULES}, {"role": "user", "content": user}]
        try:
            for attempt in range(2):
                resp = self._call(messages)
                choice = resp.choices[0]
                text = choice.message.content or ""
                if choice.finish_reason == "length":
                    return None, "no judgment (hit max_tokens)"
                try:
                    return _parse_json(text), None
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
