#!/usr/bin/env python3
"""Write every run's results so far into run_results.txt (or run_results_<thesis>.txt with --thesis).

  python export_results.py                                   results for thesis.toml
  python export_results.py --thesis thesis_example_vc_tools.toml

Free to run: it replays the latest funnel from cache with akta.pro and Nicrron/Anthropic blocked,
so it can attach firm names to each cached Claude judgment, then appends the reports and ledgers.
"""
import argparse
import csv
import glob
import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Block every paid service for the replay; a cache miss is reported instead of paid for.
_real = urllib.request.urlopen
def _guard(req, *a, **k):
    url = getattr(req, "full_url", req)
    if "akta.pro" in url:
        raise RuntimeError("blocked: akta.pro call during export")
    return _real(req, *a, **k)
urllib.request.urlopen = _guard

sys.path.insert(0, str(HERE))
import run  # noqa: E402
from funnel import judge  # noqa: E402

misses = []
judge._Nicrron.ask = lambda self, user: (misses.append(1), (None, "not judged (cache miss, export makes no paid calls)"))[1]
judge._ask_anthropic = lambda client, effort, user: (misses.append(1), (None, "not judged (cache miss, export makes no paid calls)"))[1]

# Session history: runs made before this file existed (their outputs were overwritten by later runs).
HISTORY = """
RUN HISTORY (24 Oct 2026, example thesis: "AI-native workflow software for venture investors and LPs")
=====================================================================================================

Run 1 · free sources only (no Akta, no Claude)
  12,008 firms -> 8,526 pass hard filters -> 1,000 sourced -> 200 screened -> 50 deep -> 15 shortlist
  Shortlist: 1 Vertical Venture Partners, 2 Companyon Ventures, 3 Reformation Management, 4 Prudence,
  5 Khosla Ventures, 6 Theory Ventures, 7 Kickstart Capital, 8 Mairs & Power, 9 Construct Capital,
  10 Volta Energy Technologies, 11 Afore Capital, 12 Angular Ventures, 13 NSV Management,
  14 Cottonwood Wealth Strategies, 15 Castle Island Ventures
  Problems found: Khosla's size came from a $30M side vehicle; "wealth"/"asset management" keywords
  pulled in wealth managers. Both fixed before run 2.

Run 2 · free sources, after the fund-size and keyword fixes
  Shortlist: 1 Vertical Venture Partners, 2 Companyon Ventures, 3 Scop Ventures, 4 Reformation Management,
  5 Scout VC, 6 Prudence, 7 Volta Energy Technologies, 8 Kickstart Capital, 9 NSV Management,
  10 Collide Capital, 11 Steel Atlas Management, 12 Afore Capital, 13 Theory Ventures, 14 Mairs & Power,
  15 Navitas Capital

Run 3 · label-learning test (5 throwaway labels, deleted afterwards)
  Labels: yes = Theory Ventures, Vertical Venture Partners, Companyon; no = Mairs & Power, Volta Energy
  Result: both "no" firms left the top 15; Theory Ventures rose from #13 to #3.
  Learned weights (17% blend): size .12, recency .08, geo .20, seats .04, text .21, board .20, warm .08, claude .25
  Geography was over-weighted from so few labels, so the learner was made more cautious (C=0.3).

Run 4 · free sources, clean (no labels)
  12,008 -> 9,083 pass hard filters -> 1,000 -> 200 -> 50 -> 15

Run 5 · first full run: Akta + Claude Opus 5.5 via Nicrron
  Akta: 22 new calls, 210 credits, portfolio data available. Claude: 50 of 50 judged.
  Judgments: 11 scored 1/5, 22 scored 2/5, 17 scored 3/5, none above 3. 19 quotes verified on page. 0 conflicts.
  Shortlist: 1 Scop Ventures, 2 Vertical Venture Partners, 3 Theory Ventures, 4 Reformation Management,
  5 Companyon Ventures, 6 Nyca Management, 7 TTV Capital, 8 Emergent Ventures, 9 Afore Capital,
  10 Kickstart Capital, 11 Deviation Capital, 12 Grit Capital Partners, 13 Caffeinated Capital,
  14 Cervin Ventures, 15 Steel Atlas Management

Run 6 · rerun to fix report formatting (unintended spend)
  Akta: 25 new calls, 195 credits (the per-run limit enriched the next 20 firms instead of reusing the first).
  Nicrron: 17 firms re-judged because their Akta data changed. This led to the spending cap and ledger.

Run 7 · repeat after the Akta fix: 0 new Akta calls, 0 new judgments (all from cache). Same shortlist as below.
Run 8 · dry run with Akta and Nicrron blocked: 0 paid calls.

Spend so far: Akta about 405 credits by this tool (625 recorded as used this month, per the user's dashboard);
Nicrron 67 judgments (estimated $3-4).
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thesis", default="thesis.toml", metavar="PATH")
    thesis_arg = ap.parse_args().thesis
    run.load_env()
    th = run.Thesis(thesis_arg)
    OUT = HERE / ("run_results.txt" if th.name == "thesis" else f"run_results_{th.name}.txt")
    sys.argv = ["run.py", "rank", "--thesis", str(th.path)]
    captured = {}
    real_report = run.write_report

    def capture(path, t, counts, notes, wnote, weights, shortlist, conflicted, labels):
        captured.update(t=t, counts=counts, notes=notes, wnote=wnote, weights=weights, shortlist=shortlist, conflicted=conflicted)
        return real_report(path, t, counts, notes, wnote, weights, shortlist, conflicted, labels)
    run.write_report = capture
    real_judge = judge.judge_all

    def judge_capture(firms, *a, **k):
        res = real_judge(firms, *a, **k)
        captured["deep"] = list(firms)
        return res
    judge.judge_all = judge_capture
    run.main()

    L = [f"LEAD FUNNEL · ALL RESULTS SO FAR", f"Exported {datetime.now():%Y-%m-%d %H:%M}. Thesis: {th.path}", ""]
    if th.name == "thesis_example_vc_tools":
        L += [HISTORY.strip(), ""]  # session history belongs to this thesis
    L += ["", "LATEST RUN · FUNNEL", "=" * 60]
    L += [f"  {n:>7,}  {label}" for label, n in captured["counts"]]
    L += [""] + [f"  - {n}" for n in captured["notes"]] + [f"  - Weights: {captured['wnote']}"]

    L += ["", "", "LATEST RUN · ALL 50 FINALISTS WITH CLAUDE JUDGMENTS (best first)", "=" * 60]
    for i, f in enumerate(sorted(captured.get("deep", []), key=lambda f: -f["score"]), 1):
        j = f.get("judgment") or {}
        partner = (f.get("partner") or ("", ""))[0]
        L.append(f"\n{i:>2}. {f['name']} ({f.get('city') or ''} {f['state']})  score {f['score']:.3f}"
                 + (f"  alignment {j['alignment']}/5" if "alignment" in j else "") + ("  [dropped: conflict]" if f.get("conflicts") else ""))
        L.append(f"    website: {f.get('website') or '-'}   partner: {partner or j.get('best_partner') or '-'}")
        if j.get("why"):
            L.append(f"    why: {j['why']}")
        if j.get("quote"):
            L.append(f"    quote ({'verified' if j.get('quote_verified') else 'unverified'}): \"{j['quote']}\"  <- {j.get('quote_url')}")
        if j.get("shared_beliefs"):
            L.append("    shared beliefs: " + "; ".join(j["shared_beliefs"]))
        if j.get("concerns"):
            L.append("    concerns: " + "; ".join(j["concerns"]))
        if j.get("error"):
            L.append(f"    judgment: {j['error']}")
        L.append("    features: " + ", ".join(f"{k} {v:.2f}" for k, v in f["features"].items()))

    used = {json.dumps(f.get("judgment"), sort_keys=True) for f in captured.get("deep", [])}
    older = [json.loads(Path(p).read_text()) for p in sorted(glob.glob(str(HERE / "data/judge/*.json")))]
    older = [j for j in older if json.dumps(j, sort_keys=True) not in used]
    L += ["", "", f"SUPERSEDED CLAUDE JUDGMENTS ({len(older)}, from run 5 before the firms' Akta data changed)", "=" * 60]
    for j in older:
        L.append(f"- alignment {j.get('alignment')}/5 · partner {j.get('best_partner') or '-'} · {j.get('why', '')}")

    L += ["", "", "AKTA.PRO LEDGER AND ENRICHED FIRMS", "=" * 60]
    from funnel import akta
    led = akta.Ledger(HERE / "data/akta")
    L.append(f"Credits used this month: {led.used():g} of {akta.MONTHLY_CREDITS:g} (reserve {akta.RESERVE_CREDITS:g}, usable left {led.left():g})")
    for e in led.data["entries"]:
        L.append(f"  {e['at']}  {e['credits']:>7.1f}  {e['note']}")
    for p in sorted(glob.glob(str(HERE / "data/akta/enrich-*.json"))):
        d = (json.loads(Path(p).read_text()).get("data") or {})
        fm, inv = d.get("firmographic") or {}, (d.get("mna_and_investment") or {}).get("investment") or []
        L.append(f"  - {fm.get('name', '?')} ({fm.get('website', '')}): {len(inv)} investments on record. {(fm.get('company_description_short') or '')[:160]}")

    L += ["", "", f"LATEST SHORTLIST ({th.out / 'shortlist.csv'})", "=" * 60]
    L += [",".join(r) for r in csv.reader(open(th.out / "shortlist.csv"))]
    L += ["", "", f"LATEST REPORT ({th.out / 'report.md'})", "=" * 60, (th.out / "report.md").read_text()]
    if misses:
        L.insert(2, f"NOTE: {len(misses)} finalists had no cached judgment, so they show 'not judged'. No paid calls were made.")
    OUT.write_text("\n".join(L) + "\n")
    print(f"\nWrote {OUT} ({OUT.stat().st_size // 1024} KB). Paid calls made: 0. Judgment cache misses: {len(misses)}.")


if __name__ == "__main__":
    main()
