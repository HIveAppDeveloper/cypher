# Investor lead funnel

Finds the 10–20 investors most likely to back a specific thesis, starting from every venture firm in SEC data. Each lead comes with a named partner, evidence, and a quote from the firm's own site.

```
12,000 venture firms (SEC Form ADV + Form D)
  → hard filters: fund size, recency, geography, someone to contact
  → 1,000 sourced: structured fit (fund size, recent fund, board seats in your space)
  → 200 screened: homepage language vs your thesis, exclusions, conflicts
  → 50 deep: portfolio/thesis/blog pages, akta.pro data, warm paths
  → 10–20 shortlist: Claude judges shared beliefs, with quotes checked against the page
```

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install anthropic scikit-learn pydantic
cp .env.example .env       # then fill in the values
.venv/bin/python run.py build    # downloads ~40 MB of SEC data, about 1 minute
```

## Use

1. Edit `thesis.toml`. The `beliefs` list matters most: it is what "thinks like you" is matched against.
2. Run the funnel and read `out/<thesis name>/report.md`:
   ```bash
   .venv/bin/python run.py rank                                   # uses thesis.toml -> out/thesis/
   .venv/bin/python run.py rank --thesis theses/my_idea.toml      # any path -> out/my_idea/
   ```
   Each thesis file keeps its own results, labels and learned weights, named after the file. Pass the same
   `--thesis` to `label`, `show` and `export_results.py`.
3. Label leads. Each label tunes the next run:
   ```bash
   .venv/bin/python run.py label 3 yes "backs data infrastructure for finance" --thesis theses/my_idea.toml
   .venv/bin/python run.py label 7 no "consumer fund"
   ```
4. Akta spending is off by default. Runs use cached Akta data only. To allow new paid lookups, say how many:
   ```bash
   .venv/bin/python run.py akta-budget          # spent so far and what's left
   .venv/bin/python run.py rank --akta-new 5    # at most 5 new lookups, 7 credits each
   ```
   Every paid call is logged in `data/akta/ledger.json`. A call is refused if it would take this month's usage past
   `AKTA_MONTHLY_CREDITS` (default 1,250) minus `AKTA_RESERVE_CREDITS` (default 100). The count resets each calendar month.
5. Optional: put your LinkedIn `Connections.csv` export in this folder as `connections.csv` to score warm paths.

## How it learns your taste

- **Language:** your thesis profile moves toward the words of firms you liked and away from ones you didn't.
- **Weights:** with 2+ yes and 2+ no labels, a logistic regression refits how much each signal counts. It blends in gradually and is fully learned at about 30 labels.
- **Claude:** your labels and notes go into the final judge as examples of your taste.

## Data sources

| Source | Used for | Cost |
|---|---|---|
| SEC Form ADV bulk files | Every adviser with venture funds: website, city, assets | Free |
| SEC Form D data sets (8 quarters) | Fund raises and their partners; startup directors → board seats | Free |
| Firm websites | Thesis language, portfolio pages, quotes | Free (robots.txt respected) |
| akta.pro | Firm descriptions and portfolio investments | 7 credits per firm; off unless `--akta-new N`; hard monthly credit cap; cached forever |
| Claude (`claude-opus-5-5`) | Final judgment of shared thinking | API usage |

## Limits

- About half of the sourced firms have no website in SEC data, mostly emerging managers known only from Form D. They are ranked on filings alone and rarely reach the shortlist.
- Board seats are matched by exact full name to one firm, so common names are skipped and some seats are missed.
- Without Claude the final ranking is score-only, and "quotes" are the closest sentences on the site, not judged matches.
