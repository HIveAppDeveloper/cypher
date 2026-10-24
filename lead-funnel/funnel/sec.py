"""Build the investor universe from free SEC bulk data.

- Form ADV (registered + exempt reporting advisers): every adviser that manages a venture fund,
  with city, state, website and private-fund assets.
- Form D data sets (last N quarters): venture fund raises with their partners, and startup raises
  with their directors. A VC partner listed as a director of a startup is a board seat.
"""
import csv
import io
import json
import re
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

csv.field_size_limit(10**9)

FORMD_PAGE = "https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets"
ADV_PAGE = "https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers"

# Startup industries worth tracking board seats in; vehicles and real assets are skipped.
SKIP_INDUSTRY = re.compile(r"Real Estate|REIT|Residential|Commercial$|Oil|Gas|Coal|Mining|Restaurants|Lodging|Investing|Pooled|Agriculture", re.I)


def _get(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def download(raw_dir: Path, ua: str, quarters: int):
    """Fetch the newest Form D quarters and Form ADV files once; later runs reuse them."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    page = _get(FORMD_PAGE, ua).decode("utf-8", "replace")
    qkey = lambda u: re.search(r"(\d{4})q(\d)", u, re.I).groups()
    formd = sorted(set(re.findall(r'href="([^"]+_d\.zip)"', page)), key=qkey, reverse=True)[:quarters]
    page = _get(ADV_PAGE, ua).decode("utf-8", "replace")
    adv = re.findall(r'href="([^"]+/ia(\d{6,8})[^"/]*\.zip)"', page)

    def adv_date(digits):  # file names use MMDDYY or MMDDYYYY
        y = int(digits[4:]) + (2000 if len(digits) == 6 else 0)
        return (y, int(digits[:2]), int(digits[2:4]))
    newest = lambda files: max(files, key=lambda f: adv_date(f[1]))[0]
    is_exempt = lambda f: "exempt" in f[0].rsplit("/", 1)[1]  # the folder path itself says "exempt"
    exempt = newest([f for f in adv if is_exempt(f)])
    registered = newest([f for f in adv if not is_exempt(f)])
    paths = []
    for href in formd + [exempt, registered]:
        dest = raw_dir / href.rsplit("/", 1)[1]
        if not dest.exists():
            print(f"  downloading {dest.name}")
            dest.write_bytes(_get("https://www.sec.gov" + href, ua))
        paths.append(dest)
    return paths[:-2], paths[-2], paths[-1]


def _tsv(z, suffix):
    name = next(n for n in z.namelist() if n.upper().endswith(suffix))
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1"), delimiter="\t")


def _money(s):
    try:
        return float(str(s).replace(",", "").strip())
    except ValueError:
        return None


# Fund and adviser names share a "brand" (Costanoa LA Growth, L.P. ~ Costanoa Venture Capital Management).
LEGAL = re.compile(r"\b(l\.?l\.?c|l\.?p|l\.?l\.?p|inc|ltd|gmbh|corp|corporation|co|company|incorporated|limited|plc|series\s+\S+)\b\.?")
GENERIC = set("""fund funds ventures venture capital partners partner management managers advisors advisers adviser gp holdings
investments investment associates group the growth opportunity opportunities early seed spv coinvest co invest parallel feeder
offshore onshore master annex select vc equity global technology technologies of and lab labs""".split())
ROMAN = re.compile(r"^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)$")


def brand(name: str) -> list[str]:
    s = re.sub(r"\(.*?\)", " ", name.lower())
    s = LEGAL.sub(" ", s)
    s = re.sub(r"[^a-z0-9& ]", " ", s)
    return [t for t in s.split() if t not in GENERIC and not ROMAN.match(t) and not t.isdigit() and len(t) > 1][:2]


def person_key(first, last):
    norm = lambda x: re.sub(r"[^a-z]", "", (x or "").lower())
    return f"{norm(first)}|{norm(last)}"


def _date(s):
    try:
        return datetime.strptime(s.strip(), "%d-%b-%Y").date().isoformat()
    except ValueError:
        return ""


def load_adv(path: Path):
    firms = []
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        for r in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1")):
            if not r.get("Any VC Funds", "").strip().upper().startswith("Y"):
                continue
            n_vc = int(_money(r.get("Total number of VC funds")) or 0)
            n_all = int(_money(r.get("Count of Private Funds - 7B(1)")) or 0) or n_vc
            # Registered wealth managers often hold one VC fund among many; keep advisers that are mostly VC.
            if n_vc / max(n_all, 1) < 0.5:
                continue
            web = (r.get("Website Address") or "").strip()
            if re.search(r"linkedin|twitter|x\.com|facebook|instagram", web, re.I):
                web = ""
            firms.append({
                "id": "crd:" + r["Organization CRD#"].strip(),
                "name": r["Primary Business Name"].strip().title(),
                "city": r.get("Main Office City", "").strip().title(),
                "state": r.get("Main Office State", "").strip(),
                "website": web.lower() if web else "",
                "aum": _money(r.get("Total Gross Assets of Private Funds")),
                "n_vc_funds": n_vc,
                "source": "Form ADV",
            })
    return firms


def build_universe(data_dir: Path, ua: str, quarters: int = 8) -> dict:
    formd_zips, exempt, registered = download(data_dir / "raw", ua, quarters)
    firms = {f["id"]: f for f in load_adv(exempt) + load_adv(registered)}
    by_token = defaultdict(list)
    for f in firms.values():
        b = brand(f["name"])
        if b:
            by_token[b[0]].append(f)

    funds, companies = [], []
    for zp in formd_zips:
        with zipfile.ZipFile(zp) as z:
            dates = {r["ACCESSIONNUMBER"]: _date(r["FILING_DATE"]) for r in _tsv(z, "FORMDSUBMISSION.TSV")}
            issuers = {r["ACCESSIONNUMBER"]: r for r in _tsv(z, "ISSUERS.TSV") if r["IS_PRIMARYISSUER_FLAG"].upper() == "YES"}
            people = defaultdict(list)
            for r in _tsv(z, "RELATEDPERSONS.TSV"):
                if r["FIRSTNAME"].strip().upper() in ("", "N/A", "NA", "NONE"):
                    continue  # entity rows such as "XYZ GP, LLC"
                people[r["ACCESSIONNUMBER"]].append({
                    "first": r["FIRSTNAME"].strip().title(), "last": r["LASTNAME"].strip().title(),
                    "roles": [x for x in (r["RELATIONSHIP_1"], r["RELATIONSHIP_2"], r["RELATIONSHIP_3"]) if x],
                    "title": r["RELATIONSHIPCLARIFICATION"].strip()[:120], "state": r["STATEORCOUNTRY"].strip()})
            for o in _tsv(z, "OFFERING.TSV"):
                acc, iss = o["ACCESSIONNUMBER"], issuers.get(o["ACCESSIONNUMBER"])
                if not iss:
                    continue
                rec = {"acc": acc, "name": iss["ENTITYNAME"].strip(), "cik": iss["CIK"].strip(), "date": dates.get(acc, ""),
                       "state": iss["STATEORCOUNTRY"].strip(), "city": iss["CITY"].strip().title(),
                       "amount": _money(o["TOTALOFFERINGAMOUNT"]), "sold": _money(o["TOTALAMOUNTSOLD"]),
                       "industry": o["INDUSTRYGROUPTYPE"], "people": people.get(acc, [])}
                if o["INVESTMENTFUNDTYPE"] == "Venture Capital Fund":
                    funds.append(rec)
                elif not o["INVESTMENTFUNDTYPE"] and o["ISPOOLEDINVESTMENTFUNDTYPE"].lower() != "true" and not SKIP_INDUSTRY.search(o["INDUSTRYGROUPTYPE"]):
                    companies.append(rec)
        print(f"  {zp.name}: {len(funds)} VC fund filings, {len(companies)} startup filings so far")

    # Attach each fund filing to an adviser by brand; unmatched brands become firms of their own (often emerging managers).
    for fd in funds:
        b = brand(fd["name"])
        if not b:
            continue
        cands = by_token.get(b[0], [])
        if len(cands) > 1:
            cands = [c for c in cands if brand(c["name"])[:2] == b[:2]] or [c for c in cands if c["state"] == fd["state"]]
        if len(cands) == 1:
            firm = cands[0]
        else:
            fid = "fd:" + " ".join(b)
            firm = firms.setdefault(fid, {"id": fid, "name": fd["name"].split(",")[0].strip(), "city": fd["city"], "state": fd["state"],
                                          "website": "", "aum": None, "n_vc_funds": 0, "source": "Form D"})
        firm.setdefault("funds", []).append({k: fd[k] for k in ("name", "date", "amount", "sold", "acc", "cik")})
        for p in fd["people"]:
            ppl = firm.setdefault("people", {})
            k = person_key(p["first"], p["last"])
            ppl.setdefault(k, {"name": f'{p["first"]} {p["last"]}', "title": p["title"], "funds": 0})["funds"] += 1

    # Board seats: a VC partner who is a director (not an officer) of a startup, matched by full name to exactly one firm.
    owner = defaultdict(set)
    for f in firms.values():
        for k in f.get("people", {}):
            owner[k].add(f["id"])
    seats = 0
    for c in companies:
        for p in c["people"]:
            if "Director" not in p["roles"] or "Executive Officer" in p["roles"]:
                continue
            ids = owner.get(person_key(p["first"], p["last"]), set())
            if len(ids) == 1:
                f = firms[next(iter(ids))]
                f.setdefault("board_seats", []).append({"company": c["name"], "industry": c["industry"], "amount": c["amount"],
                                                        "date": c["date"], "state": c["state"], "person": f'{p["first"]} {p["last"]}'})
                seats += 1
    for f in firms.values():
        f.setdefault("funds", []), f.setdefault("people", {}), f.setdefault("board_seats", [])
        f["funds"].sort(key=lambda x: x["date"], reverse=True)
        # Dedupe repeat filings (amendments) of the same startup
        f["board_seats"] = list({(s["company"], s["person"]): s for s in sorted(f["board_seats"], key=lambda s: s["date"])}.values())
    print(f"  universe: {len(firms)} venture firms, {seats} board-seat matches")
    universe = {"built": datetime.now().isoformat(timespec="seconds"), "quarters": [p.name for p in formd_zips], "firms": list(firms.values())}
    (data_dir / "universe.json").write_text(json.dumps(universe))
    return universe
