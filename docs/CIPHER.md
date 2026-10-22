# Cipher: Territory Pulse

Cipher is a one-button prospecting and outbound tool for founders, SDRs and small sales teams who sell to public companies. Pick a territory of 20 public companies (or paste your own tickers), say what you sell and who you sell to, and press **Run Outbound**. Cipher then does the whole loop in one pass: it **prospects** the territory, **researches** each account against live SEC filings and public job boards, **ranks** them by buying signals, **finds the buyer** (a ready LinkedIn and Apollo search for your persona at that company), **drafts** a signal-based first email, builds a 4-touch **sequence**, and **logs** every step it took so you can check its work.

Route: `/cipher`. Code: `frontend/src/lib/cipher`, `frontend/src/app/api/cipher`, `frontend/src/components/cipher`.

## How it works

### Pipeline

1. The browser posts the run config (territory or tickers, offer, buyer persona, sender name) to `POST /api/cipher/run`.
2. The route streams NDJSON back as it works: `step` events (the run log), one `lead` event per account, and a final `done` summary. Accounts are scanned in parallel, staggered 140 ms apart, so results fill in live.
3. For each company it pulls two sources at the same time:
   - **SEC EDGAR**: maps ticker to CIK via `sec.gov/files/company_tickers.json`, then reads `data.sec.gov/submissions/CIK##########.json` and walks filings from the last 180 days. S-1, S-3, 424B, F-1 and F-3 count as raising; 8-Ks in the last 90 days count as material events; 10-Q, 10-K and 20-F count as spending activity. Each filing becomes an evidence link to the document on sec.gov.
   - **Greenhouse**: for companies with a known public board, reads `boards-api.greenhouse.io/v1/boards/<board>/jobs`, counts open roles and go-to-market roles (sales, SDR/BDR, RevOps, growth, marketing, partnerships, customer success, solutions), and keeps up to four postings as evidence links.
4. Each source falls back on its own. If EDGAR or Greenhouse is unreachable (4.5 s timeout), Cipher uses the snapshot values in `markets.ts`. Those are illustrative demo estimates, and every signal built from them is labelled **Demo estimate** in the UI (live ones are labelled **Live**). The run log states, per account, whether it used live EDGAR, live jobs, or demo estimates.
5. Signals are scored, the account is tiered, and the email and sequence are drafted (`engine.ts`).

### Scoring

The score is the sum of signal strengths, capped at 100.

| Signal | Fires when | Strength |
| --- | --- | --- |
| Hiring | at least one open role | `min(40, round(open / 12 + gtmRoles / 2.5))` |
| Raising | any capital-markets filing (S-1/S-3/424B/F-1/F-3) in 180 days | 25 |
| Spending | any 10-Q/10-K/20-F in 180 days (demo: spend trend "up") | 18 |
| Momentum | 3 or more 8-Ks in 90 days | `min(17, 2 x count)` |

Maximum possible: 40 + 25 + 18 + 17 = 100.

### Tiers

- **Hot**: score 70 or more
- **Warm**: 45 to 69
- **Watch**: below 45

### Drafting

The email opener is chosen from the strongest signal (hiring push, recent raise, filings, or a busy quarter of 8-Ks), the subject follows the same hook, and the body uses `{{first_name}}` as a merge field. The sequence is: Day 0 email, Day 2 LinkedIn connect referencing the signal, Day 4 follow-up email with a proof point, Day 7 call and voicemail. Due dates are set from the run date.

## Features

- **Prospect Brain**: a 3D view of the territory. Each account is a node; the closer it sits to the core, the higher its score. Each signal (Hiring, Raising, Spending, Momentum) is a hub on the outer shell, and accounts lean toward the hubs driving them, with links drawn from a focused account to its hubs. Drag to rotate, zoom with the buttons or Ctrl/Cmd + scroll, hover for a summary, click to open the dossier.
- **Ranked ledger** (Accounts tab): every account ranked by score, with a cell per signal shaded by strength, a live marker on live data, tier and pipeline stage. Filter by Hot, Warm or Watch.
- **Pipeline board**: four lanes (Ready to send, In sequence, Replied, Meeting booked), each card showing the reason to reach out and the next touch.
- **Run log**: timestamped record of every source checked, score, draft and send. Tickers in the log open that account.
- **Account dossier**: why now, each signal with its points and Live/Demo label, and evidence links to the SEC filings and job postings behind it.
- **Buyer**: one-click LinkedIn and Apollo people searches for the chosen persona at that company.
- **Editable email**: subject and body can be edited in place; copy to clipboard.
- **Gmail compose**: opens a Gmail draft with the subject and body filled in, and moves the account to In sequence.
- **Webhook sending**: paste a webhook from Zapier, Make, Clay or a Base44 function in Setup. "Start N hot sequences" or "Start sequence" posts the leads (company, ticker, domain, score, tier, why, subject, body, sequence) through `POST /api/cipher/dispatch`, which only accepts public `https://` URLs (no localhost, `.local`/`.internal`, IP literals or embedded credentials), caps the payload at 400 KB and times out after 8 s.
- **CSV export**: all ranked accounts with score, tier, why now, persona, subject, body, stage and next touch.
- **Own ticker list**: Setup accepts up to 20 tickers in place of a built-in territory.
- **Three built-in territories**: Fintech & Payments, Cybersecurity, Cloud & DevTools, 20 public companies each.
- **Persistence**: inputs, leads and the log are kept in the browser's localStorage between visits.
- **Light and dark** themes follow the system setting; the layout works on mobile.

## 90-second demo script

1. **(0:00) Open `/cipher`.** "The question is: how does your team find the right buyer and act first? Cipher does it with one button."
2. **(0:08) Pick Fintech & Payments, leave the offer as is, set Buyer to VP of Sales.** "Twenty public fintech companies. I tell it what I sell and who I sell to."
3. **(0:15) Click Run Outbound.** Point at the run log on the right. "It's reading each company's SEC filings and public job board right now. Every check is logged, and it says when it's using live data and when it falls back to estimates."
4. **(0:30) Watch the Prospect Brain fill in. Drag to rotate.** "Each dot is an account. Closer to the centre means more buying signals. The four hubs are hiring, raising, spending and momentum; accounts lean toward what's driving them."
5. **(0:42) Click the Accounts tab.** "Same thing as a ranked list. Hot is 70 and up. You can see which signal earned the points."
6. **(0:50) Click the top Hot account.** "The dossier shows why now, with links to the actual filings and job postings. Here's the buyer: one click to find the VP of Sales on LinkedIn or Apollo."
7. **(1:02) Scroll to the email, edit one line.** "The first email is written from the strongest signal. It's editable, and there's a 4-touch sequence across email, LinkedIn and phone."
8. **(1:12) Click Open in Gmail, then close the dossier and click Start hot sequences.** "Send it from Gmail, or push all the hot accounts to Zapier, Make, Clay or Base44 through a webhook."
9. **(1:22) Click the Pipeline tab, then Export CSV.** "They're now in sequence on the pipeline board, and the whole list exports to CSV. From territory to sequenced buyers in under two minutes."

## Run it

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:3000/cipher.

Optional environment variable:

- `CIPHER_SEC_USER_AGENT`: the User-Agent sent to SEC EDGAR. The SEC asks for a name and contact email, for example `CIPHER_SEC_USER_AGENT="Your Name you@example.com"`. A default is used if unset.

## Limitations

- **Buyer names are not scraped.** Cipher gives a LinkedIn and an Apollo people search for the persona at each company; you pick the actual person. Emails have no recipient filled in.
- **Sending needs your own tool.** Without a webhook, "Start sequence" only moves the account to In sequence inside Cipher and nothing is sent. Real sending goes through Gmail compose (one at a time) or your webhook. Replies and meetings are marked by hand.
- **Demo estimates when live sources are blocked.** If EDGAR or Greenhouse can't be reached from where the app runs, the built-in companies fall back to illustrative snapshot values, labelled Demo estimate. Tickers outside the built-in lists have no snapshot, so without live data they score 0.
- **Live job data covers only some companies.** Only companies with a configured public Greenhouse board get live hiring counts; the rest use the estimate.
- **Signals are filing-level proxies.** The live spending signal fires on any 10-Q/10-K/20-F in the last 180 days, so most public companies get it; Cipher does not parse spend figures from the filings. Raising and momentum come from filing types and counts, not filing contents.
- **State is per browser.** Leads, edits and pipeline stages live in localStorage, not a shared database.
