"""Founders before the round: people building in the thesis space who haven't filed a Form D.

Free sources, all queried with the fund's thesis keywords and cached for a day:
- GitHub: fast-rising repos owned by a person (search API; GITHUB_TOKEN raises the rate limit)
- Hacker News "Show HN" launches (Algolia API)
- arXiv: new papers, first authors
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

DAY = 24 * 3600


def _get_json(url, headers=None, cache: Path = None, ttl=DAY):
    path = cache / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".json") if cache else None
    if path and path.exists() and time.time() - path.stat().st_mtime < ttl:
        return json.loads(path.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": "lead-funnel/0.1", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    data = json.loads(body) if body.lstrip().startswith(("{", "[")) else {"raw": body}
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
    return data


def _since(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


def github(t, cache: Path, days=120, max_users=40):
    token = os.environ.get("GITHUB_TOKEN")
    hdr = {"Accept": "application/vnd.github+json", **({"Authorization": f"Bearer {token}"} if token else {})}
    repos, notes = {}, []
    for kw in t.get("search_terms", t["keywords"][:6]):
        q = f'{kw} in:name,description,topics created:>{_since(days)} stars:>10'
        try:
            data = _get_json(f"https://api.github.com/search/repositories?q={urllib.parse.quote(q)}&sort=stars&order=desc&per_page=30", hdr, cache)
        except urllib.error.HTTPError as e:
            notes.append(f"GitHub search '{kw}': HTTP {e.code}")
            break
        for r in data.get("items", []):
            if r["owner"]["type"] == "User":
                repos.setdefault(r["full_name"], r)
        time.sleep(0 if token else 6.5)  # search allows 10 requests a minute without a token
    leads = []
    for i, r in enumerate(sorted(repos.values(), key=lambda r: -r["stargazers_count"])):
        user = {}
        if i < (max_users if not token else 200):
            try:
                user = _get_json(f"https://api.github.com/users/{r['owner']['login']}", hdr, cache, ttl=7 * DAY)
            except urllib.error.HTTPError:
                pass
        age = max(1, (datetime.now(timezone.utc) - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).days)
        leads.append({
            "id": "gh:" + r["owner"]["login"].lower(), "kind": "builder", "source": "GitHub",
            "person": user.get("name") or r["owner"]["login"], "handle": r["owner"]["login"],
            "company": (user.get("company") or "").lstrip("@").strip(), "location": user.get("location") or "",
            "website": user.get("blog") or "", "date": r["created_at"][:10],
            "headline": f"{r['full_name']}: {r['stargazers_count']:,}★ in {age} days",
            "text": " ".join(filter(None, [r.get("description"), " ".join(r.get("topics") or []), user.get("bio")])),
            "url": r["html_url"], "contact": f"https://github.com/{r['owner']['login']}",
            "signals": {"stars": r["stargazers_count"], "stars_per_day": r["stargazers_count"] / age,
                        "followers": user.get("followers"), "public_repos": user.get("public_repos")},
        })
    return _merge_same_person(leads), notes


def show_hn(t, cache: Path, days=180):
    # Whole days, so the query (and its cache entry) stays the same all day; a per-second cutoff changed
    # the results on every run and shifted which leads reached the paid judge.
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff = int((today - timedelta(days=days)).timestamp())
    seen, leads = set(), []
    for kw in t.get("search_terms", t["keywords"][:6]):
        url = (f"https://hn.algolia.com/api/v1/search?tags=show_hn&query={urllib.parse.quote(kw)}"
               f"&numericFilters=created_at_i>{cutoff},points>4&hitsPerPage=40")
        for h in _get_json(url, cache=cache).get("hits", []):
            if h["objectID"] in seen:
                continue
            seen.add(h["objectID"])
            title = re.sub(r"^Show HN:\s*", "", h.get("title") or "")
            leads.append({
                "id": "hn:" + h["author"].lower(), "kind": "builder", "source": "Show HN",
                "person": h["author"], "handle": h["author"], "company": title.split(" – ")[0].split(" - ")[0].split(",")[0][:60],
                "location": "", "website": h.get("url") or "", "date": h["created_at"][:10],
                "headline": f"Show HN: {title} ({h.get('points', 0)} points, {h.get('num_comments', 0)} comments)",
                "text": title, "url": f"https://news.ycombinator.com/item?id={h['objectID']}",
                "contact": f"https://news.ycombinator.com/user?id={h['author']}",
                "signals": {"hn_points": h.get("points") or 0, "hn_comments": h.get("num_comments") or 0},
            })
    return _merge_same_person(leads), []


def arxiv(t, cache: Path):
    terms = t.get("search_terms", t["keywords"][:6])
    q = "+OR+".join(f'abs:%22{urllib.parse.quote(k)}%22' for k in terms)
    url = f"https://export.arxiv.org/api/query?search_query={q}&sortBy=submittedDate&sortOrder=descending&max_results=60"
    try:
        raw = _get_json(url, cache=cache).get("raw", "")
    except urllib.error.HTTPError as e:
        return [], [f"arXiv: HTTP {e.code}"]
    if "Rate exceeded" in raw:
        return [], ["arXiv: rate limited, try again later"]
    tag = lambda x, n: [m.strip() for m in re.findall(fr"<{n}>([\s\S]*?)</{n}>", x)]
    leads = []
    for e in tag(raw, "entry"):
        authors = [tag(a, "name")[0] for a in tag(e, "author") if tag(a, "name")]
        if not authors:
            continue
        title = re.sub(r"\s+", " ", tag(e, "title")[0])
        link = (tag(e, "id") or [""])[0].replace("http://", "https://")
        leads.append({
            "id": "ax:" + re.sub(r"[^a-z]", "", authors[0].lower()), "kind": "builder", "source": "arXiv",
            "person": authors[0], "handle": "", "company": "", "location": "", "website": "",
            "date": (tag(e, "published") or [""])[0][:10], "headline": f"“{title}”" + (f" with {len(authors) - 1} co-authors" if len(authors) > 1 else ""),
            "text": title + " " + re.sub(r"\s+", " ", (tag(e, "summary") or [""])[0])[:1500], "url": link, "contact": link,
            "signals": {"papers": 1, "coauthors": len(authors) - 1},
        })
    return _merge_same_person(leads), []


def _merge_same_person(leads):
    """One lead per person per source; keep the strongest headline and add up the evidence."""
    out = {}
    for l in leads:
        if l["id"] in out:
            o = out[l["id"]]
            o["text"] += " " + l["text"]
            o.setdefault("more", []).append(l["headline"])
            for k, v in l["signals"].items():
                if isinstance(v, (int, float)) and isinstance(o["signals"].get(k), (int, float)):
                    o["signals"][k] = max(o["signals"][k], v) if k != "papers" else o["signals"][k] + v
        else:
            out[l["id"]] = l
    return list(out.values())
