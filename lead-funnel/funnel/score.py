"""The funnel: universe -> sourced (~1000) -> 200 -> 50 -> shortlist (10-20).

Every stage is a weighted sum of features in [0, 1]. Your yes/no labels tune it two ways:
1. The thesis profile moves toward the language of firms you liked and away from ones you didn't (Rocchio).
2. Feature weights are refit with logistic regression on your labels, blended with the defaults
   until you have about 30 labels.
"""
import csv
import math
import re
from datetime import date

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics.pairwise import cosine_similarity

from .sec import brand, person_key

FEATURES = ["size_fit", "recency", "geo", "seats", "text_sim", "board_fit", "warm", "claude"]
DEFAULT_WEIGHTS = {"size_fit": .15, "recency": .10, "geo": .05, "seats": .05, "text_sim": .25, "board_fit": .20, "warm": .10, "claude": .30}
STAGE_FEATURES = {
    "source": ["size_fit", "recency", "geo", "seats", "board_fit"],
    "screen": ["size_fit", "recency", "geo", "seats", "text_sim", "board_fit"],
    "deep": ["size_fit", "recency", "geo", "seats", "text_sim", "board_fit", "warm"],
    "final": FEATURES,
}


# ---------- thesis and labels ----------
def thesis_text(t):
    parts = [t["one_liner"], t["thesis"], "Beliefs: " + " ".join(t.get("beliefs", [])), "Keywords: " + ", ".join(t.get("keywords", []))]
    return "\n".join(parts)


def load_labels(path):
    labels = {}
    if path.exists():
        for r in csv.DictReader(open(path)):
            labels[r["firm_id"]] = (1 if r["label"].strip().lower() in ("1", "yes", "y", "like") else -1, r.get("note", ""))
    return labels


def load_connections(path):
    """LinkedIn export (Settings > Data privacy > Get a copy of your data > Connections.csv)."""
    if not path.exists():
        return []
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith("First Name")), 0)
    return list(csv.DictReader(lines[start:]))


# ---------- features ----------
VEHICLE = re.compile(r"\b(spv|series|co-?invest|coinvest|opportunit|annex|parallel|feeder|sidecar|select|continuation)\b", re.I)


def fund_size(f):
    """Size of the firm's main fund: the largest recent non-vehicle fund, else assets per fund from Form ADV."""
    main = [x["amount"] for x in f["funds"][:12] if x["amount"] and x["amount"] >= 5e6 and not VEHICLE.search(x["name"])]
    per_fund = f["aum"] / max(1, f["n_vc_funds"]) if f["aum"] else None
    if main:
        return max(max(main), per_fund or 0)  # a big platform's flagship is larger than its newest side fund
    return per_fund


def size_fit(size, lo, hi):
    if size is None:
        return 0.5
    if lo <= size <= hi:
        return 1.0
    gap = math.log(lo / size) if size < lo else math.log(size / hi)
    return round(math.exp(-gap), 3)


def recency(f, today):
    if not f["funds"] or not f["funds"][0]["date"]:
        return 0.4  # adviser with no recent filing: unknown, not dead
    months = (today - date.fromisoformat(f["funds"][0]["date"])).days / 30.4
    return 1.0 if months <= 12 else 0.7 if months <= 24 else 0.4


def seats_score(f):
    return min(1.0, math.log1p(len(f["board_seats"])) / math.log(11))


def board_fit(f, t):
    """Share of the firm's known portfolio in the founder's space: board seats from Form D, plus
    akta.pro investments when available (matched on keywords in the company name and deal news)."""
    seats, port = f["board_seats"], f.get("portfolio", [])
    if not seats and not port:
        return 0.0
    inds = set(t.get("industries", []))
    kw = t.get("keywords", [])
    hits = sum(1 for s in seats if s["industry"] in inds) + sum(1 for s in seats if kw_count(s["company"], kw))
    hits += sum(1 for p in port if kw_count(p["company"] + " " + p["news"], kw))
    n = len(seats) + len(port)
    return round(min(1.0, hits / max(3, n)) * min(1.0, n / 3 + 0.34), 3)


def warm_path(f, connections):
    """1.0 if you know a partner by name, 0.6 if you know someone at the firm."""
    if not connections:
        return 0.0, ""
    people = f["people"]
    fb = brand(f["name"])
    best, why = 0.0, ""
    for c in connections:
        if person_key(c.get("First Name"), c.get("Last Name")) in people:
            return 1.0, f'You know {c["First Name"]} {c["Last Name"]} directly'
        cb = brand(c.get("Company", ""))
        if fb and cb and cb[0] == fb[0] and best < 0.6:
            best, why = 0.6, f'{c["First Name"]} {c["Last Name"]} ({c.get("Position", "")}) works there'
    return best, why


def text_of(f):
    return " ".join([f["name"], " ".join(x["name"] for x in f["funds"][:5]), " ".join(s["company"] for s in f["board_seats"]),
                     " ".join(p["company"] + " " + p["news"] for p in f.get("portfolio", []))]
                    + [p["text"] for p in f.get("pages", [])])


def kw_count(text, words):
    """Whole-word, case-insensitive keyword occurrences."""
    return sum(len(re.findall(r"\b" + re.escape(w.lower()) + r"\b", text.lower())) for w in words)


def penalty(f, t):
    """(exclusion reason, hard conflicts, possible conflicts).
    A site is off-thesis only when excluded areas clearly dominate its language, not when it mentions one.
    A competitor in the portfolio is a hard conflict; a capitalised mention on the website is flagged for review."""
    text = text_of(f)
    excl_n, kw_n = kw_count(text, t.get("exclusions", [])), kw_count(text, t.get("keywords", []))
    excluded = f"focus reads as {', '.join(k for k in t.get('exclusions', []) if kw_count(text, [k]))}" if excl_n >= 3 and excl_n > 2 * kw_n else ""
    names = " | ".join([s["company"] for s in f["board_seats"]] + [p["company"] for p in f.get("portfolio", [])])
    comps = t.get("competitors", [])
    hard = [c for c in comps if re.search(r"\b" + re.escape(c) + r"\b", names, re.I)]
    site = " ".join(p["text"] for p in f.get("pages", []))
    soft = [c for c in comps if c not in hard and re.search(r"\b" + re.escape(c) + r"\b", site)]
    return excluded, hard, soft


def text_similarity(firms, t, labels, doc_fn=None, query_text=None):
    """TF-IDF cosine between each firm's text and the thesis, after moving the thesis toward liked firms."""
    docs = [(doc_fn or text_of)(f) for f in firms]
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=1, max_df=0.6, sublinear_tf=True, max_features=60000)
    X = vec.fit_transform(docs + [query_text or thesis_text(t)])
    profile = X[-1].toarray()
    idx = {f["id"]: i for i, f in enumerate(firms)}
    liked = [idx[i] for i, (l, _) in labels.items() if l > 0 and i in idx]
    disliked = [idx[i] for i, (l, _) in labels.items() if l < 0 and i in idx]
    if liked:
        profile = profile + 0.75 * X[liked].mean(axis=0).A
    if disliked:
        profile = profile - 0.25 * X[disliked].mean(axis=0).A
    profile = np.clip(profile, 0, None)
    sims = cosine_similarity(X[:-1], profile).ravel()
    ranks = sims.argsort().argsort() / max(1, len(sims) - 1)  # percentile within the cohort
    for f, s, r in zip(firms, sims, ranks):
        has_text = f.get("pages") or f.get("board_seats") or f.get("kind") == "builder"  # builders carry repo/paper text
        f["features"]["text_sim"] = round(float(r) if has_text else float(r) * 0.5, 3)
        f["raw_sim"] = float(s)
    return vec, profile


def best_passages(f, vec, profile, n=2):
    """Sentences from the firm's own pages closest to the thesis: the evidence shown when Claude is off."""
    sents = []
    for p in f.get("pages", []):
        for s in re.split(r"(?<=[.!?])\s+|\n", p["text"]):
            s = s.strip()
            if 50 <= len(s) <= 320:
                sents.append((s, p["url"]))
    if not sents:
        return []
    sims = cosine_similarity(vec.transform([s for s, _ in sents]), profile).ravel()
    order = sims.argsort()[::-1]
    out, seen = [], set()
    for i in order[: n * 3]:
        if sims[i] > 0 and sents[i][0] not in seen:
            out.append({"text": sents[i][0], "url": sents[i][1], "sim": round(float(sims[i]), 3)})
            seen.add(sents[i][0])
        if len(out) == n:
            break
    return out


# ---------- weights learned from your labels ----------
def learned_weights(firms_by_id, labels, features=None, defaults=None):
    FEATURES, DEFAULT_WEIGHTS = features or globals()["FEATURES"], defaults or globals()["DEFAULT_WEIGHTS"]
    w = dict(DEFAULT_WEIGHTS)
    rows = [(firms_by_id[i]["features"], l) for i, (l, _) in labels.items() if i in firms_by_id and "features" in firms_by_id[i]]
    pos, neg = sum(1 for _, l in rows if l > 0), sum(1 for _, l in rows if l < 0)
    if pos < 2 or neg < 2:
        return w, f"defaults (need 2+ yes and 2+ no labels; have {pos} yes, {neg} no)"
    X = np.array([[r.get(k, 0.0) for k in FEATURES] for r, _ in rows])
    y = np.array([1 if l > 0 else 0 for _, l in rows])
    coef = np.clip(LogisticRegression(C=0.3, max_iter=1000).fit(X, y).coef_[0], 0, None)
    if coef.sum() == 0:
        return w, "defaults (labels did not separate on any feature)"
    coef = coef / coef.sum() * sum(DEFAULT_WEIGHTS.values())
    alpha = min(1.0, len(rows) / 30)
    w = {k: round((1 - alpha) * DEFAULT_WEIGHTS[k] + alpha * float(c), 3) for k, c in zip(FEATURES, coef)}
    return w, f"learned from {len(rows)} labels ({pos} yes, {neg} no), blend {alpha:.0%} learned"


def stage_score(f, stage, weights):
    keys = [k for k in STAGE_FEATURES[stage] if k in f["features"]]
    total = sum(weights[k] for k in keys) or 1
    s = sum(weights[k] * f["features"][k] for k in keys) / total
    if f.get("excluded_by"):
        s *= 0.5
    if f.get("conflicts"):
        s *= 0.2
    elif f.get("possible_conflicts"):
        s *= 0.7
    return round(s, 4)


def base_features(firms, t, connections, today):
    lo, hi = t["fund_size_usd"]
    pref = set(t.get("geo_preferred", []))
    for f in firms:
        warm, why = warm_path(f, connections)
        f["warm_why"] = why
        f["features"] = {
            "size_fit": size_fit(fund_size(f), lo, hi),
            "recency": recency(f, today),
            "geo": 1.0 if not pref or f["state"] in pref else 0.4,
            "seats": round(seats_score(f), 3),
            "board_fit": board_fit(f, t),
            "warm": warm,
        }
        f["fund_size"] = fund_size(f)


def hard_filter(f, t, today):
    """Yes/no rules from the thesis before any scoring."""
    if t.get("geo_required") and f["state"] not in t["geo_required"]:
        return False
    if not (f["people"] or f.get("website")):
        return False  # nobody to contact
    max_months = t.get("max_months_since_fund", 36)
    if f["funds"] and f["funds"][0]["date"] and (today - date.fromisoformat(f["funds"][0]["date"])).days / 30.4 > max_months:
        return False
    size = fund_size(f)
    lo, hi = t["fund_size_usd"]
    return size is None or lo / 4 <= size <= hi * 4


def pick_partner(f, t):
    inds = set(t.get("industries", []))
    tally = {}
    for s in f["board_seats"]:
        tally[s["person"]] = tally.get(s["person"], 0) + (2 if s["industry"] in inds else 1)
    if tally:
        name = max(tally, key=tally.get)
        p = f["people"].get(person_key(*name.split(" ", 1)) if " " in name else "", {})
        return name, p.get("title", "board member at portfolio companies")
    if f["people"]:
        p = max(f["people"].values(), key=lambda p: p["funds"])
        return p["name"], p["title"]
    return "", ""
