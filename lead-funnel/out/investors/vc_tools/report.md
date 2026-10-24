# Investor shortlist: AI-native workflow software for venture investors and LPs

Generated 2026-10-24. Data: SEC Form ADV and Form D bulk files, firm websites, akta.pro, Claude.

## Funnel

| Stage | Firms |
|---|---:|
| Venture firms in SEC data | 12,008 |
| Pass hard filters (stage, size, recency, geography, contactable) | 9,083 |
| Sourced: best structured fit | 1,000 |
| Screened: homepage language + portfolio fit | 200 |
| Deep: key pages, investments, warm paths | 50 |
| Shortlist | 15 |

- akta.pro: 0 new paid calls this run (0 credits). This month: 625 used, 525 of 1150 usable credits left.
- Claude Opus 5.5 (Nicrron gateway, anthropic/claude-opus-5-5 via Nicrron, default effort): judged 50 of 50.
- Weights: defaults (need 2+ yes and 2+ no labels; have 0 yes, 0 no).

| Feature | Weight |
|---|---:|
| size_fit | 0.15 |
| recency | 0.10 |
| geo | 0.05 |
| seats | 0.05 |
| text_sim | 0.25 |
| board_fit | 0.20 |
| warm | 0.10 |
| claude | 0.30 |

## Leads

### 1. Foundation Capital, Llc · score 0.71

**Contact:** Ashu Garg (Manager of the Managing Member) · Palo Alto CA

**Why (Claude, alignment 3/5):** Foundation Capital is an early-stage firm with explicit enterprise and fintech practices and conviction in AI, so the sector overlap with AI-native investor workflow software is real. Its December 2025 'context graphs' thesis, about capturing decision traces and reasoning for enterprise AI, loosely echoes the founder's emphasis on explanations, but nothing provided shows the firm arguing for LP tooling, self-hosted models or filings-based signal.

> Its signature intellectual contribution is the December 2025 "context graphs" thesis, a published framework describing knowledge graphs that capture decision traces and reasoning to improve enterprise AI reasoning.
> — akta.pro profile (third-party description, not the firm's own words)

**Evidence:** latest fund Foundation Capital X Principals Fund, L.L.C. ($11M, filed 2025-11-18); private fund assets $4.8B; board seats in your space: Turing Enterprises, Inc. (Ashu Garg), Arcade Software, Inc. (Joanne Chen), Arize AI, Inc. (Ashu Garg), dltHub Inc. (Steve Vassallo), FinCo Services, Inc. (Charles Moldow); akta.pro investments: Imperial, Dextr AI, International Payments Identity.

**Watch out:** All web evidence comes from a third-party profile (akta.pro); no firm-authored pages were provided, and the page is truncated.; No visible stance on LPs being underserved, on keeping portfolio data in-house with self-hosted models, or on Form D/ADV as a signal source.; The firm's stated focus on 'zero billion-dollar markets' may cast venture and LP tooling as too niche a market.; Undescribed holdings (FinCo Services via Charles Moldow, Dextr AI) could overlap with private-market data or workflow tools; the possible conflict is unverified.; The firm skews heavily toward day-zero, pre-revenue deals, which may not fit if the founder is raising at a later stage.

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.81 · text_sim 0.81 · board_fit 0.78 · warm 0.00 · claude 0.50

`python run.py label 1 yes "why"` or `python run.py label 1 no "why"`

### 2. Scop Ventures, Llc · score 0.70

**Contact:** Cormac O'Connor · Santa Barbara CA · https://www.scopvc.com

**Why (Claude, alignment 3/5):** ScOp is a pre-seed/seed SaaS and AI investor whose portfolio repeatedly backs tools that turn unstructured documents into actionable insight (Yogi, Unwrap, HG Insights, Litem), and it holds Rogo, described as 'the leading AI platform for finance.' Its pages never address private-market investors, LPs, self-hosted models or public filings like Form D, so the fit rests on sector and pattern rather than a stated shared thesis.

> But at the end of the day, turning this data into actionable insights is still a struggle.
> — [https://scopvc.com/companies/](https://scopvc.com/companies/) (verified on page)

**Shared beliefs:** Investors will pay for better signal and explanations, not more data

**Evidence:** latest fund ScOp Venture Fund II, LP (undisclosed, filed 2025-04-02); private fund assets $151M; board seats in your space: SuiteOp Inc. (Cormac O?Connor), SMART BARREL, INC. (Cormac O'Connor), Alpha Design AI, Inc. (Ivan Bercovich), SuiteOp Inc. (Cormac O'Connor), Deposely, Inc. (Cormac O'Connor); akta.pro investments: Keenable, ChipAgents, Pangram Labs.

**Watch out:** Rogo, an AI platform for financial institutions, may overlap with AI diligence and research for investors and could be seen as a soft conflict; The firm focuses on $400K–$2M ARR, so a pre-revenue company may be too early; No visible view on LPs being underserved, self-hosted models for portfolio data, or Form D and Form ADV as a signal source; The supporting quote comes from a portfolio company description, not the firm's own investment thesis; Kevin O'Connor's recent board seats are in mining and energy, not fintech

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.92 · text_sim 0.95 · board_fit 0.55 · warm 0.00 · claude 0.50

`python run.py label 2 yes "why"` or `python run.py label 2 no "why"`

### 3. Vertical Venture Partners · score 0.69

**Contact:** David Schwab (Manager of the General Partner) · Palo Alto CA · https://vvp.vc

**Why (Claude, alignment 3/5):** VVP's vertical AI model describes the product becoming an industry's system of record, it lists Financial Services as a focus vertical, and its homepage says its own sourcing, diligence and portfolio support run on AI tools, so the partners judge this kind of product as practitioners. However, none of its pages, filings or portfolio companies (Embroker, Backflip, Mongoose and others) addresses investor or LP tooling, self-hosted models, or Form D/ADV as a source of signal, so the overlap is sector and model rather than the founder's core beliefs.

> The same transformation we back in our verticals runs inside the firm: sourcing, diligence, and portfolio support are built on the tools, not assisted by them.
> — [https://vvp.vc](https://vvp.vc) (verified on page)

**Evidence:** latest fund Vertical Venture Partners IV, L.P. ($100M, filed 2026-05-27); private fund assets $468M; board seats in your space: Barti Software, Inc. (David Schwab), Agriculture Scout AI, Inc. (David Schwab); akta.pro investments: Mongoose Software, Surf Therapeutics, WON.

**Watch out:** None of the founder's specific beliefs (LPs underserved, self-hosted models for portfolio data, Form D/ADV as signal, paying for explanations over data) appear in the firm's pages.; VVP underwrites founders with lived industry experience, so the founder must show inside knowledge of fund operations and LP workflows.; VVP already runs sourcing and diligence on AI internally and may see these as tools it builds itself rather than as a venture-scale market.; No portfolio company targets investor or fund-admin workflow, so there is no visible precedent for this vertical.; The team page was cut off, so the views of the other investing professionals are unknown.

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.58 · text_sim 0.99 · board_fit 0.50 · warm 0.00 · claude 0.50

`python run.py label 3 yes "why"` or `python run.py label 3 no "why"`

### 4. Reformation Management, Llc · score 0.67

**Contact:** David Rogg (Manager of the General Partner of the Issuer) · Miami FL · https://www.reformation.vc/

**Why (Claude, alignment 3/5):** Reformation backs capital-efficient vertical SaaS and AI companies, and its portfolio includes data intelligence and reporting software for multifamily investors, capital markets software for mortgage originators, and intelligence workflow tools. That puts the founder in the right category, but none of the provided pages state any view on private-market investors, LPs, self-hosted models or Form D/ADV data as a signal source.

> Real estate data intelligence and reporting software for multifamily residential investors
> — [https://reformation.vc/portfolio](https://reformation.vc/portfolio) (verified on page)

**Evidence:** latest fund Reformation Partners III, LP ($125M, filed 2026-03-27); private fund assets $248M; board seats in your space: Erin Technologies, Inc. (David Rogg), Corfix Inc. (Andrew Oved), We Are Arthur, Inc. (Andrew Oved), symmetRE, Inc. (David Rogg); akta.pro investments: Walkway, EZ Newswire, Driven.

**Watch out:** No thesis writing was provided (the 'Thoughts' page was not included), so there is no evidence of shared contrarian beliefs.; Stage gate: lead-only $2M-$5M checks into companies with $500K-$2.5M ARR, 100%+ growth and under $4M raised; the founder may be too early.; Investing in tools built for their own industry is not a stated focus, and the portfolio skews toward traditional verticals like construction, funeral, home services and mortgage.; Partner-level interests are unclear: board seats (Erin Technologies, Corfix, We Are Arthur, symmetRE) don't reveal who would champion investor-workflow software.

**Score:** size_fit 1.00 · recency 1.00 · geo 0.40 · seats 0.67 · text_sim 0.96 · board_fit 0.57 · warm 0.00 · claude 0.50

`python run.py label 4 yes "why"` or `python run.py label 4 no "why"`

### 5. Deviation Capital · score 0.67

**Contact:** Dusan Perovic (Managing Member of the Managing Member of the Issuer) · New York NY · https://deviation.com/

**Why (Claude, alignment 3/5):** Deviation's metathesis, inherited from Two Sigma Ventures, is about technical teams using data and computing to unlock insights, and Jonathan Golden covers AI Native Software and Fintech, with prior bets on Kalshi, Socure and Wealthsimple and NEA-era Ledgy and Metabase. Nothing on their pages addresses private-market investor tooling, LP needs, self-hosting or Form D/ADV signal, so the fit is sector and data-philosophy overlap rather than a shared contrarian belief.

> With offices in New York and San Francisco and $2B AUM*, we invest at Seed and Series A with a focus on technical teams using data and computing to unlock novel experiences, insights, and discoveries.
> — [https://deviation.com/](https://deviation.com/) (verified on page)

**Evidence:** latest fund Deviation Capital V LP (undisclosed, filed 2026-05-01); private fund assets $2.2B; board seats in your space: Freeform Future Corp. (Dusan Perovic), WALDEN ROBOTICS, INC. (Colin Beirne); akta.pro investments: Walden Robotics.

**Watch out:** No investments in private-market, fund-admin or investor-workflow software appear in the portfolio.; Recent board seats (Walden Robotics, Freeform, Gameto, Human Biotech) skew toward robotics, techbio and industrials, not fintech SaaS.; Their thesis emphasizes harnessing the rising volume of data, which sits somewhat at odds with the founder's 'signal, not more data' framing.; The firm is a potential customer of the product, which may color its diligence; Sidney Costabile's past Investor Relations role at TSV could be an asset here, but her Capital Markets focus lists no investments.; The firm is newly independent and raising Deviation V, so deal pace and allocation are uncertain.

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.67 · text_sim 0.96 · board_fit 0.40 · warm 0.00 · claude 0.50

`python run.py label 5 yes "why"` or `python run.py label 5 no "why"`

### 6. Companyon Ventures · score 0.67

**Contact:** Firas Raouf (Managing Member of the General Partner) · Boston MA · https://companyon.vc

**Why (Claude, alignment 3/5):** Companyon writes seed and early Series A checks into B2B AI and software, and Tom Lazay lists Fintech as an area of expertise and is himself an LP in VC and PE funds, so this is the right sector with built-in user empathy. Ronny Chatterjee spent years in Cambridge Associates' direct and co-investment practice and runs Companyon's investor relations, but nothing on their pages argues the founder's specific beliefs about signal over data, self-hosted models, underserved LPs or Form D and ADV data.

> Parthib supports fund operations by leading pre and post-deal diligence workflows on the market, competition, and financial projections where he synthesizes due diligence findings into investment recommendations.
> — [https://companyon.vc/team/](https://companyon.vc/team/) (verified on page)

**Evidence:** latest fund Companyon Ventures Fund 2026, L.P. ($100M, filed 2026-03-26); private fund assets $145M; board seats in your space: Allstacks, Inc. (Firas Raouf), Cyvl, Inc. (Firas Raouf), Posh Group Inc. (Thomas Lazay); akta.pro investments: North.cloud, Sent, Posh.

**Watch out:** Strict traction bar: $1M-$5M ARR, growing at least 3x, with renewing and expanding customers; Only about four new investments per year, so the bar for any single deal is high; None of the founder's contrarian beliefs (self-hosted models, LPs underserved, Form D/ADV as signal) are echoed on the firm's pages; Portfolio leans toward GTM, infrastructure and SMB fintech rather than investor or private-markets tooling; They may see the product mainly as a vendor tool for their own diligence rather than as a venture-scale market

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.58 · text_sim 0.89 · board_fit 0.50 · warm 0.00 · claude 0.50

`python run.py label 6 yes "why"` or `python run.py label 6 no "why"`

### 7. Theory Ventures Management, Llc · score 0.66

**Contact:** Tomasz Tunguz (Managing Director of the General Partner of the Issuer) · Portola Valley CA · https://theory.ventures/

**Why (Claude, alignment 3/5):** Theory is a thesis-driven AI and data investor whose portfolio includes Omni, MotherDuck and LanceDB, and it backed Ollama, pitched as "The Best Way to Own Your AI", which loosely supports the founder's self-hosted-model belief. Its blog title on building a VC firm like an intelligence agency, and a team of AI engineers plus a Head of Human Intelligence, suggest it values investor signal, but no page explicitly argues the founder's beliefs about private-market workflow, LPs or Form D/ADV data.

> Why We Built a VC Firm Like an Intelligence Agency: Forward Deployment
> — [https://theoryvc.com/blog](https://theoryvc.com/blog) (verified on page)

**Shared beliefs:** Funds' own portfolio data must stay in-house, so self-hosted models win

**Evidence:** latest fund Theory Ventures Corollary I, L.P. ($100M, filed 2026-02-26); private fund assets $709M; board seats in your space: Omni Analytics, Inc. (Tomasz Tunguz), Allium Labs, Inc. (Tomasz Tunguz); akta.pro investments: BackOps AI, Ollama, Sail Research.

**Watch out:** No fintech, private-markets or investor-tooling companies in the portfolio; the fit rests on general AI and data overlap; Blog post bodies were not provided, so the intelligence-agency thesis is visible only as a title; Theory has an in-house AI engineering team and may build its own investor tooling rather than back a vendor; A concentrated model of 12-15 core positions per fund means a high bar for each new deal; No evidence of interest in LPs as a customer segment or in public filings as a signal source

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.46 · text_sim 0.66 · board_fit 0.80 · warm 0.00 · claude 0.50

`python run.py label 7 yes "why"` or `python run.py label 7 no "why"`

### 8. Nyca Management Llc · score 0.65

**Contact:** John Morris (Managing Member of the General Partner of the Issuer) · New York NY

**Why (Claude, alignment 3/5):** Nyca invests only in fintech and has a 'Capital Formation and Risk' vertical, which overlaps with private-market investor tooling. Its Series A co-lead in Informed.IQ, an AI document-automation platform for lenders, and its 'Compliant AI for financial services' theme are close to the founder's idea of reading documents and turning them into signals, but nothing provided shows Nyca holding the founder's specific beliefs about investor or LP workflow, self-hosted models or Form D/ADV data.

> Co-led the $20 million Series A in Informed.IQ alongside US Venture Partners, backing an AI document-automation platform that claims 99% verification accuracy, serves five of the top 10 US auto lenders, and has facilitated over $91 billion in loan originations.
> — akta.pro profile (third-party description, not the firm's own words)

**Evidence:** latest fund Nyca Investment Fund V-B, LP (undisclosed, filed 2026-01-08); private fund assets $1.2B; board seats in your space: QuantumSafe Data Systems Inc. (John Morris), Global Interactive Technologies, Inc. (John Morris); akta.pro investments: RQD Clearing, Forage, Findigs.

**Watch out:** Nyca has no website of its own in the evidence; all qualitative evidence comes from a third-party profile (akta.pro), not the firm's own words; No visible view on LPs being underserved, self-hosted models for portfolio data, or public filings as private-market signal; The Capital Formation vertical and recent deals (RQD Clearing, Forage, Findigs, Loop AI) point to payments and lending infrastructure rather than tools for GPs and LPs; Board seats via John Morris (QuantumSafe Data Systems, Global Interactive Technologies) show no clear connection to investor workflow software; The firm sells to banks, broker-dealers and insurers through its Demo Day; it is unclear whether it sees VCs and LPs as an attractive customer base

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.46 · text_sim 0.76 · board_fit 0.60 · warm 0.00 · claude 0.50

`python run.py label 8 yes "why"` or `python run.py label 8 no "why"`

### 9. Afore Capital Management, Llc · score 0.64

**Contact:** Gaurav Jain (Managing Member of the General Partner) · San Francisco CA · http://www.afore.vc

**Why (Claude, alignment 3/5):** Afore is a generalist pre-seed fund that backs AI and B2B data products, including Baselayer (a business credit bureau built on business records), Radix Health (insights for operators and investors), Basis (finance insights) and Flatfile (spreadsheet data import). Nothing on its pages argues the founder's specific beliefs about investor signal, LP demand, self-hosted models or Form D/ADV data, so the fit rests on adjacent portfolio themes rather than shared thinking.

> Unlocking critical insights for healthcare services operators and investors.
> — [https://www.afore.vc/portfolio](https://www.afore.vc/portfolio) (verified on page)

**Evidence:** latest fund Afore Capital V, L.P. ($230M, filed 2026-03-30); private fund assets $732M; board seats in your space: Pixxel Space Technologies, Inc. (Gaurav Jain), Devenue Inc. (Gaurav Jain); akta.pro investments: Baselayer, CivilGrid.

**Watch out:** No stated thesis on private-market or investor workflow tools; the firm is a generalist; None of the founder's contrarian beliefs (self-hosting, LPs underserved, Form D/ADV as signal) appear in the firm's own words; Stage fit: the firm writes $500k-$2M+ pre-traction checks, which suits only a founder raising at pre-seed; The quote is a portfolio company description, not the firm's own thesis; No evidence shows which partner covers fintech or data; Gaurav Jain is chosen only because he holds the visible board seats

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.46 · text_sim 0.87 · board_fit 0.40 · warm 0.00 · claude 0.50

`python run.py label 9 yes "why"` or `python run.py label 9 no "why"`

### 10. Ttv Capital · score 0.64

**Contact:** Elizabeth Lewis (Member of TTV GP VII, LLC, General Partner of the Issuer) · Atlanta GA · http://ttvcapital.com

**Why (Claude, alignment 3/5):** TTV is an early-stage fintech specialist that is actively backing AI-native financial workflow software: Outmarket (AI insurance workflows) and Cashboard (AI FP&A tools) appear in its press, and Quantizr and Worth are recent board seats. None of its own pages argue the founder's specific beliefs, such as LPs being underserved, Form D/ADV as signal, or self-hosted models for private portfolio data, so this is a strong sector and stage fit without visible shared conviction.

> A Fintech VC Just Led A $7.5M Bet On Private Aviation—Here’s Why
> — [https://ttvcapital.com/news/](https://ttvcapital.com/news/) (closest sentence to your thesis)

**Evidence:** latest fund TTV Fund VII, L.P. ($275M, filed 2026-07-13); private fund assets $910M; board seats in your space: Central Ohio Bancorp (Elizabeth Lewis), SamCart, Inc. (Sean Banks), WORTH AI INC. (Neil Kapur), Quantizr, Inc. (Gardiner Garrard Iii); akta.pro investments: Sunbound, Outmarket AI.

**Watch out:** No firm-authored writing on private-market investor tooling, LP needs, public-filing signal or self-hosted AI; the fit rests on fintech sector overlap only.; The portfolio is weighted toward payments, banking, SMB and consumer fintech rather than tools for capital-markets or fund-administration buyers.; Portfolio company Asset Class (Fund VI) is undescribed in the evidence; check that it does not overlap with investor or LP workflow software.; The AI-native financial workflow focus comes from a third-party profile (akta.pro), not TTV's own pages.

**Score:** size_fit 1.00 · recency 1.00 · geo 0.40 · seats 0.67 · text_sim 0.57 · board_fit 0.86 · warm 0.00 · claude 0.50

`python run.py label 10 yes "why"` or `python run.py label 10 no "why"`

### 11. Steel Atlas Management Inc · score 0.64

**Contact:** Talal Attieh (Co-President of the Manager of the Issuer) · · https://www.steelatlas.vc

**Why (Claude, alignment 2/5):** Steel Atlas runs a concentrated thesis on industrial technology ('hyper-techno industrialization'), and its portfolio is nuclear, freight, maritime, space and manufacturing companies, with no fintech or investor-tooling deals. The closest link is its 'Data Gushers' memo about refining untapped information streams with AI, and a memo optimistic about SaaS, but neither is about private-market data, LPs or self-hosted models.

> Like the 1901 Spindletop gusher that launched the oil era, we're witnessing the rise of "data gushers" - untapped streams of information waiting to be sensed and refined into value through advances in AI and sensing technology.
> — [https://www.steelatlas.vc](https://www.steelatlas.vc) (verified on page)

**Evidence:** latest fund Steel Atlas Fund II LLC ($50M, filed 2025-10-24); private fund assets $36M; board seats in your space: GenLogs Corp (Talal Attieh), Azora, Inc. (Cameron Porter); akta.pro investments: Quartermaster AI, GenLogs.

**Watch out:** The thesis is built around industrial and physical-economy companies, so a fintech workflow tool for investors falls outside the firm's stated pillars (Built Environment, Energy, Supply Chain, Advanced Manufacturing).; The 'data gusher' framing is about sensing physical-world data, not about public filings or fund documents, so it is at most a loose fit with the Form D/ADV belief.; The firm backs only about ten companies per fund, which makes an off-thesis bet unlikely.; Recent filings are mostly SPVs into existing portfolio companies, which suggests capacity for new deals is going to follow-ons.; Nothing on the firm's pages addresses LP tooling, GP workflow or on-premise/self-hosted AI.

**Score:** size_fit 1.00 · recency 1.00 · geo 0.40 · seats 0.46 · text_sim 0.95 · board_fit 0.80 · warm 0.00 · claude 0.25

`python run.py label 11 yes "why"` or `python run.py label 11 no "why"`

### 12. Kickstart Capital, Llc · score 0.64

**Contact:** Gavin Christensen · Cottonwood Heights UT · http://www.kickstart.com

**Why (Claude, alignment 3/5):** Kickstart backed Aumni, described on its portfolio page as an investment analytics platform for investors that was acquired by J.P. Morgan. That is clear prior exposure to private-market investor tooling, but none of Kickstart's own pages argue the founder's beliefs about signal over data, self-hosted models, underserved LPs or Form D/ADV data. Gavin Christensen also holds a board seat at Lera Investment Technologies, which may be nearby, but its focus isn't described.

> Investment analytics platform that generates strategic insights related to the economic position and legal rights of investors.
> — [https://kickstart.com/portfolio](https://kickstart.com/portfolio) (verified on page)

**Evidence:** latest fund Kickstart Seed Fund VII, L.P. (undisclosed, filed 2026-04-23); private fund assets $648M; board seats in your space: Moises Systems, Inc. (Gavin Christensen), Quadratic Growth Inc. (Gavin Christensen), Lera Investment Technologies, Inc. (Gavin Christensen), Monarx, Inc. (Gavin Christensen); akta.pro investments: Carputty, Codebreaker Labs, Apaluma.

**Watch out:** Strong regional focus on Utah, Colorado and the Mountain West may exclude founders outside that ecosystem.; Lera Investment Technologies (Gavin Christensen board seat) could be an adjacent or competing investment-tech company; no detail is provided.; Aumni exited to J.P. Morgan, so the firm may see this space as already captured or may have relationships that complicate a new bet.; The firm's pages state no thesis on AI for investors, LP tooling, self-hosted models or public-filing signal; the fit rests on portfolio history, not stated beliefs.; Alex Soffe appears as Kickstart team on Aumni but is not named on the fund filings.

**Score:** size_fit 1.00 · recency 1.00 · geo 0.40 · seats 0.75 · text_sim 0.83 · board_fit 0.50 · warm 0.00 · claude 0.50

`python run.py label 12 yes "why"` or `python run.py label 12 no "why"`

### 13. Caffeinated Capital Management, Llc · score 0.64

**Contact:** Raymond Tonsing (Managing Member of the Managing Member) · Aspen CO · http://www.caffeinated.com

**Why (Claude, alignment 3/5):** Caffeinated is a generalist seed and Series A lead with a record in fintech and applied AI workflow software, such as Affirm, Aven, Federato's AI underwriting platform, Onebrief's staff-workflow software and Human Intelligence. But nothing on its pages addresses investor or LP tooling, self-hosted models, or Form D and ADV filings as signal. The fit is right stage and adjacent sector, not shared belief, and its 'transcendent goal' framing may make an investor-workflow tool feel too niche.

> They can reduce the cost of basic goods like capital, payments, insurance, energy, and transportation.
> — [https://www.caffeinated.com/philosophy](https://www.caffeinated.com/philosophy) (verified on page)

**Evidence:** latest fund Caffeinated Capital Scout Fund V, LP ($15M, filed 2026-02-26); private fund assets $3.9B; board seats in your space: Onebrief, Inc. (Raymond Tonsing), Saronic Technologies, Inc. (Raymond Tonsing), Twenty Technologies, Inc. (Raymond Tonsing).

**Watch out:** No written view on private-market data, LP tooling, self-hosted AI or public filings as signal; none of the founder's specific beliefs is visibly shared; Philosophy favors world-changing 'life's work' missions (defense, space, healthcare); software sold to VCs and LPs may read as a small or niche market; Customers would be the firm's own peers; it's unclear whether they see that market as large enough for a category-defining company; Recent fund activity is concentrated in large defense and aerospace SPVs, which may signal attention elsewhere

**Score:** size_fit 1.00 · recency 1.00 · geo 0.40 · seats 0.67 · text_sim 0.64 · board_fit 0.75 · warm 0.00 · claude 0.50

`python run.py label 13 yes "why"` or `python run.py label 13 no "why"`

### 14. Grit Capital Partners · score 0.63

**Contact:** Paul Palmieri (Manager of the Manager of the Issuer) · Baltimore MD · https://www.grit.vc

**Why (Claude, alignment 3/5):** Grit leads pre-seed and seed rounds in applied AI and names fintech as one of four target sectors, describing it as "increasing transparency and reducing friction." It also stresses proprietary data access and trust-building Human/AI interfaces as moats, and it holds a Sydecar-administered SPV in Monark Markets (a private-markets platform), but none of its pages address LPs, fund workflows, self-hosting or Form D/ADV signal.

> Proprietary training data and access methods, synthetic data, probabilistic models, and sticky Human/AI interfaces that create trust all provide next generation moats that deliver investment returns.
> — [https://www.grit.vc/approach](https://www.grit.vc/approach) (verified on page)

**Evidence:** latest fund Grit Capital Seed 2, LLC ($10M, filed 2025-03-07); private fund assets $47M; board seats in your space: BRANDRANK.AI INC. (Paul Palmieri).

**Watch out:** Both partners with bios shown (Palmieri, Flannery) list their focus as commerce, media and martech, not fintech, so a fintech champion is unclear.; No evidence of views on LP tooling, self-hosted models or public filings as private-market signal.; Before a seed round they expect a launched product, paying customers beyond pilots and at least one technical co-founder.; Small firm ($47M in private fund assets), and its only startup board seat on file is BrandRank.ai, a martech company.; Its Monark Markets SPV is adjacent to private markets but not a direct competitor; worth checking for overlap.

**Score:** size_fit 1.00 · recency 1.00 · geo 0.40 · seats 0.29 · text_sim 0.92 · board_fit 0.45 · warm 0.00 · claude 0.50

`python run.py label 14 yes "why"` or `python run.py label 14 no "why"`

### 15. Cervin Ventures Management, Llc · score 0.62

**Contact:** Neeraj Gupta (MANAGING MEMBER OF THE GENERAL PARTNER OF THE ISSUER) · Palo Alto CA · https://www.cervin.com

**Why (Claude, alignment 3/5):** Cervin is an early-stage enterprise fund, and Taylor Oliver's stated focus on enterprise applications and fintech, plus Neeraj Gupta's and Shirish Sathaye's focus on data infrastructure and AI-powered businesses, puts AI-native investor workflow software squarely in its sector. However, none of the firm's pages, filings or board seats state any view on private-market investor tooling, self-hosted models, LP needs or Form D/ADV data, so the fit is sector overlap rather than shared belief.

> Courtney McKee joined the Cervin team with over 12 years of operations management and back office experience in mutual funds, hedge funds, private equity and venture capital to fund administration.
> — [https://www.cervinventures.com/team](https://www.cervinventures.com/team) (closest sentence to your thesis)

**Evidence:** latest fund CERVIN VENTURES FUND VI, L.P. (undisclosed, filed 2026-06-24); private fund assets $706M; board seats in your space: Qurrent, Inc. (Neeraj Gupta).

**Watch out:** No published thesis on private-market data, investor workflow or LP tooling, so none of the founder's contrarian beliefs are visibly shared; Thesis page stresses revenue-driven companies that achieve product-market fit quickly, which may mean scrutiny of the slow sales cycles and small buyer pool of VC/LP customers; Board-seat evidence is limited to one company (Qurrent, Other Technology) with unclear relevance, and portfolio investment data is unavailable; AUM figures conflict ($706M private fund assets on filings vs. $335M on the team page), so fund size and check size are uncertain; Scott Brown's past role as CMO of Hum Capital (AI for institutional capital) is relevant context, but he leads the platform team rather than investing

**Score:** size_fit 1.00 · recency 1.00 · geo 1.00 · seats 0.29 · text_sim 0.94 · board_fit 0.22 · warm 0.00 · claude 0.50

`python run.py label 15 yes "why"` or `python run.py label 15 no "why"`

