"""10,000 composable, tool-free specialist profiles, retrieved locally on demand.

These are 100 evidence domains x 100 procedures, not 10,000 trained models or
running processes. Only selected profiles enter a prompt; no customer data is
cached here. IDs are stable domain.procedure pairs and need no database rows.
"""
from collections import defaultdict
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class Axis:
    id: str
    title: str
    aliases: str
    instruction: str
    specialty: str = 'execution'


def _domains():
    groups = (
        ('Use exact versions, minimal reproductions and official language/runtime documentation. Distinguish suggested code from executed tests.', (
            'python|Python|pip pytest django flask',
            'javascript|JavaScript|node nodejs npm browser js',
            'typescript|TypeScript|ts types nextjs react next.js',
            'rust|Rust|cargo rustc borrowing',
            'go|Go programming|golang goroutines',
            'java|Java|jvm maven gradle spring',
            'dotnet|Dotnet and C sharp|csharp dotnet asp.net',
            'swift|Swift|ios xcode apple swiftui',
            'kotlin|Kotlin|android kotlin coroutines',
            'ruby|Ruby|rails bundler gems',
        )),
        ('Use actual configuration, logs and measurements. Preserve credentials, existing data and deployment ownership. Never infer a successful rollout from source changes.', (
            'api-design|API design|rest graphql endpoints http api',
            'databases|Databases|postgres postgresql mysql sql sqlite database',
            'cloud-infrastructure|Cloud infrastructure|aws azure gcp cloud',
            'containers|Containers|docker kubernetes k8s container',
            'continuous-delivery|Continuous delivery|cicd ci cd github actions deployment',
            'observability|Observability|telemetry metrics tracing logs incident',
            'security|Application security|auth authentication authorization oauth csrf xss',
            'networking|Networking|dns tcp tls proxy network',
            'performance|Software performance|latency throughput profiling cache speed',
            'ai-systems|AI systems|llm agents inference tokens prompts embeddings ai',
        )),
        ('Check grain, units, missing values, provenance and sample size. Use reproducible calculations and label estimates; do not fabricate data or statistical significance.', (
            'data-cleaning|Data cleaning|duplicates normalization dedup missing data',
            'data-pipelines|Data pipelines|etl elt ingestion airflow dbt pipeline',
            'analytics|Analytics|kpi cohort funnel analytics',
            'statistics|Statistics|probability confidence hypothesis statistics',
            'spreadsheets|Spreadsheets|excel sheets xlsx spreadsheet csv',
            'visualization|Data visualization|charts plots dashboard visualization',
            'machine-learning|Machine learning|training regression classification machine learning',
            'experiments|Experiments|ab testing randomized experiment causal',
            'forecasting|Forecasting|forecast time series seasonality',
            'data-governance|Data governance|lineage privacy retention catalog governance',
        )),
        ('Ground findings in supplied records and dated primary sources. Distinguish customer evidence from assumptions and proposals from completed business actions.', (
            'market-research|Market research|market tam sam som market sizing',
            'competitor-research|Competitor research|competitor competition battlecard',
            'company-research|Company research|company companies firm firmographics',
            'sales|Sales|sales pipeline deals qualification',
            'customer-success|Customer success|renewal churn onboarding retention',
            'marketing|Marketing|marketing campaign positioning audience',
            'growth|Growth|acquisition conversion activation growth',
            'partnerships|Partnerships|partner alliance ecosystem partnership',
            'procurement|Procurement|vendor supplier procurement rfp',
            'strategy|Business strategy|strategy strategic moat business model',
        )),
        ('Use observed user behavior and stated requirements. Check accessibility, recovery, interaction states and responsive constraints; do not claim visual or user testing that did not occur.', (
            'product-management|Product management|roadmap prd product requirements',
            'user-research|User research|interview usability persona user research',
            'interface-design|Interface design|ui interface layout component',
            'interaction-design|Interaction design|ux flow navigation interaction',
            'accessibility|Accessibility|a11y wcag keyboard screen reader',
            'design-systems|Design systems|tokens typography design system',
            'mobile-products|Mobile products|mobile app touch responsive',
            'web-products|Web products|website landing page web frontend',
            'product-discovery|Product discovery|discovery opportunity validation',
            'product-pricing|Product pricing|pricing packaging subscription tiers',
        )),
        ('Respect the requested audience, tone, length and source meaning. Mark invented examples. Drafting never implies publication, sending, legal approval or factual verification.', (
            'technical-writing|Technical writing|documentation docs readme technical writing',
            'business-writing|Business writing|memo proposal executive business writing',
            'copywriting|Copywriting|copy headline copywriting tagline',
            'editing|Editing|edit proofreading rewrite grammar',
            'translation|Translation|translate translation localization bilingual',
            'presentations|Presentations|slides deck presentation powerpoint',
            'email-writing|Email writing|email gmail inbox outreach',
            'social-content|Social content|social linkedin instagram posts',
            'storytelling|Storytelling|story narrative fiction storytelling',
            'meeting-communication|Meeting communication|meeting agenda minutes briefing',
        )),
        ('Work from actual owners, constraints and receipts. Separate plans from execution. External actions, spending, scheduling and outbound communications remain subject to the main agent’s authorization tools.', (
            'project-management|Project management|project milestone dependencies timeline',
            'operations|Operations|operations runbook sop workflow',
            'hiring|Hiring|recruiting candidates hiring sourcing',
            'people-operations|People operations|hr people onboarding policy',
            'customer-support|Customer support|support ticket helpdesk escalation',
            'logistics|Logistics|shipping logistics freight delivery',
            'inventory|Inventory|stock warehouse inventory reorder',
            'event-planning|Event planning|event venue attendees conference',
            'travel-planning|Travel planning|travel trip flight hotel itinerary',
            'process-improvement|Process improvement|process bottleneck lean efficiency',
        )),
        ('Preserve currency, period, assumptions and source dates. Reconcile calculations. Financial material is analytical support, not a guarantee or permission to transact; flag professional-review needs.', (
            'budgeting|Budgeting|budget spend expenses budgeting',
            'accounting|Accounting|ledger reconciliation accounting accrual',
            'financial-modeling|Financial modeling|valuation financial model dcf',
            'fundraising|Fundraising|raise fundraising pitch investors',
            'venture-capital|Venture capital|vc venture fund thesis startups',
            'unit-economics|Unit economics|cac ltv margin payback unit economics',
            'cash-flow|Cash flow|cash runway burn liquidity',
            'revenue-operations|Revenue operations|revops revenue bookings arr mrr',
            'financial-reporting|Financial reporting|balance sheet income statement financial report',
            'cost-optimization|Cost optimization|cost cheaper savings spend optimization',
        )),
        ('Use the sector’s actual supplied evidence and dated authoritative sources. Note jurisdiction, context and domain-expert review limits; do not invent operational access or professional certification.', (
            'climate|Climate technology|climate carbon decarbonization emissions',
            'energy|Energy transition analysis|energy emissions decarbonization electricity',
            'geography|Geographic consistency|geography terrain climate maps worldbuilding',
            'manufacturing|Manufacturing operations|manufacturing factory production quality',
            'retail|Retail growth|retail ecommerce shop conversion',
            'education|Learning design|education curriculum teaching training',
            'real-estate|Real estate|property real estate rent buildings',
            'media|Media|media publishing journalism content',
            'nonprofits|Nonprofits|nonprofit grants charity donors',
            'regulatory-compliance|Regulatory compliance|compliance regulation privacy policy jurisdiction',
        )),
        ('Adapt to the user’s stated level, time and materials. Show checkable steps and uncertainty. Do not claim external actions, real-world testing or access to private records.', (
            'general-work|General work|task general work assistant',
            'personal-productivity|Personal productivity|productivity priorities focus todo',
            'learning|Learning|learn study practice lesson tutoring',
            'quantitative-reasoning|Quantitative evidence|quantitative statistics math evidence claims',
            'science|Science|science physics chemistry biology',
            'history|History|history historical chronology',
            'languages|Language learning|vocabulary language pronunciation',
            'career|Career development|career resume cv interview job',
            'creative-projects|Creative projects|creative brainstorm art music',
            'decision-making|Decision making|decision tradeoff choice options',
        )),
    )
    return tuple(Axis(*row.split('|'), guard) for guard, rows in groups for row in rows)


def _procedures():
    # Each row defines a different deliverable, not a numbered copy of a prompt.
    groups = (
        ('research', 'Use supplied evidence; request current-source tools from the main agent when facts may have changed.', (
            'source-brief|Source brief|research brief|Produce a concise question-led brief with linked evidence and unresolved questions.',
            'source-map|Source map|sources bibliography|Rank primary sources by authority, freshness and coverage; identify gaps.',
            'fact-check|Fact check|verify claims fact check|Split claims into supported, contradicted and unverified with exact supporting evidence.',
            'landscape|Landscape map|landscape ecosystem|Group the relevant actors or approaches and explain the boundaries of each group.',
            'timeline|Timeline|timeline chronology|Order dated events and distinguish publication dates from event dates.',
            'glossary|Glossary|terms glossary definitions|Define the essential terms, ambiguities and context-specific meanings.',
            'evidence-gaps|Evidence gap analysis|unknown missing evidence|List unanswered decision-critical questions and the sources needed to resolve them.',
            'interview-guide|Interview guide|questions interview guide|Draft neutral questions tied to hypotheses and expected evidence.',
            'trend-brief|Trend brief|trends changes|Separate observed changes, time windows, plausible causes and unsupported extrapolation.',
            'source-conflicts|Source conflict review|conflicting sources reconcile|Compare contradictory evidence by date, scope and methodology; preserve unresolved differences.',
        )),
        ('analysis', 'Show reproducible reasoning; preserve units, sample limits and assumptions.', (
            'comparison|Comparison|compare versus comparison|Compare alternatives on the same explicit criteria and identify tradeoffs.',
            'root-cause|Root cause analysis|root cause why cause|Separate symptoms from candidate causes and propose discriminating checks.',
            'sensitivity|Sensitivity analysis|sensitivity assumptions|Identify which assumptions change the result most and bound plausible outcomes.',
            'scenario-analysis|Scenario analysis|scenarios worst best case|Define plausible scenarios, triggers and consequences without invented probabilities.',
            'unit-check|Unit check|units dimensions currency|Reconcile dimensions, currency, period and denominators before comparing values.',
            'outliers|Outlier review|outliers anomalies|Flag unusual observations and distinguish errors from legitimate exceptions.',
            'segmentation|Segmentation|segments groups cohorts|Define actionable groups using observable criteria and explain boundary cases.',
            'constraint-map|Constraint map|constraints limits|List hard constraints, preferences, dependencies and feasibility conflicts.',
            'assumption-review|Assumption review|assumptions premise|Extract assumptions, confidence, impact and the cheapest way to validate each.',
            'estimate|Bounded estimate|estimate approximate sizing|Build a transparent range from stated inputs; label missing inputs and uncertainty.',
        )),
        ('planning', 'Recommend bounded steps with owners, dependencies, checks and rollback where relevant.', (
            'execution-plan|Execution plan|plan steps execute|Break the objective into ordered actions with evidence-based completion checks.',
            'milestones|Milestone plan|milestones roadmap|Define outcomes, sequencing, dependencies and realistic acceptance criteria.',
            'contingency|Contingency plan|contingency backup fallback|Specify failure triggers, safe alternatives and recovery criteria.',
            'validation-plan|Validation plan|validation tests verify|Choose checks that could falsify the proposal and define expected observations.',
            'resource-plan|Resource plan|resources capacity staffing|Match work to actual capacity, constraints and capability gaps.',
            'migration-plan|Migration plan|migration transition|Plan incremental transition, compatibility, preservation checks and rollback.',
            'launch-plan|Launch plan|launch rollout release|Define readiness gates, monitoring, ownership and stop conditions.',
            'discovery-plan|Discovery plan|discovery investigate|Sequence the cheapest high-information questions before expensive commitments.',
            'measurement-plan|Measurement plan|measure metrics instrument|Define metrics, baselines, collection methods and practical attribution limits.',
            'handoff-plan|Handoff plan|handoff transfer|Package current state, decisions, evidence, exact pending work and ownership.',
        )),
        ('writing', 'Return usable draft content, grounded in supplied facts, without claiming it has been sent or published.', (
            'summary|Concise summary|summarize summary tldr|Preserve the main finding, supporting facts and important limitations in concise prose.',
            'executive-brief|Executive brief|executive memo brief|Lead with the decision, explain implications and name the action or missing evidence.',
            'proposal|Proposal|proposal recommend|State the problem, proposed approach, alternatives, costs and acceptance criteria.',
            'instructions|Instructions|instructions how to guide|Write ordered practical steps with prerequisites and observable success checks.',
            'checklist|Checklist|checklist preflight|Create an actionable nonredundant checklist with checkable pass conditions.',
            'faq|Frequently asked questions|faq questions answers|Answer likely questions directly, including limitations and recovery paths.',
            'announcement|Announcement draft|announce announcement|State what changed, who is affected, when and what action is needed.',
            'rewrite|Clear rewrite|rewrite simplify edit|Improve clarity and structure while preserving facts, scope and requested tone.',
            'outline|Structured outline|outline structure|Organize the intended deliverable around the audience’s questions and evidence.',
            'status-report|Status report|status update report|Distinguish completed verified work, active work, blockers and next steps.',
        )),
        ('review', 'Find concrete evidence-backed defects; distinguish confirmed failures from risks and suggestions.', (
            'quality-review|Quality review|review quality critique|Check the deliverable against its purpose and flag actionable defects by impact.',
            'risk-review|Risk review|risk risks|Identify failure scenarios, likelihood evidence, impact and practical mitigations.',
            'consistency-review|Consistency review|consistency contradictory|Find internal contradictions in names, numbers, assumptions and commitments.',
            'completeness-review|Completeness review|complete completeness missing|Compare the output with each stated requirement and identify omissions.',
            'privacy-review|Privacy review|privacy sensitive data|Identify unnecessary personal data, exposure paths and minimization opportunities.',
            'security-review|Security review|security threats abuse|Trace trust boundaries, attack preconditions, impact and focused controls.',
            'accessibility-review|Accessibility review|accessibility inclusive|Check understandable language, accessible structure and barriers relevant to the deliverable.',
            'claim-review|Claim review|claims promises overstate|Locate unsupported or overstated promises and replace them with precise scoped wording.',
            'freshness-review|Freshness review|fresh current stale|Identify time-sensitive facts and evidence that must be refreshed before use.',
            'acceptance-review|Acceptance review|acceptance criteria done|Evaluate each completion criterion against actual receipts; never equate a plan with execution.',
        )),
        ('execution', 'Structure supplied information precisely; preserve original values and label missing information.', (
            'requirements-map|Requirements map|requirements specification|Map requirements to proposed behavior, owners and verification evidence.',
            'dependency-map|Dependency map|dependencies dependency|Identify prerequisites, sequencing and cycles; separate hard from optional dependencies.',
            'stakeholder-map|Stakeholder map|stakeholders owners|Identify roles, decisions, responsibilities and unknown ownership.',
            'workflow-map|Workflow map|workflow process flow|Map inputs, transformations, decisions, outputs and recovery states.',
            'data-dictionary|Data dictionary|fields schema dictionary|Define fields, types, meanings, units, provenance and valid missing states.',
            'decision-log|Decision log|decisions rationale|Record decisions, alternatives, rationale, evidence and revisit triggers.',
            'issue-triage|Issue triage|triage issues bugs|Group issues by confirmed cause and impact; define reproducible next checks.',
            'action-items|Action items|actions todo next steps|Extract concrete tasks, owners if known, dependencies and completion evidence.',
            'entity-extraction|Entity extraction|extract entities names|Extract only explicitly supplied entities with context and ambiguity preserved.',
            'normalization|Normalization recipe|normalize clean standardize|Specify reversible normalization rules and flag values requiring human interpretation.',
        )),
        ('analysis', 'Prioritize using stated goals and evidence rather than invented weights or precision.', (
            'prioritization|Prioritization|prioritize priority rank|Rank work by impact, urgency, effort and dependencies; expose subjective judgments.',
            'opportunity-score|Opportunity assessment|opportunity score|Assess fit, evidence, constraints and uncertainty against explicit criteria.',
            'effort-estimate|Effort estimate|effort complexity|Break effort into components, unknowns and ranges rather than false exact deadlines.',
            'cost-review|Cost review|cost costs savings cheaper|Identify avoidable spend, assumptions and quality-preserving lower-cost alternatives.',
            'benefit-review|Benefit review|benefit value roi|Connect claimed benefits to measurable outcomes and evidence; qualify speculative value.',
            'tradeoff-review|Tradeoff review|tradeoff compromise|Explain what each alternative improves, sacrifices and leaves uncertain.',
            'feasibility|Feasibility check|feasible viability|Test the plan against hard constraints and required unavailable capabilities.',
            'reversibility|Reversibility review|reversible rollback undo|Separate reversible steps from commitments and design useful rollback checks.',
            'critical-path|Critical path|critical path schedule|Identify dependent bottlenecks and parallelizable independent work.',
            'decision-matrix|Decision matrix|decision matrix options|Compare options with transparent criteria; avoid unsupported weighted totals.',
        )),
        ('review', 'Diagnose from available evidence; proposed fixes are unexecuted until the main agent obtains tool receipts.', (
            'reproduction|Reproduction recipe|reproduce reproduction|Define minimal inputs, environment, steps, expected and actual outcomes.',
            'failure-modes|Failure mode analysis|failure modes failure|Enumerate realistic failure modes and checks that detect them before harm.',
            'recovery-runbook|Recovery runbook|recovery retry restore|Give bounded recovery steps with preservation, stop and escalation conditions.',
            'bottleneck-review|Bottleneck review|bottleneck slow latency|Separate measured timing stages from guessed causes; propose the next discriminating measurement.',
            'regression-check|Regression check|regression broke|Compare old and new behavior under identical inputs and preserve unrelated outcomes.',
            'boundary-cases|Boundary case review|boundary edge cases|Check empty, missing, malformed, extreme and incompatible inputs.',
            'concurrency-review|Concurrency review|race concurrent duplicate|Trace overlapping operations, ordering, idempotency and stale-result risks.',
            'compatibility|Compatibility review|compatibility version legacy|Check version, format, contract and existing-data compatibility.',
            'incident-brief|Incident brief|incident outage postmortem|Separate timeline, observed impact, known cause, unresolved cause and corrective work.',
            'verification-recipe|Verification recipe|prove verification receipts|Specify observable end-to-end checks with exact expected evidence and limitations.',
        )),
        ('writing', 'Teach with checkable examples appropriate to the user’s level and flag simplifications.', (
            'plain-explanation|Plain explanation|explain simple meaning|Explain the concept with familiar language and a grounded example.',
            'worked-example|Worked example|example demonstrate|Work through a labeled example with intermediate reasoning and checks.',
            'tutorial|Tutorial|tutorial learn lesson|Teach prerequisites, a bounded exercise and how to verify the result.',
            'analogy|Careful analogy|analogy metaphor|Give an intuitive analogy and explain where it stops matching reality.',
            'misconceptions|Misconception review|misconceptions mistakes|Identify common misunderstandings and correct them with evidence.',
            'practice|Practice exercise|practice exercises quiz|Create progressive exercises and separate the solution from the prompt.',
            'learning-plan|Learning plan|study learning plan|Sequence concepts and practice around the user’s goal and time.',
            'cheat-sheet|Quick reference|cheat sheet reference|Provide a compact reference with correct terms, patterns and cautions.',
            'audience-adaptation|Audience adaptation|audience tone adapt|Adapt content to the stated audience while preserving material qualifications.',
            'teach-back|Teach-back check|understanding teach back|Ask focused checks that distinguish comprehension from memorized phrasing.',
        )),
        ('execution', 'Prepare a concrete output the main agent can verify and deliver; do not claim tools or external actions.', (
            'table|Comparison table|table columns rows|Organize comparable facts into consistent columns with missing values labeled.',
            'structured-data|Structured data|json structured yaml|Produce syntactically valid structured data matching the requested fields and types.',
            'template|Reusable template|template reusable|Create a reusable structure with clear placeholders and completion guidance.',
            'rubric|Evaluation rubric|rubric scoring criteria|Define observable criteria and anchored ratings without invented evaluation results.',
            'acceptance-tests|Acceptance test cases|test cases acceptance|Write input/action/expected-result cases that independently test the requirements.',
            'experiment-design|Experiment design|experiment design test hypothesis|Define the hypothesis, controls, measurements and limits on causal inference.',
            'implementation-brief|Implementation brief|implement specification build|Translate the goal into contracts, constraints and verifiable implementation steps.',
            'review-packet|Review packet|review packet approval|Assemble the proposed result, evidence, exact open questions and decisions needed.',
            'delivery-check|Delivery check|deliver export artifact|Check output format, completeness, provenance, accessible links and stated limitations.',
            'followup-brief|Follow-up brief|follow up pending next|Record what remains and why, without scheduling or sending anything unrequested.',
        )),
    )
    return tuple(Axis(*row.split('|')[:3], row.split('|')[3]+' '+guard, specialty)
                 for specialty, guard, rows in groups for row in rows)


DOMAINS = _domains()
PROCEDURES = _procedures()
DOMAIN_BY_ID = {item.id: item for item in DOMAINS}
PROCEDURE_BY_ID = {item.id: item for item in PROCEDURES}
CATALOG_SIZE = len(DOMAINS) * len(PROCEDURES)
STOP_WORDS = set('a an and are as at be by can do for from help i in is it me my of on or please that the these this to us we with you your'.split())


def _words(value):
    return set(re.findall(r'[a-z0-9]+', value.casefold())) - STOP_WORDS


def _index(items):
    index = defaultdict(dict)
    for item in items:
        for token in _words(item.id+' '+item.title):
            index[token][item.id] = 4
        for token in _words(item.aliases):
            index[token].setdefault(item.id, 2)
    return dict(index)


DOMAIN_INDEX = _index(DOMAINS)
PROCEDURE_INDEX = _index(PROCEDURES)


def get_skill(skill_id):
    if not isinstance(skill_id, str) or len(skill_id) > 120 or skill_id.count('.') != 1:
        return None
    domain_id, procedure_id = skill_id.split('.')
    domain, procedure = DOMAIN_BY_ID.get(domain_id), PROCEDURE_BY_ID.get(procedure_id)
    if not domain or not procedure:
        return None
    from app.services.specialist_sources import source_for
    domain_source = source_for('domain', domain_id)
    procedure_source = source_for('procedure', procedure_id)
    if not domain_source or not procedure_source:
        return None
    sources = {source['url']: source for source in (domain_source, procedure_source)}
    return {
        'id': skill_id, 'name': f'{domain.title}: {procedure.title}',
        'specialty': procedure.specialty,
        'instructions': (f'Domain: {domain.title}. {domain.instruction}\nProcedure: {procedure.title}. {procedure.instruction}'
                         '\nReviewed upstream workflow: ' + ' '.join(dict.fromkeys(source['guidance'] for source in sources.values()))),
        'mode': 'tool_free_advice',
        'sources': list(sources.values()),
        'eligibility': {'eligible': True, 'minimum_stars': 10000, 'reason': 'reviewed_pinned_github_sources'},
    }


def eligible_catalog_size():
    from app.services.specialist_sources import source_for
    return (sum(source_for('domain', item.id) is not None for item in DOMAINS)
            * sum(source_for('procedure', item.id) is not None for item in PROCEDURES))


def compact_skill_card(card):
    """Model-facing receipts omit redundant hashes; API details retain provenance."""
    return {**card, 'sources': [{key: source[key] for key in
            ('repository', 'url', 'stars', 'checked_at', 'license')} for source in card['sources']]}


def fallback_skill_ids(limit=5):
    from app.services.specialist_sources import source_for
    domains = [item for item in DOMAINS if source_for('domain', item.id)]
    procedures = [item for item in PROCEDURES if source_for('procedure', item.id)]
    result = []
    for domain in domains:
        for procedure in procedures:
            result.append(domain.id+'.'+procedure.id)
            if len(result) == limit:
                return result
    return result


def _rank(query, index):
    scores = defaultdict(int)
    for word in _words(query):
        for item_id, weight in index.get(word, {}).items():
            scores[item_id] += weight
    return sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))


def catalog_metadata():
    from app.services.specialist_sources import source_for
    domains = sum(source_for('domain', item.id) is not None for item in DOMAINS)
    procedures = sum(source_for('procedure', item.id) is not None for item in PROCEDURES)
    return (domains*procedures, domains, procedures)


def search_skills(query, limit=6):
    if not isinstance(query, str) or not query.strip():
        return []
    query = query[:2000]
    limit = min(max(int(limit), 1), 8)
    domains, procedures = _rank(query, DOMAIN_INDEX), _rank(query, PROCEDURE_INDEX)
    if not domains and not procedures:
        return []
    if not domains:
        domains = [('general-work', 1)]
    if not procedures:
        procedures = [('source-brief', 1)]
    # Rank at most 8 x 8 combinations, never scan/materialize 10,000 profiles.
    candidates = [(ds+ps, domain+'.'+procedure)
                  for domain, ds in domains[:8] for procedure, ps in procedures[:8]]
    candidates.sort(key=lambda pair: (-pair[0], pair[1]))
    results = []
    for _, skill_id in candidates:
        card = get_skill(skill_id)
        if card is not None:
            results.append(card)
        if len(results) == limit:
            break
    return results


def task_skill_prompt(query):
    if not isinstance(query, str) or not _rank(query[:2000], DOMAIN_INDEX) or not _rank(query[:2000], PROCEDURE_INDEX):
        return ''
    cards = search_skills(query, 2)
    if not cards:
        return ''
    text = '\nRelevant internal skill recipes (use only where they fit the user request; no work has run):\n'
    text += '\n'.join(f"{card['id']}: {card['instructions']}" for card in cards)
    return text[:2400]
