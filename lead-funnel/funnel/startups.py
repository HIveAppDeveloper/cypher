"""Startups raising now, and their founders, from the Form D data sets already downloaded by `build`.

A startup is an operating company (not a fund or real-asset vehicle) filing a Form D. Its executive
officers are treated as founders; directors who are partners at a known venture firm show who already
backed it. A person who is an officer of more than one startup in the data is marked as a repeat founder.
"""
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

from .sec import SKIP_INDUSTRY, _date, _money, _tsv, person_key

VEHICLE_NAME = re.compile(r"\b(L\.?P\.?|FUND|SPV|SERIES|TRUST|HOLDINGS|CAPITAL|PARTNERS|PROPERTIES|REALTY|DST|ACQUISITION|INVESTORS?)\b", re.I)


def build_startups(data_dir: Path, universe: dict) -> dict:
    vc_people = defaultdict(set)  # person key -> venture firm names (for "already backed by")
    for f in universe["firms"]:
        for k in f.get("people", {}):
            vc_people[k].add(f["name"])

    companies = {}
    for zp in sorted((data_dir / "raw").glob("*_d.zip")):
        with zipfile.ZipFile(zp) as z:
            dates = {r["ACCESSIONNUMBER"]: _date(r["FILING_DATE"]) for r in _tsv(z, "FORMDSUBMISSION.TSV")}
            issuers = {r["ACCESSIONNUMBER"]: r for r in _tsv(z, "ISSUERS.TSV") if r["IS_PRIMARYISSUER_FLAG"].upper() == "YES"}
            people = defaultdict(list)
            for r in _tsv(z, "RELATEDPERSONS.TSV"):
                if r["FIRSTNAME"].strip().upper() in ("", "N/A", "NA", "NONE"):
                    continue
                people[r["ACCESSIONNUMBER"]].append({
                    "first": r["FIRSTNAME"].strip().title(), "last": r["LASTNAME"].strip().title(),
                    "roles": [x for x in (r["RELATIONSHIP_1"], r["RELATIONSHIP_2"], r["RELATIONSHIP_3"]) if x],
                    "title": r["RELATIONSHIPCLARIFICATION"].strip()[:100]})
            for o in _tsv(z, "OFFERING.TSV"):
                acc, iss = o["ACCESSIONNUMBER"], issuers.get(o["ACCESSIONNUMBER"])
                if not iss or o["INVESTMENTFUNDTYPE"] or o["ISPOOLEDINVESTMENTFUNDTYPE"].lower() == "true":
                    continue
                if SKIP_INDUSTRY.search(o["INDUSTRYGROUPTYPE"]) or iss["ENTITYTYPE"] in ("Limited Partnership", "Business Trust", "General Partnership"):
                    continue
                name = iss["ENTITYNAME"].strip()
                if VEHICLE_NAME.search(name) or re.match(r"^\d", name):
                    continue  # funds, SPVs, and entities named after a street address
                cik = iss["CIK"].strip()
                c = companies.setdefault(cik, {"id": "co:" + cik, "kind": "startup", "company": name, "cik": cik,
                                               "city": iss["CITY"].strip().title(), "state": iss["STATEORCOUNTRY"].strip(),
                                               "year_inc": iss["YEAROFINC_VALUE_ENTERED"].strip(), "inc_choice": iss["YEAROFINC_TIMESPAN_CHOICE"],
                                               "entity": iss["ENTITYTYPE"],
                                               "filings": [], "officers": {}, "directors": {}})
                c["filings"].append({"date": dates.get(acc, ""), "first_sale": o["SALE_DATE"].strip(), "industry": o["INDUSTRYGROUPTYPE"],
                                     "amount": _money(o["TOTALOFFERINGAMOUNT"]), "sold": _money(o["TOTALAMOUNTSOLD"]),
                                     "investors": int(_money(o["TOTALNUMBERALREADYINVESTED"]) or 0), "revenue": o["REVENUERANGE"],
                                     "amendment": o["ISAMENDMENT"].lower() == "true", "acc": acc})
                for p in people.get(acc, []):
                    k = person_key(p["first"], p["last"])
                    entry = {"name": f'{p["first"]} {p["last"]}', "title": p["title"], "key": k}
                    if "Executive Officer" in p["roles"]:
                        c["officers"][k] = entry
                    elif "Director" in p["roles"]:
                        c["directors"][k] = entry

    officer_of = defaultdict(set)
    for c in companies.values():
        for k in c["officers"]:
            officer_of[k].add(c["cik"])
    out = []
    for c in companies.values():
        c["filings"].sort(key=lambda x: x["date"], reverse=True)
        latest = c["filings"][0]
        c["industry"] = latest["industry"]
        c["latest_date"] = latest["date"]
        # Largest raise among non-amendment filings stands for the current round.
        rounds = [x for x in c["filings"] if not x["amendment"]] or c["filings"]
        c["round_amount"] = max((x["amount"] or 0) for x in rounds) or None
        c["round_sold"] = max((x["sold"] or 0) for x in rounds) or None
        c["investor_count"] = max(x["investors"] for x in rounds)
        c["repeat_founders"] = [o["name"] for k, o in c["officers"].items() if len(officer_of[k]) > 1]
        c["backed_by"] = sorted({firm for k in c["directors"] for firm in vc_people.get(k, ())})
        c["officers"] = list(c["officers"].values())
        c["directors"] = [d["name"] for d in c["directors"].values()]
        if c["officers"]:
            out.append(c)
    data = {"count": len(out), "startups": out}
    (data_dir / "startups.json").write_text(json.dumps(data))
    print(f"  startups: {len(out)} operating companies with named officers")
    return data
