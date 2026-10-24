import type { Lead, SignalKind } from './engine';

// Cypher's built-in assistant: answers common questions instantly from the accounts on screen.
// Returns null when it has no grounded answer, so the caller can ask a model instead.
export type Reply = { text: string; tickers: string[] };

export const GREETING = "Hey, it's Cypher, your sales assistant. Ask me who to call first, why an account is hot, who's hiring or raising, or to pull up a draft email. Run Outbound and I'll work from your territory.";
export const SUGGESTIONS = ['Who should we call first?', "Who's hiring?", 'What should I do today?', 'How is the pipeline?'];

const KIND_WORDS: [SignalKind, RegExp, string][] = [
  ['hiring', /\b(hir(e|es|ing)|headcount|recruit|jobs?|roles?)\b/, 'hiring'],
  ['raising', /\b(rais(e|es|ing)|fund(ing|ed|raise)?|capital|debt|offering|money)\b/, 'raising capital'],
  ['spending', /\b(spend(ing)?|invest(ing|ment)?|expan(d|sion)|capex|budget)\b/, 'spending'],
  ['news', /\b(news|momentum|8-k|announce|launch|leadership)\b/, 'showing momentum'],
];
const STAGE_NAME: Record<Lead['stage'], string> = { found: 'found', researched: 'researched', drafted: 'ready to send', sent: 'in sequence', replied: 'replied', meeting: 'meeting booked' };
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s/)[0] || s).replace(/\s+/g, ' ').trim();

function findLead(q: string, leads: Lead[]) {
  return leads.find(l => new RegExp(`\\b${l.company.ticker.toLowerCase().replace('.', '\\.')}\\b`).test(q))
    ?? leads.find(l => q.includes(l.company.name.toLowerCase()))
    ?? leads.find(l => q.includes(l.company.name.toLowerCase().split(' ')[0]) && l.company.name.length > 3);
}

function nextTouch(l: Lead) {
  const t = l.stage === 'drafted' ? l.sequence[0] : l.sequence.find(s => s.day > 0);
  return t ? `${t.channel.toLowerCase()} on ${t.due}` : 'a follow-up';
}

function describe(l: Lead) {
  const sig = [...l.signals].sort((a, b) => b.strength - a.strength).map(s => firstSentence(s.headline).toLowerCase());
  const buyer = l.buyer.name ? `${l.buyer.name} (${l.buyer.title || l.buyer.persona})` : `the ${l.buyer.persona}`;
  return `${l.company.name} scores ${l.score}, ${l.tier.toLowerCase()}. ${sig.length ? `Signals: ${list(sig.slice(0, 3))}.` : 'No strong signals yet.'} Reach out to ${buyer}; it's ${STAGE_NAME[l.stage]}, next step ${nextTouch(l)}.`;
}

export function localReply(question: string, leads: Lead[], ctx: { offering: string; persona: string }): Reply | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;
  if (/^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/.test(q) && q.split(' ').length <= 4) return { text: GREETING, tickers: [] };
  if (/\b(help|what can you do|how do(es)? (this|you) work)\b/.test(q)) return { text: `I rank your territory by buying signals, explain why each account matters, and keep every lead moving. Try: "who should we call first?", "why is SoFi hot?", "who's raising?", "draft for Toast", or "what should I do today?". I'm working for a ${ctx.persona} pitch on ${ctx.offering.toLowerCase()}.`, tickers: [] };
  if (!leads.length) return { text: "I don't have a territory yet. Pick a market and press Run Outbound, and I'll rank 20 companies for you in about ten seconds.", tickers: [] };
  const ranked = [...leads].sort((a, b) => b.score - a.score);
  const hot = ranked.filter(l => l.tier === 'Hot');
  const named = findLead(q, leads);

  if (named && /\b(email|draft|write|message|subject)\b/.test(q)) {
    const body = named.email.body.split('\n').filter(Boolean).slice(1, 3).join(' ');
    return { text: `Here's the draft for ${named.company.name}. Subject: "${named.email.subject}". It opens: ${body} Open the account to edit it or send it from Gmail.`, tickers: [named.id] };
  }
  if (named) return { text: describe(named), tickers: [named.id] };

  if (/\b(email|draft|write)\b/.test(q)) {
    const top = ranked[0];
    return { text: `Your strongest draft right now is for ${top.company.name}: "${top.email.subject}". Every account has one ready; name a company and I'll pull it up.`, tickers: [top.id] };
  }
  for (const [kind, re, phrase] of KIND_WORDS) {
    if (!re.test(q)) continue;
    const hits = ranked.filter(l => l.signals.some(s => s.kind === kind)).sort((a, b) => (b.signals.find(s => s.kind === kind)!.strength - a.signals.find(s => s.kind === kind)!.strength) || b.score - a.score);
    if (!hits.length) return { text: `Nobody in this territory is clearly ${phrase} right now. I'd focus on ${ranked[0].company.name} instead.`, tickers: [ranked[0].id] };
    const top = hits.slice(0, 4);
    return { text: `${hits.length} account${hits.length > 1 ? 's are' : ' is'} ${phrase}. The strongest: ${top.map(l => `${l.company.name} (${firstSentence(l.signals.find(s => s.kind === kind)!.headline).toLowerCase()})`).join('; ')}.`, tickers: top.map(l => l.id) };
  }
  if (/\b(today|next|to ?do|should i do|action|follow ?up|due)\b/.test(q)) {
    const ready = hot.filter(l => l.stage === 'drafted');
    const today = new Date().toISOString().slice(0, 10);
    const due = leads.filter(l => l.stage === 'sent' && l.sequence.some(t => t.day > 0 && t.due <= today));
    const replied = leads.filter(l => l.stage === 'replied');
    const steps = [
      ready.length ? `start sequences for ${list(ready.slice(0, 3).map(l => l.company.name))}${ready.length > 3 ? ` and ${ready.length - 3} more hot accounts` : ''}` : '',
      replied.length ? `book meetings with ${list(replied.map(l => l.company.name))}, who replied` : '',
      due.length ? `send follow-ups to ${list(due.slice(0, 3).map(l => l.company.name))}` : '',
    ].filter(Boolean);
    if (!steps.length) return { text: `You're caught up on hot accounts. Next best move: research the warm ones, starting with ${ranked.find(l => l.tier === 'Warm')?.company.name ?? ranked[0].company.name}.`, tickers: [] };
    return { text: `Here's today: ${steps.join('; then ')}.`, tickers: [...ready.slice(0, 3), ...replied, ...due.slice(0, 3)].map(l => l.id) };
  }
  if (/\b(pipeline|status|summary|overview|how (are|is) (we|it|things)|progress|meetings?)\b/.test(q)) {
    const by = (s: Lead['stage']) => leads.filter(l => l.stage === s).length;
    return { text: `${leads.length} accounts ranked: ${hot.length} hot, ${leads.filter(l => l.tier === 'Warm').length} warm. ${by('drafted')} ready to send, ${by('sent')} in sequence, ${by('replied')} replied, ${by('meeting')} meeting${by('meeting') === 1 ? '' : 's'} booked.${hot.length ? ` Top account: ${hot[0].company.name} at ${hot[0].score}.` : ''}`, tickers: hot.slice(0, 3).map(l => l.id) };
  }
  if (/\b(warm)\b/.test(q)) { const w = ranked.filter(l => l.tier === 'Warm'); return { text: w.length ? `${w.length} warm accounts: ${list(w.slice(0, 6).map(l => `${l.company.name} (${l.score})`))}. A little research could tip the top ones into hot.` : 'No warm accounts in this run.', tickers: w.slice(0, 6).map(l => l.id) }; }
  if (/\b(cold|watch|skip|ignore|worst)\b/.test(q)) { const w = ranked.filter(l => l.tier === 'Watch'); return { text: w.length ? `Park these for now: ${list(w.slice(0, 6).map(l => l.company.name))}. Not enough is happening there yet.` : 'Nothing to park; every account has some signal.', tickers: [] }; }
  if (/\b(first|call|priorit|who should|top|best|hot|focus|target)\b/.test(q)) {
    const top = (hot.length ? hot : ranked).slice(0, 3);
    return { text: `Call ${top[0].company.name} first: ${firstSentence(top[0].why).toLowerCase()}. Then ${list(top.slice(1).map(l => `${l.company.name} (${l.score})`))}. ${top[0].stage === 'drafted' ? 'Their emails are drafted and ready to send.' : 'Sequences are already running.'}`, tickers: top.map(l => l.id) };
  }
  return null;
}
