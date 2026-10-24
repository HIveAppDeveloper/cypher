# Investor lead funnel

Finds the 10–20 investors most likely to back a specific startup thesis, starting from every venture firm in SEC data. Each lead comes with a named partner, evidence, a quote from the firm's own site, concerns, and a score you can tune with yes/no labels.

```
12,008 venture firms (SEC Form ADV + Form D)
  → hard filters: fund size, recent fund, geography, someone to contact     ~9,000
  → sourced: structured fit (fund size, recency, board seats in your space)  1,000
  → screened: homepage language vs your thesis, exclusions, conflicts         200
  → deep: portfolio, thesis and blog pages, akta.pro data, warm paths          50
  → shortlist: Claude judges shared beliefs; quotes checked against the page  10–20
```

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python run.py build
```

`build` downloads about 40 MB of SEC data and takes about a minute. It uses the last 8 quarters of Form D data by default (`--quarters N` to change). Rerun it once a quarter when the SEC publishes new data.

### Keys (`.env`)

| Variable | Needed for | Notes |
|---|---|---|
| `SEC_USER_AGENT` | `build` | Your name and email, e.g. `"Jane Doe jane@school.edu"`. The SEC requires a contact. |
| `NICRRON_API_KEY` | Claude judge (optional) | Hackathon gateway; uses `anthropic/claude-opus-5-5` |
| `ANTHROPIC_API_KEY` | Claude judge (optional) | Anthropic API directly. Wins if both keys are set. |
| `JUDGE_PROVIDER` | (optional) | `nicrron` or `anthropic` to force one |
| `AKTA_API_KEY` | akta.pro enrichment (optional) | See [Spending](#spending) |
| `AKTA_MONTHLY_CREDITS` | (optional) | Your plan's monthly allowance, default 1,250 |
| `AKTA_RESERVE_CREDITS` | (optional) | Credits never spent, default 100 |

`.env` is git-ignored. Never put keys in `.env.example` or any other committed file.

## Commands

Run from this folder. Every command except `build` and `akta-budget` takes `--thesis PATH` (default `thesis.toml`).

| Command | What it does | Cost |
|---|---|---|
| `run.py rank --no-claude` | Funnel on free data only | Free |
| `run.py rank` | Funnel with the Claude judge on the final 50 | About $3–4 for a new thesis; free if cached |
| `run.py rank --akta-new 10` | Also allow up to 10 new akta.pro lookups | Up to 70 credits |
| `run.py rank --no-akta` | Ignore akta.pro data, even cached | Free |
| `run.py label 3 yes "why"` | Label lead #3 from the last shortlist | Free |
| `run.py show 3` | Print everything known about lead #3 | Free |
| `run.py akta-budget` | Credits used this month and what's left | Free |
| `export_results.py` | Write all results for a thesis to `run_results_<name>.txt` | Free (cache only) |

Examples:

```bash
.venv/bin/python run.py rank --thesis thesis.toml --no-claude
.venv/bin/python run.py rank --thesis theses/my_idea.toml
.venv/bin/python run.py label 1 yes "backs vertical SaaS for clinics" --thesis theses/my_idea.toml
.venv/bin/python export_results.py --thesis theses/my_idea.toml
```

## Writing a thesis

Copy `thesis.toml` (an example: AI back office for veterinary clinics) or `thesis_example_vc_tools.toml` (tools for VCs and LPs) and edit it.

| Field | How it's used |
|---|---|
| `one_liner`, `thesis` | Text matched against each firm's pages, and given to Claude |
| `beliefs` | **Matters most.** What "thinks like you" means. Claude looks for firms that visibly share these. |
| `keywords` | Whole-word matches in portfolio and board-seat company names, and in firm text |
| `industries` | Form D industry groups that count as your space for board seats |
| `competitors` | A portfolio or board seat naming one is a conflict and drops the firm; a mention on the website is flagged |
| `exclusions` | A firm whose language is dominated by these is marked off-thesis |
| `fund_size_usd` | Fund sizes that write checks your size. Firms far outside it are dropped. |
| `geo_preferred`, `geo_required` | US state codes; soft preference and hard filter |
| `max_months_since_fund` | Drops firms with no fund filing this recent |
| `[run]` | Stage sizes, shortlist length, Claude effort (Anthropic only) |

## Results

Each thesis file gets its own results, named after the file. For `my_idea.toml`:

| File | Contents |
|---|---|
| `out/my_idea/report.md` | The shortlist with briefs: partner, why, quote, evidence, warm path, concerns, score breakdown |
| `out/my_idea/shortlist.csv` | Shortlist with every feature score |
| `out/my_idea/sourced.csv` | All 1,000 sourced firms and the stage each reached |
| `data/labels/my_idea.csv` | Your yes/no labels for this thesis |
| `data/features/my_idea.json` | Feature scores used to learn your weights |

SEC data, the website cache, akta.pro data and Claude judgments are shared across theses, so one thesis never pays for something another already fetched.

## How it learns your taste

- **Language:** your thesis profile moves toward the words of firms you liked and away from ones you didn't.
- **Weights:** with 2+ yes and 2+ no labels, a logistic regression refits how much each signal counts. It blends in gradually and is fully learned at about 30 labels.
- **Claude:** your labels and notes go into the judge as examples of your taste.

Labels are per thesis, since a "yes" for one idea says nothing about another.

## Spending

Two paid services, both optional:

**akta.pro** (firm descriptions and portfolio investments, 7 credits per firm)
- Off by default. A normal `rank` uses cached akta.pro data only and makes no paid calls.
- New lookups happen only with `--akta-new N`, and only for the top N firms that aren't cached.
- Before every paid call, its worst-case credits are checked against this month's allowance minus the reserve. If it doesn't fit, the call is refused before anything is sent.
- Every paid call's actual cost is written to `data/akta/ledger.json`. Check it with `run.py akta-budget`.
- The ledger only counts calls made by this tool. If you use akta.pro elsewhere, compare with your akta.pro dashboard.

**Claude** (via Nicrron or Anthropic)
- Judges the final 50 firms, about $3–4 for a new thesis.
- Every judgment is cached by its inputs, so rerunning the same thesis with the same labels costs nothing. New labels, a changed thesis, or new akta.pro data for a firm trigger new judgments for the affected firms.
- Quotes are checked against the firm's actual page text; any quote not found word for word is dropped.

## Data sources

| Source | Used for | Cost |
|---|---|---|
| SEC Form ADV bulk files | Every adviser with venture funds: website, city, private fund assets | Free |
| SEC Form D data sets (8 quarters) | Fund raises and their partners; startup directors give board seats | Free |
| Firm websites | Thesis language, portfolio pages, quotes | Free; robots.txt respected |
| akta.pro | Firm descriptions and portfolio investments | Credits (see above) |
| Claude Opus 5.5 | Judging shared beliefs | Per token (see above) |
| LinkedIn `Connections.csv` (optional) | Warm paths: put your export here as `connections.csv` | Free |

## Code layout

| File | Role |
|---|---|
| `run.py` | CLI: build, rank, label, show, akta-budget |
| `funnel/sec.py` | Downloads SEC bulk data; builds firms, partners and board seats |
| `funnel/web.py` | Fetches homepages and key pages, cached in `data/web/` |
| `funnel/score.py` | Features, stage scoring, text similarity, learning from labels |
| `funnel/akta.py` | akta.pro client with the monthly credit ledger and spending guard |
| `funnel/judge.py` | Claude judge via Anthropic or Nicrron, with quote checking |
| `export_results.py` | Writes all results for a thesis to one text file, from cache only |

## Limits

- About half of the sourced firms have no website in SEC data, mostly emerging managers known only from Form D. They are ranked on filings alone and rarely reach the shortlist.
- Board seats are matched by exact full name to one firm, so common names are skipped and some seats are missed.
- Through Nicrron, the effort setting is not passed on, so Claude judges at its default effort.
- Without Claude, the final ranking is score-only, and "quotes" are the closest sentences on the site, not judged matches.
