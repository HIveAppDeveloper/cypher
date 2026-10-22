// Go-to-market playbook: the stages a team works through, and the briefs their
// agents run. Every idea carries a ready-to-run brief so picking one starts a
// real task instead of only suggesting one.

export interface PlaybookIdea {
  id: string;
  title: string;
  summary: string;
  brief: string;
}

export interface PlaybookStage {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  question: string;
  ideas: PlaybookIdea[];
  footer: string;
}

export const PLAYBOOK_NAME = 'Go-to-market playbook';

export const PLAYBOOK_LEDE =
  'Four stages, from the market you sell into to the deals you keep. Pick an idea and your team starts the task — every brief is written for you.';

export const PLAYBOOK_STAGES: PlaybookStage[] = [
  {
    id: 'market',
    number: '01',
    title: 'Market & Offer',
    subtitle: 'Get the wedge straight before you spend a single touch on a list.',
    question: 'What do you sell, to whom, and why does it beat the status quo?',
    footer: 'Do this once, then reuse the answer in every stage that follows.',
    ideas: [
      {
        id: 'offer-teardown',
        title: 'Offer teardown',
        summary: 'Read your site, pricing and product pages, then write the one-sentence wedge a buyer would repeat to a colleague.',
        brief: 'Read our website, pricing and product pages, then write our wedge in one sentence a buyer would repeat to a colleague. Cover who it is for, the job it does, what it replaces, and the single strongest proof point. Then list the three questions a skeptical buyer asks first, each with the shortest honest answer. Quote our own pages as sources and flag anything you could not verify.',
      },
      {
        id: 'buyer-language',
        title: 'Buyer language',
        summary: 'Mine competitor and community copy for the words buyers actually use, then map them to ours.',
        brief: 'Find out how buyers describe this problem in their own words. Mine public competitor pages, review sites, job posts and community threads, then return a table of the ten phrases we should reuse, where each came from (link), and where our own copy uses different wording. Keep the language plain and say plainly what you could not verify.',
      },
      {
        id: 'proof-inventory',
        title: 'Proof inventory',
        summary: 'List every claim we can prove today, and the evidence behind each one.',
        brief: 'Inventory the claims we can actually prove today. For each one give the claim, the evidence (case study, metric, benchmark, quote), the source link, and how strong it is: measured, documented, or anecdotal. Then list the claims we make that we cannot yet prove, and what it would take to prove each one.',
      },
    ],
  },
  {
    id: 'target-accounts',
    number: '02',
    title: 'Target Accounts',
    subtitle: 'Spot the companies or customers worth your team’s time, then get every lead to the right next step.',
    question: 'How does your team find the right buyer and act first?',
    footer: 'These are just starting points — build whatever moves the deal forward.',
    ideas: [
      {
        id: 'territory-pulse',
        title: 'Territory pulse',
        summary: 'Pick 20 public companies in your market and see who’s hiring, raising, or expanding this week',
        brief: 'Run a territory pulse. Choose 20 companies in our market and check each one for hiring, funding, launch or expansion signals from the last 30 days. Return a table with the company, the signal, its date and source link, and the single next action you would take. Rank them by how ready they look to buy, and say plainly which ones showed no signal at all. If our market definition is not already written down in this workspace, ask me to confirm it before you start.',
      },
      {
        id: 'trigger-feed',
        title: 'Trigger feed',
        summary: 'Watch a list of your accounts for new jobs and job posts and get a Slack notification when something changes',
        brief: 'Set up a trigger feed on a named list of accounts for new job posts and hiring signals. First propose the account list for me to confirm, then define exactly what counts as a trigger, then write the short recurring brief that reports what changed and why it matters. Hand me that brief as a scheduled goal so it repeats, and tell me the steps to push it to Slack through a channel.',
      },
      {
        id: 'icp-finder',
        title: 'ICP finder',
        summary: 'Describe your best customer and get a scored list of companies that match',
        brief: 'Interview me in three questions about our best customer, then turn the answers into a scored ideal-customer profile. Build a list of 25 companies that match it, score each out of 100 against the profile, and show the scoring and sources for the top five only. Name any company you could not score, and why.',
      },
    ],
  },
  {
    id: 'outbound-leads',
    number: '03',
    title: 'Outbound & Leads',
    subtitle: 'Turn a list you trust into first touches that get replies — and keep new leads arriving.',
    question: 'How does your team get in front of the right buyer this week?',
    footer: 'Volume never fixes a weak first line. Ask for one specific detail or write the next touch yourself.',
    ideas: [
      {
        id: 'lead-sourcing',
        title: 'Lead sourcing',
        summary: 'Build a reachable list of 50 buyers that match your ICP, with the signal that makes each worth a first touch.',
        brief: 'Build me a list of 50 reachable buyers that match our ideal-customer profile. For each one give the name, role, company, the signal that earned them a place on the list with its date and source link, and the channel you would use first. Group them by signal type and mark which ones I should research by hand before any outreach. Do not invent contact details you could not verify.',
      },
      {
        id: 'outbound-sequence',
        title: 'Outbound sequence',
        summary: 'Write a four-touch email and LinkedIn sequence for one segment, with proof points from our own results.',
        brief: 'Write a four-touch outbound sequence — email, LinkedIn, email, then a short close-out — for one segment I name. For each touch give the goal, the subject or opening line, a body under 100 words, and the one proof point it leans on. No hype and no manufactured urgency. Finish by telling me what should make me drop a prospect from the sequence entirely.',
      },
      {
        id: 'first-line',
        title: 'Personalised first line',
        summary: 'Draft a one-line hook for each of your top accounts from something public and current.',
        brief: 'For each of my top ten accounts, write one opening line grounded in something public and current: a hire, a launch, a funding round, a post. Give the line, the source link and the date. Flag the accounts where you found nothing worth opening with — say so instead of inventing a compliment.',
      },
      {
        id: 'hand-raisers',
        title: 'Hand-raisers',
        summary: 'Find the people already asking for what you sell and give each one a next step.',
        brief: 'Find people publicly asking for what we sell: community posts, review-site requests, job posts that describe the problem, and threads asking for a recommendation. For each one give the quote, the link, the date and the next step — reply, direct message, or queued task. Include only ones you actually found.',
      },
    ],
  },
  {
    id: 'pipeline',
    number: '04',
    title: 'Pipeline & Follow-through',
    subtitle: 'Keep every real conversation moving until it closes or it dies on purpose.',
    question: 'How does a qualified conversation keep moving?',
    footer: 'Silence is data. Anything quiet for two weeks gets a decision, not another nudge.',
    ideas: [
      {
        id: 'discovery-prep',
        title: 'Discovery prep',
        summary: 'Brief me on one account a day: what changed, who cares, and the three questions I should ask.',
        brief: 'Brief me on one account before a call: what changed in the last 90 days, who in the buying group cares and why, what they have said publicly about this problem, and the three questions I should ask that nobody else will. End with the one thing that would disqualify them. Cite your sources.',
      },
      {
        id: 'objection-bank',
        title: 'Objection bank',
        summary: 'Collect the objections you hear most and write a straight answer with proof for each.',
        brief: 'Build an objection bank from what buyers actually say: price, timing, the status quo, a competitor, trust. For each objection write the straight answer in two sentences, the proof that backs it, and the question that moves the conversation forward. Mark the objections we have no honest answer for yet.',
      },
      {
        id: 'follow-up-watch',
        title: 'Follow-up watch',
        summary: 'Draft the follow-up for every conversation that has gone quiet for a week.',
        brief: 'Review the conversations in this workspace that have gone quiet for a week or more. For each one draft the follow-up: what we promised, what we still need, and one concrete next step with a date. Keep it short and human. List the conversations you could not see into instead of guessing what was said.',
      },
    ],
  },
];

export const PLAYBOOK_START_STAGE = PLAYBOOK_STAGES[0].id;
