/** Synthetic prospecting fixtures only. Scores are illustrative, never lead facts. */
export type Prospect = {
  id: string;
  name: string;
  domain: string;
  sector: string;
  signal: string;
  buyerRole: string;
  score: number;
  source: { url: string | null; date: string; label: string; verified: boolean };
  draft: string;
  status: 'new' | 'reviewed';
};

export const SCORE_LABEL = 'Illustrative demo score';
const FIXTURES = [
  ['Alder Lantern', 'Software', 'Head of Operations', 'exploring a simpler internal workflow'],
  ['Copper Finch', 'Professional services', 'Managing Director', 'comparing ways to organize client requests'],
  ['Juniper Orbit', 'Retail', 'Director of Operations', 'considering a clearer team handoff'],
  ['Velvet Compass', 'Manufacturing', 'Operations Manager', 'evaluating a process improvement'],
  ['Willow Circuit', 'Software', 'Head of Product', 'reviewing a possible product workflow'],
  ['Silver Meadow', 'Logistics', 'Director of Operations', 'exploring a coordination scenario'],
  ['Amber Kestrel', 'Professional services', 'Head of Client Services', 'considering a client reporting scenario'],
  ['Cedar Prism', 'Retail', 'Head of Commerce', 'evaluating a storefront planning scenario'],
  ['Linen Rocket', 'Software', 'Head of Engineering', 'comparing a possible development workflow'],
  ['Maple Current', 'Manufacturing', 'Process Improvement Manager', 'exploring a quality review scenario'],
  ['Indigo Acorn', 'Professional services', 'Managing Partner', 'evaluating a service delivery scenario'],
  ['Quartz Sparrow', 'Logistics', 'Supply Chain Manager', 'considering a shipment planning scenario'],
  ['Moss Meridian', 'Retail', 'Customer Experience Manager', 'exploring a customer feedback scenario'],
  ['Birch Nimbus', 'Software', 'Head of Customer Success', 'considering an onboarding scenario'],
  ['Coral Thimble', 'Manufacturing', 'Production Manager', 'reviewing a production planning scenario'],
  ['Hazel Beacon', 'Professional services', 'Director of Business Development', 'exploring a proposal workflow scenario'],
  ['Opal Trestle', 'Logistics', 'Operations Manager', 'evaluating a route coordination scenario'],
  ['Saffron Pebble', 'Retail', 'Merchandising Manager', 'considering a catalog review scenario'],
  ['Fable Canopy', 'Software', 'Head of Operations', 'exploring a knowledge sharing scenario'],
  ['Elm Parallax', 'Professional services', 'Managing Director', 'reviewing a team planning scenario'],
] as const;

function input(value: string, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return trimmed;
}
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619) >>> 0;
  return result;
}

/** Returns a new ordered array; callers may update reviewed status independently. */
export function rankProspects(prospects: Prospect[]): Prospect[] {
  return [...prospects].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function buildProspects(market: string, offer: string): Prospect[] {
  const territory = input(market, 'Market', 120);
  const proposition = input(offer, 'Offer', 500);
  return rankProspects(FIXTURES.map(([name, sector, buyerRole, scenario], index) => {
    const id = `demo-${String(index + 1).padStart(2, '0')}`;
    return {
      id,
      name: `Demo ${name}`,
      domain: `${name.toLowerCase().replace(/ /g, '-')}.example`,
      sector,
      signal: `Demo scenario: ${scenario}. This is fictional, not an observed company signal.`,
      buyerRole,
      score: 55 + hash(`${territory}\n${proposition}\n${id}`) % 42,
      source: { url: null, date: '2026-10-22', label: 'Demo fixture', verified: false },
      draft: `Demo scenario — fictional company, not ready to send.\n\nFor the ${buyerRole} at Demo ${name}:\nWe are exploring this offer for ${territory}: ${proposition}\nWould this be relevant in a hypothetical ${scenario} discussion?\n\nValidate the company, its needs, and the recipient before adapting this draft.`,
      status: 'new' as const,
    };
  }));
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Quoting alone does not prevent spreadsheet formulas. Prefix dangerous text
  // before RFC-style escaping; include whitespace/control-prefixed formulas.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function exportProspects(prospects: Prospect[]): string {
  const headers = ['Company (demo)', 'Domain (.example demo)', 'Sector', 'Demo scenario', 'Buyer role (role only)',
    SCORE_LABEL, 'Source label', 'Source date', 'Source verified', 'Source URL', 'Draft (demo only)', 'Status'];
  const rows = prospects.map(row => [row.name, row.domain, row.sector, row.signal, row.buyerRole, row.score,
    row.source.label, row.source.date, row.source.verified, row.source.url, row.draft, row.status]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
