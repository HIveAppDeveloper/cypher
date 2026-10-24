# Founder shortlist: Example Seed Fund

**Thesis:** Pre-seed and seed AI-native software for regulated industries

Generated 2026-10-24. Sources: SEC Form D, GitHub, Show HN, arXiv, startup websites, Claude.

## Funnel

| Stage | Leads |
|---|---:|
| All leads | 14,642 |
| Startups raising now (Form D, last 2 years, named officers) | 14,487 |
| Builders from GitHub (thesis keywords, recent) | 27 |
| Builders from Show HN (thesis keywords, recent) | 58 |
| Builders from arXiv (thesis keywords, recent) | 59 |
| Companies from akta.pro List Generation | 11 |
| Pass hard filters (recent, stage, founded, on-thesis keywords) | 2,003 |
| Sourced: stage, recency, relevance, traction, founder signals | 1,000 |
| Screened: language match to the thesis | 200 |
| Deep: websites, READMEs, warm paths | 50 |
| Shortlist | 15 |

- akta.pro list: 11 companies, 0 credits this run; 824 usable left this month.
- akta.pro company search (free): 65 lookups for startup websites.
- Websites found for 94 of 134 screened Form D startups.
- Claude Opus 5.5 via Nicrron: judged 50 of 50.
- Pre-round builders on the shortlist: 0 (places are kept only for builders Claude rates fit 3/5 or better; best builder fit this run: 2/5).
- Weights: defaults (need 2+ yes and 2+ no labels; have 0 yes, 0 no).

| Feature | Weight |
|---|---:|
| stage_fit | 0.10 |
| recency | 0.10 |
| geo | 0.05 |
| relevance | 0.15 |
| traction | 0.15 |
| founder | 0.10 |
| text_sim | 0.15 |
| warm | 0.05 |
| claude | 0.30 |

## Founders

### 1. Jason Griffith · Undeniable Health AI Inc. · score 0.71

**Raising now** (Form D): Form D: $600K round, 13 investors so far, filed 2026-06-22

**What they build:** AI agents that act as digital billing employees, working healthcare claims end to end from charge entry through denials, appeals and AR follow-up for providers and billing companies.

**Why meet (Claude: fit 4/5, founder 4/5, stage pre-seed):** Undeniable Health builds end-to-end AI billing agents for healthcare revenue cycle teams and leads with HIPAA-by-design, an immutable six-year audit trail and human-in-the-loop autonomy. That matches the fund's belief that compliance is the moat. Both co-founders are repeat founders with stated exits (Alex Poon: x.ai, Visual Revenue; Jason Griffith: SiteCompli, Synco, Tripology), and there is an early customer testimonial from JAG Billing's CEO, which makes this worth a meeting despite thin public traction.

> Every action our AI takes is logged as an immutable event.
> — https://www.undeniablehealth.ai/ (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model; Small teams shipping weekly beat large early rounds

**Evidence:** team on filings: Jason Griffith, Alex Poon; site https://www.undeniablehealth.ai/ (from akta.pro company search); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002130106.

**Watch out:** No open-source, GitHub or public traction signal; evidence is the company's own website plus a single customer testimonial.; Founders' healthcare depth is adjacent rather than from inside RCM: healthtech engineering leadership and payer consulting, not years running billing operations.; Exits and backgrounds are self-reported on the site and should be verified.; AI revenue cycle and denials management is a crowded category with well-funded competitors.; The agent-first managed service model may carry services-like margins and operational load.; Still in a 90-day pilot phase with a small number of partners; outcome metrics are not yet public.

**Score:** stage_fit 1.00 · recency 0.80 · geo 1.00 · relevance 0.30 · traction 0.87 · founder 0.45 · text_sim 0.97 · warm 0.00 · claude 0.75

`python run.py label 1 yes "why"` or `python run.py label 1 no "why"`

### 2. Charles Crawford · Loom Security, Inc. · score 0.67

**Raising now** (Form D): Form D: $4.6M round, 4 investors so far, filed 2026-08-20

**What they build:** CINQUE is a security posture observability layer that sits above existing identity and security tools and correlates their signals into behavioral findings and recommended fixes for human, machine and AI-agent identities.

**Why meet (Claude: fit 3/5, founder 3/5, stage seed):** Loom Security's CINQUE correlates identity, device, network, application and data signals, including baselines for AI agents. It sells into financial services, insurance and healthcare as "observed evidence for the examiner," which touches the fund's auditability belief, but it is a horizontal security platform that also targets manufacturing, energy, rail and retail rather than AI-native workflow software for regulated operators. Charles Crawford is flagged as a repeat founder and the site shows a shipped product with a partner program, so a meeting is worth taking to learn his background and see paying regulated customers.

> Observed evidence for the examiner who asks “show me” rather than “tell me.”
> — https://www.loomsecurity.io/ (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model

**Evidence:** repeat founder: Charles Crawford; site https://www.loomsecurity.io/ (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002038064.

**Watch out:** Horizontal cybersecurity product: regulated industries are only some of the eight verticals it targets, alongside manufacturing, energy, oil & gas, rail and retail.; No evidence that the founder comes from inside healthcare, insurance or financial services.; No open-source or public traction signal such as GitHub repos, named customers or usage metrics.; A $4.6M round with $3.4M sold is a fairly large seed, which cuts against the small-team, weekly-shipping belief.; Website was guessed from the company name, but its Lawrence, KS address matches the Form D location, so it is likely the same company; still worth confirming.; Little founder detail beyond the repeat-founder flag; the prior company is unknown.

**Score:** stage_fit 1.00 · recency 1.00 · geo 0.40 · relevance 0.30 · traction 0.68 · founder 1.00 · text_sim 0.99 · warm 0.00 · claude 0.50

`python run.py label 2 yes "why"` or `python run.py label 2 no "why"`

### 3. Andrew Howard · Lockchain Corp. · score 0.66

**Raising now** (Form D): Form D: $5.0M round, 6 investors so far, filed 2026-09-22

**What they build:** An AI-powered risk management, compliance and monitoring platform that helps financial institutions assess and track digital assets, protocols and counterparties.

**Why meet (Claude: fit 3/5, founder 4/5, stage series A):** Lockchain builds AI-native risk and compliance automation for institutions in digital assets, with an institutional audit trail, sourced outputs and SOC 2 Type II, which matches the fund's belief that auditability is the moat. The team is strong: CEO Andrew Howard was CEO/CTO of Kudelski Security and chairman Aidan Kehoe has two risk/security exits. But the company already announced a $5M Series A in 2025 and is raising another $5M round, so it is likely past the fund's pre-seed/seed window.

> Lockchain automates the risk, compliance, and monitoring workflows that institutions require to participate safely and scalably in digital assets.
> — https://lockchain.ai (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model

**Evidence:** directors from Nadia Partners (AI Fund I) LLC; site https://lockchain.ai (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001962104.

**Watch out:** Stage mismatch: the blog announces a $5M Series A (Feb 2025), and the 2026 Form D shows a further $5M round, so this is beyond pre-seed/seed.; Sector is crypto/digital assets compliance, adjacent to the fund's core of healthcare, insurance and banking.; Founders come from cybersecurity rather than from inside institutional finance or compliance operations.; Large executive team and celebrity-heavy board and advisor list; no evidence of a small team shipping weekly.; No open-source or public traction signal; the 'Trusted by the biggest names in finance' claim is unsubstantiated.; Website was guessed but appears to be the same company: Andrew Howard is listed as CEO and 'Lockchain Corporation' appears in the footer.

**Score:** stage_fit 1.00 · recency 1.00 · geo 0.40 · relevance 0.30 · traction 0.74 · founder 0.75 · text_sim 0.93 · warm 0.00 · claude 0.57

`python run.py label 3 yes "why"` or `python run.py label 3 no "why"`

### 4. Benjamin Finch · WithAI Research, Inc. · score 0.65

**Raising now** (Form D): Form D: $4.0M round, 57 investors so far, filed 2026-07-06

**What they build:** Multiplier is an AI agent platform for asset managers that connects market data, research and portfolio systems into one command center and automates investment research on the firm's own cloud.

**Why meet (Claude: fit 3/5, founder 4/5, stage seed):** The CEO built LLM investment systems at Bridgewater, so this is an insider building AI agents for asset managers, with named CIO and co-founder testimonials and data controls like customer-hosted data and zero-retention inference. The product is pitched as research productivity rather than compliance or auditability, and the $6M seed is already announced, so the fit with the fund's moat thesis and entry stage is only partial.

> All data is hosted on your cloud, not an external provider's.
> — https://www.multiplier.ai/ (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Benjamin Finch, Ian Mcinnis; site https://www.multiplier.ai/ (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002140890.

**Reach:** Ian McInnis

**Watch out:** The website was guessed, but it matches the Form D: the footer reads 'WithAI Research, Inc.' and Ian McInnis and Ben Finch appear on both.; Compliance and auditability are not the core value proposition; the pitch is analyst productivity and edge, with security as a feature.; Asset management research is less paperwork- and regulator-driven than the healthcare, insurance and banking workflows the thesis targets.; The blog announces a $6M seed while the Form D shows $3.98M sold from 57 investors, so the round may be largely closed and past the fund's entry point.; There is no open-source or public technical traction such as GitHub repos or launches; the traction evidence is customer testimonials and a backer list.; The consulting-style 'white-glove service' model may limit scalability.

**Score:** stage_fit 1.00 · recency 0.80 · geo 1.00 · relevance 0.30 · traction 1.00 · founder 0.45 · text_sim 0.73 · warm 0.00 · claude 0.57

`python run.py label 4 yes "why"` or `python run.py label 4 no "why"`

### 5. Craig Parker · Navidence, Inc. · score 0.65

**Raising now** (Form D): Form D: $4.5M round, 14 investors so far, filed 2025-12-29

**What they build:** A platform and library of expert-curated Computable Operational Definitions (code lists and phenotype algorithms) that life-sciences research teams use to design real-world evidence studies and assess data fitness in a way regulators accept.

**Why meet (Claude: fit 3/5, founder 4/5, stage seed):** Navidence builds computable, auditable study-design definitions that respond to FDA and ICH requirements for real-world evidence, and the team are deep insiders: Aaron Kamauu ran healthcare data strategy at Roche/Genentech and founded Anolinx, and CTO Craig Parker is an HL7 fellow and repeat founder. They have also shipped a product and signed partnerships with Datavant, Komodo Health, Panalgo, RTI and Trio Health. It is worth a meeting on the compliance and insider beliefs, but the evidence shows a curated knowledge and licensing business more than AI-native software, and there is no open-source or public technical signal.

> FDA guidances in 2021, 2023 and 2024 and ICH M4 guidances in 2025 all outline expectations that data definitions composed of standardized and mapped data elements and phenotype algorithm should be made available for each study design.
> — https://navidence.com (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model; Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Craig Parker, Aaron Kamauu; repeat founder: Craig Parker; site https://navidence.com (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001997962.

**Reach:** Aaron Kamauu

**Watch out:** The AI-native angle is thin: the only AI mention is a Komodo Health partnership headline, and the core product looks like a curated content library and data licensing.; No GitHub, open-source or other public technical traction signal, which the fund treats as its best early signal.; The team is a C-suite of veteran consulting and CRO executives rather than a small, lean technical team shipping weekly.; The round may be largely allocated: $3.0M of $4.5M sold to 14 investors, with Nina Capital and Grand Ventures announced as seed investors.; The website was guessed from the company name, but it lists Craig Parker and Aaron Kamauu as on the Form D and announces a seed raise in January 2026, so it appears to be the same company.

**Score:** stage_fit 1.00 · recency 0.60 · geo 0.40 · relevance 0.30 · traction 0.88 · founder 1.00 · text_sim 0.79 · warm 0.00 · claude 0.57

`python run.py label 5 yes "why"` or `python run.py label 5 no "why"`

### 6. Anders Brown · i2 Health Advisors Inc. · score 0.64

**Raising now** (Form D): Form D: $3.5M round, 12 investors so far, filed 2026-07-28

**What they build:** An AI-enabled consulting and system-integration firm that builds and operates automation workflows for health plans (prior auth, claims, risk adjustment, HEDIS, appeals) on top of Snowflake, UiPath, Salesforce and Anthropic.

**Why meet (Claude: fit 2/5, founder 3/5, stage seed):** The team are clear payer-industry insiders: they cite Facets, QNXT and CMS-0057-F, and Brian Anderson is a repeat founder. They target audit-sensitive workflows like risk adjustment under RADV and appeals that "hold up under audit." But this is a services and integration consultancy that says it "didn't build a proprietary platform," not the AI-native software the fund backs, so a meeting is only worth it if they plan to productize.

> We come from the payer industry, not a generalist consulting bench.
> — https://www.i2health.com/about-us (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later; Compliance and auditability are the moat in regulated AI, not the model

**Evidence:** team on filings: Anders Brown, Peter Biagioni, Brian Anderson; repeat founder: Brian Anderson; site https://www.i2health.com/ (from akta.pro company search); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002147485.

**Watch out:** Services/consulting business model, not a software product; they explicitly state they aren't selling a software platform; No open-source, GitHub or public product traction to evaluate technical execution; Services margins and scalability may not fit a venture software thesis; Form D lists $2.45M sold of a $3.5M round with 12 investors, so the round may already be well subscribed

**Score:** stage_fit 1.00 · recency 1.00 · geo 0.40 · relevance 0.30 · traction 0.85 · founder 1.00 · text_sim 0.95 · warm 0.00 · claude 0.33

`python run.py label 6 yes "why"` or `python run.py label 6 no "why"`

### 7. Matthew Broccolo · ShredPay, Inc. · score 0.63

**Raising now** (Form D): Form D: $1.5M round, 24 investors so far, filed 2026-06-08

**What they build:** A non-custodial stablecoin and crypto app plus embedded onchain infrastructure for institutions, offering fiat on/off ramps, risk-rated DeFi yield vaults, swaps and USDC payments, with KYC/AML and audit trails built in.

**Why meet (Claude: fit 2/5, founder 4/5, stage pre-seed):** The founders are deep financial-services insiders: two former OKX legal and compliance heads with Morgan Stanley and Schwab backgrounds, plus a former OKX VP of Product who also worked at Square. Their pitch of building compliance and audit trails in from the start matches the fund's moat belief. But ShredPay is a consumer and institutional stablecoin, DeFi-yield and payments platform with no visible AI component, so it sits outside the AI-native core of the thesis and is worth a meeting only if the fund wants to stretch into compliant crypto infrastructure.

> Move, earn, swap, and pay in stablecoins and crypto — with compliance, risk ratings, and security built in from the start.
> — https://www.shredpay.com/ (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model; Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Matthew Broccolo, Melissa Muehlfeld, Katelin Foss, Mauricio Beugelmans; site https://www.shredpay.com/ (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002129999.

**Reach:** Melissa Muehlfeld

**Watch out:** No evidence of AI or LLM use; the product is crypto/DeFi infrastructure, not AI-native software; Crypto and DeFi yield carry regulatory and volatility risk that may sit outside the fund's healthcare, insurance and financial-services focus; No GitHub, open-source or public traction metrics to check shipping cadence; Money transmission depends on a third party (Bridge/Stripe), so the core compliance rails are partly outsourced; The website was guessed from the company name, but the three co-founders it names also appear on the Form D, so it is likely the same company; Two of three co-founders are attorneys and the CTO's background is product leadership; hands-on engineering depth is unverified

**Score:** stage_fit 1.00 · recency 0.80 · geo 1.00 · relevance 0.30 · traction 0.97 · founder 0.45 · text_sim 0.93 · warm 0.00 · claude 0.40

`python run.py label 7 yes "why"` or `python run.py label 7 no "why"`

### 8. Richard Saffir · Kavia AI, Inc. · score 0.63

**Raising now** (Form D): Form D: $2.5M round, 9 investors so far, filed 2026-09-28

**What they build:** An enterprise AI platform that builds a knowledge graph of complex codebases to support onboarding, impact analysis, spec generation, code changes, testing and review.

**Why meet (Claude: fit 2/5, founder 4/5, stage seed):** Kavia AI builds an enterprise AI software-engineering platform for complex codebases. It is a horizontal dev-tools play, not AI-native software for healthcare, insurance or financial services. Its governance features (audit logs, SOC 2, self-hosted) touch the fund's auditability belief, but nothing shows a regulated-industry focus or founders from inside those industries. The CEO, Labeeb Ismail, has deep shipped work: he was a former Comcast/Sky SVP who led 2,000+ engineers and co-created the RDK video stack, now on 150M+ devices. The company also has named enterprise partners like Tata Elxsi, so it's a quality team but likely off-thesis for this fund.

> A persistent Enterprise Knowledge Graph of your system powers planning, code, tests, and governed delivery.
> — https://www.kavia.ai/ (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model

**Evidence:** team on filings: Richard Saffir, Labeeb Ismail; site https://www.kavia.ai/ (from akta.pro company search); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002134925.

**Reach:** Labeeb Ismail

**Watch out:** Horizontal developer tooling, not focused on healthcare, insurance or financial services; Founders come from telecom/enterprise engineering, not from inside regulated industries; Large executive-heavy team with a marketing head and CLO, which cuts against the 'small teams shipping weekly' belief; No open-source or public developer traction shown (no GitHub or HN evidence); Form D shows a $2.5M round with 2 filings and an incorporation listed as 2025, but the team's seniority suggests the company may be further along than pre-seed

**Score:** stage_fit 1.00 · recency 1.00 · geo 1.00 · relevance 0.30 · traction 0.81 · founder 0.45 · text_sim 0.95 · warm 0.00 · claude 0.40

`python run.py label 8 yes "why"` or `python run.py label 8 no "why"`

### 9. Anton Shumskikh · Neo Agent Inc. · score 0.61

**Raising now** (Form D): Form D: $2.7M round, 13 investors so far, filed 2026-09-01

**What they build:** An AI agent that works IT service desk tickets end to end for managed service providers, such as onboarding, password resets, triage and alert response, across their PSA, RMM and Microsoft stack, with technician approval and per-tool permissions.

**Why meet (Claude: fit 2/5, founder 3/5, stage seed):** Neo Agent builds an AI service-desk agent for IT managed service providers, which is outside the fund's healthcare, insurance and financial services focus, even though its approval gates, per-tool permissions, action logging and SOC 2 Type 2 echo the fund's auditability belief. The product shows real traction ("TRUSTED BY 250+ MSPs", named customer case studies) and a $2.7M round, but there is no evidence of the founders' domain background or of any regulated-industry angle.

> Every action is logged, reversible, and in plain English.
> — https://www.neoagent.io/ (verified)

**Shared beliefs:** Compliance and auditability are the moat in regulated AI, not the model

**Evidence:** team on filings: Anton Shumskikh, Nikhil Sehgal; directors from Lookout Ventures I; site https://www.neoagent.io/ (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002152778.

**Watch out:** Off-thesis vertical: customers are IT MSPs, not healthcare, insurance or financial services.; The website was guessed from the company name. The AI-agent product and the Neo Agent name are consistent with the Form D, but nothing on the page names the founders or confirms the link.; No evidence about the founders' backgrounds, prior companies or industry depth.; No open-source or public technical traction to evaluate.; Lookout Ventures already has a director seat, and 13 investors are in the round, so this may be a late or crowded seed for a pre-seed/seed fund.

**Score:** stage_fit 1.00 · recency 1.00 · geo 0.40 · relevance 0.30 · traction 0.87 · founder 0.75 · text_sim 0.88 · warm 0.00 · claude 0.33

`python run.py label 9 yes "why"` or `python run.py label 9 no "why"`

### 10. Peymon Ghazi · Malcova, Inc · score 0.60

**Raising now** (Form D): Form D: $2.0M round, 12 investors so far, filed 2026-09-08

**What they build:** A low-dose Narrow-Beam CT imaging system for early detection of breast cancer in dense tissue and of stroke, supported by digital and physical twins and an AI assistant for radiologists.

**Why meet (Claude: fit 2/5, founder 4/5, stage seed):** Malcova is a hardware-first medical imaging company built around a patented Narrow-Beam CT scanner, with an AI diagnostic agent as one add-on. That puts it in healthcare but outside the fund's thesis of AI-native compliance and paperwork software. The founders are credible insiders: Peymon Ghazi is an imaging physicist with 10+ years in diagnostic radiology, the company has NSF and NIH funding, and it has sold $1.2M of a $2.0M round, so a meeting only makes sense if the fund wants to stretch into med-device.

> AI-based Diagnostic Agent
> — https://malcova.com/ (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Peymon Ghazi, Tara Ghazi; site https://www.malcova.com (from akta.pro company search); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002152940.

**Reach:** Dr. Peymon Ghazi

**Watch out:** The core product is medical imaging hardware (CT), not AI-native software for compliance or paperwork, so it is off-thesis.; The FDA device pathway and capital intensity don't match the 'small teams shipping weekly' belief.; The AI diagnostic agent is only briefly mentioned, with no evidence of audit trails, data controls or compliance tooling.; There is no open-source or public traction signal beyond government grants and the Form D.; The website matches the Form D (same founders, breast cancer imaging), so the identity looks consistent.

**Score:** stage_fit 1.00 · recency 1.00 · geo 1.00 · relevance 0.30 · traction 0.85 · founder 0.45 · text_sim 0.71 · warm 0.00 · claude 0.40

`python run.py label 10 yes "why"` or `python run.py label 10 no "why"`

### 11. Herbert Barrack · Limber Prosthetics, Inc. · score 0.59

**Raising now** (Form D): Form D: $5.3M round, 40 investors so far, filed 2026-08-18

**What they build:** Limber makes fully 3D-printed, monolithic transtibial prostheses (the Px1) produced through a digital scan-design-fabricate workflow for orthotics and prosthetics clinics.

**Why meet (Claude: fit 2/5, founder 4/5, stage seed):** Limber is a strong, commercial-stage medical device company: PhD engineer founders plus a clinical co-founder, commercial since fall 2024 with "many hundreds of patients" on the Px1, and a $5.3M Form D round with 40 investors. But it is 3D-printed prosthetic hardware with a supporting scan/design/fabricate workflow, not AI-native compliance or audit software, so it sits outside the fund's thesis despite being in healthcare.

> The clinical decisions that drive those codes get captured inside our iOS app as you scan and spec, so the billing picture takes shape alongside the fit.
> — https://limberprosthetics.com/products/px1/ (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Herbert Barrack, Luca Nicoloso, Joshua Pelz, Walker White; site https://limberprosthetics.com (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002072119.

**Reach:** Joshua Pelz

**Watch out:** Off-thesis: a hardware medical device company, not AI-native software for compliance or paperwork.; No visible AI, LLM or audit-trail product; the software is limited to an iOS scan and order app that captures reimbursement coding.; Capital-intensive manufacturing model conflicts with the fund's small-team, software-first belief.; Round size ($5.3M, about $3.77M sold, second filing) may be at the upper end of the fund's stage.; Website was guessed from the company name, but names (Pelz, Barrack, White, Nicoloso) and San Diego location match the Form D, so it appears to be the same company.

**Score:** stage_fit 0.95 · recency 1.00 · geo 1.00 · relevance 0.30 · traction 1.00 · founder 0.45 · text_sim 0.46 · warm 0.00 · claude 0.40

`python run.py label 11 yes "why"` or `python run.py label 11 no "why"`

### 12. Karim Pourak · ProcessMiner, Inc. · score 0.58

**Raising now** (Form D): Form D: $3.4M round, 1 investors so far, filed 2026-05-19

**What they build:** An AI platform that predicts product quality every 30 seconds in continuous-manufacturing plants, ranks root causes of drift and recommends or automates setpoint corrections.

**Why meet (Claude: fit 1/5, founder 4/5, stage seed):** ProcessMiner builds physical AI for continuous manufacturing (pulp & paper, nonwovens, water), which is outside the fund's healthcare, insurance and financial services thesis despite surface overlap on AI agents and automation. The team is strong on evidence: founded in 2015, 50+ plant deployments, 20+ major paper manufacturers, and a Georgia Tech chaired professor as CSO. That merits a referral, not a thesis-driven meeting.

> Answers from your plant's own data and documents, not the open internet
> — https://processminer.com (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Karim Pourak, Tom Morris, Kamran Paynabar; repeat founder: Tom Morris; site https://processminer.com (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002133227.

**Watch out:** Off-thesis: industrial manufacturing (pulp & paper, nonwovens, plastics, water), not healthcare, insurance or financial services.; Not an early-stage company in practice: operating since 2015 with 50+ deployments, despite the 'seed' label on its first external round in April 2026.; Form D says incorporated 2025 while the site says founded 2015, which suggests a re-incorporation or new entity worth checking.; Form D location reads 'Atlanta, CA' but the site says Atlanta's Tech Square, likely a data error.; The guessed website appears to be the same company: Karim Pourak, Kamran Paynabar and Tom Morris all appear on both.; Tom Morris, flagged as a repeat founder, is the CFO, not a founder; the CEO's two earlier AI health analytics ventures are mentioned without detail.; No open-source or public technical traction signal (no GitHub or HN) beyond academic publications.

**Score:** stage_fit 1.00 · recency 0.80 · geo 1.00 · relevance 0.30 · traction 0.52 · founder 1.00 · text_sim 0.94 · warm 0.00 · claude 0.23

`python run.py label 12 yes "why"` or `python run.py label 12 no "why"`

### 13. Adolfo Velazquez · ROSE DIAGNOSTICS INC. · score 0.57

**Raising now** (Form D): Form D: $3.0M round, 18 investors so far, filed 2026-09-15

**What they build:** A portable 5-minute rapid diagnostic test and reader that tells clinicians during a lung biopsy whether the collected specimen is sufficient for analysis.

**Why meet (Claude: fit 1/5, founder 4/5, stage seed):** Rose Diagnostics is building a point-of-care medical device (the verifi LUNG rapid biopsy sufficiency test with a cartridge and reader), not AI-native software, so it falls outside the fund's thesis despite being in healthcare. The founders are strong industry insiders, including Eric Brouwer, who led i-STAT's CHEM8+, and Adolfo Velazquez, who led Quidel SOFIA tests, but that expertise is in diagnostics hardware and FDA device pathways, not regulated AI software.

> ROSE Diagnostics is comprised of like-minded scientists, product developers, clinical partners, business leaders, and regulatory experts.
> — https://www.rose-dx.com/about-us (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later

**Evidence:** team on filings: Adolfo Velazquez, Donna Padavan, Andrew Morris, Eric Brouwer; site https://www.rose-dx.com/ (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002027716.

**Reach:** Andrew Morris

**Watch out:** Off-thesis: this is a hardware and in-vitro diagnostic medical device with no evidence of AI or software, not AI-native software.; Long FDA device regulatory path; the site states the product is not FDA cleared or approved in any jurisdiction.; Multiple prior Reg D rounds ($1M seed, $2.3M, $2.7M, now a $3.0M Form D with 18 investors) suggest a capital-intensive device company rather than a small software team shipping weekly.; No open-source or public software traction signal.; The website was guessed from the company name, but the founder names on the About page match the Form D, so it appears to be the same company.

**Score:** stage_fit 1.00 · recency 1.00 · geo 1.00 · relevance 0.30 · traction 0.92 · founder 0.45 · text_sim 0.76 · warm 0.00 · claude 0.23

`python run.py label 13 yes "why"` or `python run.py label 13 no "why"`

### 14. Derek Harn · COUNT Financial, Inc. · score 0.57

**Raising now** (Form D): Form D: $4.0M round, 10 investors so far, filed 2026-09-17

**What they build:** Unknown: the Form D describes only a 2024 Washington technology company named COUNT Financial, Inc., with no product details.

**Why meet (Claude: fit 2/5, founder 2/5, stage seed):** The only reliable evidence is a Form D for COUNT Financial, Inc., a 2024 Lake Stevens, WA company classed as 'Other Technology'. It has raised about $3.95M of a $4.0M round from 10 investors, and Christopher Smith is flagged as a repeat founder. The name hints at financial services, but nothing shows AI-native, compliance or audit-focused software, so this is at most a low-priority intro to learn what they actually build.

> You should talk to a financial adviser before making any financial decisions.
> — https://www.count.au/ (closest sentence to the thesis)

**Evidence:** team on filings: Derek Harn, Christopher Smith; repeat founder: Christopher Smith; site https://www.count.au/ (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002153764.

**Reach:** Christopher Smith

**Watch out:** The guessed website (count.au) is Count Limited, an ASX-listed Australian accounting and wealth network operating since 1980. It is not the 2024 Washington-incorporated COUNT Financial, Inc., so it was disregarded.; Thin evidence: no product description, website, GitHub or public traction for the actual company.; The 'Other Technology' classification and 'Financial' name do not confirm AI, regulated-industry software or a compliance angle.; A $4M round from 10 investors may be at the top of the fund's seed range.; Repeat-founder status for Christopher Smith is noted, but the prior company and its outcome are unknown.

**Score:** stage_fit 1.00 · recency 1.00 · geo 0.40 · relevance 0.30 · traction 0.82 · founder 1.00 · text_sim 0.64 · warm 0.00 · claude 0.25

`python run.py label 14 yes "why"` or `python run.py label 14 no "why"`

### 15. Shara Cohen · Carallel, Inc. · score 0.57

**Raising now** (Form D): Form D: $3.0M round, 10 investors so far, filed 2026-07-29

**What they build:** Carallel identifies family caregivers among health plan members, patients and employees and supports them through trained Care Advocates and a companion app.

**Why meet (Claude: fit 2/5, founder 3/5, stage seed):** Carallel sells into health plans, providers and employers, and its CEO Shara Cohen has 20+ years in patient engagement, including Emmi Solutions through its 2016 acquisition by Wolters Kluwer Health, so the team clearly comes from inside healthcare. But the product is a human-led, tech-enabled caregiver support service with no visible AI, compliance or auditability angle, so it misses the fund's AI-native, compliance-as-moat thesis and probably isn't worth a meeting.

> Carallel provides personalized guidance and digital health tools to identify caregivers and empower them to confidently manage the twists and turns of caregiving.
> — https://carallel.com (verified)

**Shared beliefs:** Founders from inside the industry beat generalists who discover it later

**Evidence:** directors from BlueCross BlueShield Venture Partners V; site https://carallel.com (guessed from the company name; check it is the same company); source https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001955339.

**Watch out:** No evidence of AI, LLMs or automation in the product; the site describes 'Human-led and tech-enabled solutions'.; No compliance, audit-trail or regulatory angle visible, which is the fund's core moat belief.; Business looks services-heavy because Care Advocates deliver support, unlike the fund's preference for small software teams shipping weekly.; Leadership is not technical: the CEO and co-founder are lawyers and the CIO's background is media and enterprise IT, with no open-source or public technical traction.; Stage may be later than it looks: the team is established, BlueCross BlueShield Venture Partners sits on the board, the $3.0M round has 10 investors and there are 2 filings.; The website was guessed from the company name, but its CEO (Shara Cohen), Chicago base and Carallel, Inc. name match the Form D, so it appears to be the same company.

**Score:** stage_fit 1.00 · recency 1.00 · geo 0.40 · relevance 0.30 · traction 0.82 · founder 0.75 · text_sim 0.64 · warm 0.00 · claude 0.33

`python run.py label 15 yes "why"` or `python run.py label 15 no "why"`

