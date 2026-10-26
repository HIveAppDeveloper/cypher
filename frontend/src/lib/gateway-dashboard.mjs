// Presentation-only helpers. No credentials, provider requests, or configuration writes.
const MANAGEMENT_HOSTS = new Set(['omniroute-cloud-ten.vercel.app', 'omniroute-cloud-hiveapp.vercel.app']);
export function publicGatewayManagementUrl(value) {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || !MANAGEMENT_HOSTS.has(url.hostname) || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) return null;
    if (!['', '/', '/v1', '/dashboard/providers'].includes(url.pathname)) return null;
    return url.origin + '/dashboard/providers';
  } catch { return null; }
}
export function providerUsage(usage) {
  if (!usage || !Array.isArray(usage.models)) return [];
  const grouped = new Map();
  for (const row of usage.models) {
    if (!row || typeof row.provider !== 'string') continue;
    const current = grouped.get(row.provider) || {provider:row.provider, tokens:0, cost:0, models:0};
    const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    current.tokens += number(row.input_tokens) + number(row.output_tokens);
    current.cost += number(row.estimated_cost); current.models++;
    grouped.set(row.provider, current);
  }
  return [...grouped.values()].sort((a,b) => b.tokens-a.tokens);
}
export function configuredModels(runtime) {
  return [...new Set((Array.isArray(runtime?.configured_models) ? runtime.configured_models : []).filter(value => typeof value === 'string' && value.length <= 250))];
}
export function connectionStatus(value) {
  return ({ready:'Verified',not_checked:'Not checked',checking:'Checking',verification_required:'Verification needed',sign_in_required:'Sign-in needed',access_denied:'Access denied',billing_required:'Review billing',rate_limited:'Rate limited',unavailable:'Unavailable'})[value] || 'Not checked';
}
export function knownNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
export function safeRuns(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row && typeof row.id === 'string' && typeof row.status === 'string').map(({id,status,created_at,completed_at})=>({id,status,created_at,completed_at}));
}
