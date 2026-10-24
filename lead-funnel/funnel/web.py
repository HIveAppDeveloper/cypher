"""Fetch firm websites politely (robots.txt, one homepage per firm, then a few key pages for finalists)."""
import hashlib
import json
import re
import urllib.parse
import urllib.request
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path

UA = "LeadFunnel/0.1 (investor research tool)"
# Pages that say what a fund believes and backs.
KEY_PAGE = re.compile(r"portfolio|companies|thesis|about|approach|philosophy|focus|perspective|insight|blog|writing|essays|news|team", re.I)
SKIP = {"script", "style", "noscript", "svg", "template", "head"}


class _Extract(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text, self.links, self._skip, self._href = [], [], 0, None

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self._skip += 1
        elif tag == "a":
            self._href = dict(attrs).get("href")
        elif tag in ("p", "div", "li", "h1", "h2", "h3", "h4", "br", "section", "article"):
            self.text.append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP and self._skip:
            self._skip -= 1
        elif tag == "a":
            self._href = None

    def handle_data(self, data):
        if self._skip:
            return
        self.text.append(data)
        if self._href:
            self.links.append((self._href, data.strip()))


def _fetch(url, timeout=10, maxbytes=500_000):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if "html" not in r.headers.get("Content-Type", "html"):
            return r.geturl(), ""
        return r.geturl(), r.read(maxbytes).decode(r.headers.get_content_charset() or "utf-8", "replace")


_robots = {}


def _allowed(url):
    host = urllib.parse.urlsplit(url)
    key = f"{host.scheme}://{host.netloc}"
    if key not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            _, txt = _fetch(key + "/robots.txt", timeout=6, maxbytes=100_000)
            rp.parse(txt.splitlines())
        except Exception:
            rp.parse([])  # no robots.txt: allowed
        _robots[key] = rp
    return _robots[key].can_fetch(UA, url)


def _page(url):
    if not _allowed(url):
        return None
    final, html = _fetch(url)
    p = _Extract()
    p.feed(html)
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.text))
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return {"url": final, "text": text[:20000], "links": p.links}


def _normalize(site):
    site = site.strip()
    return site if site.startswith("http") else "https://" + site


def _cache_path(cache_dir: Path, firm_id):
    return cache_dir / (hashlib.sha1(firm_id.encode()).hexdigest()[:16] + ".json")


def site_pages(firm, cache_dir: Path, deep=False):
    """Homepage text for every firm; with deep=True also up to 4 same-site pages about portfolio, thesis and writing."""
    path = _cache_path(cache_dir, firm["id"])
    cached = json.loads(path.read_text()) if path.exists() else None
    if cached and (cached["deep"] or not deep):
        return cached["pages"]
    pages = cached["pages"] if cached else []
    try:
        if not pages:
            home = _page(_normalize(firm["website"]))
            if home:
                pages = [home]
        if deep and pages:
            base = urllib.parse.urlsplit(pages[0]["url"])
            seen, picks = {pages[0]["url"].rstrip("/")}, []
            for href, label in pages[0].get("links", []):
                u = urllib.parse.urljoin(pages[0]["url"], href).split("#")[0].rstrip("/")
                if urllib.parse.urlsplit(u).netloc != base.netloc or u in seen or not (KEY_PAGE.search(u) or KEY_PAGE.search(label)):
                    continue
                seen.add(u)
                picks.append(u)
            for u in picks[:4]:
                try:
                    pg = _page(u)
                    if pg:
                        pages.append(pg)
                except Exception:
                    pass
    except Exception as err:
        pages = pages or [{"url": firm["website"], "text": "", "links": [], "error": str(err)[:120]}]
    for pg in pages:
        pg["links"] = pg.get("links", [])[:200]
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"deep": deep, "pages": pages}))
    return pages


def enrich(firms, cache_dir: Path, deep=False, workers=24):
    todo = [f for f in firms if f.get("website")]
    with ThreadPoolExecutor(workers) as pool:
        for f, pages in zip(todo, pool.map(lambda f: site_pages(f, cache_dir, deep), todo)):
            f["pages"] = [{"url": p["url"], "text": p["text"]} for p in pages if p.get("text")]
    for f in firms:
        f.setdefault("pages", [])
    return firms
