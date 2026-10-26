import { dateFromApi } from './dates';

export interface PluginEvidence {
  provider?: string;
  url: string;
  enabled: boolean;
  tools: { enabled?: boolean }[];
  verification?: { status: string; checked_at?: string; detail?: { code?: string; message?: string } };
}

export function isAccountPlugin(plugin: PluginEvidence & { authenticated: boolean }) {
  return plugin.authenticated || plugin.verification?.detail?.code === 'sign_in_required';
}

// A saved grant, discovered tools and a successful execution are separate facts.
export function pluginStatus(plugin: PluginEvidence, now = Date.now()) {
  if (!plugin.enabled) return { label: 'Paused', tone: 'neutral', detail: 'Enable this connection to use its tools.' };
  if (plugin.provider !== 'google' && !plugin.url.startsWith('https://')) {
    return { label: 'Needs setup', tone: 'warning', detail: 'Use a supported provider or a hosted HTTPS server link.' };
  }
  const check = plugin.verification;
  if (check?.status === 'failed') return {
    label: check.detail?.code === 'sign_in_required' ? 'Sign in again' : check.detail?.code === 'rate_limited' ? 'Rate limited' : 'Needs attention',
    tone: 'warning', detail: check.detail?.message || 'The last check failed. Retry or reconnect this app.',
  };
  if (!plugin.tools.some(tool => tool.enabled !== false)) return { label: 'No tools enabled', tone: 'neutral', detail: 'Enable a tool in Manage to use this connection.' };
  if (check?.status === 'fallback') return { label: 'Website fallback', tone: 'neutral', detail: 'The public website responded. The MCP tool remains unavailable.' };
  const checkedAt = dateFromApi(check?.checked_at)?.getTime() ?? Number.NaN;
  const fresh = Number.isFinite(checkedAt) && now >= checkedAt && now - checkedAt < 24 * 60 * 60 * 1000;
  if (check?.status === 'passed' && fresh) return { label: 'Test passed', tone: 'success', detail: 'A read-only tool call passed. This does not test every tool.' };
  if (check?.status === 'passed') return { label: 'Check again', tone: 'neutral', detail: 'A previous tool test passed. Run a fresh check for current access.' };
  if (check?.status === 'discovered') return { label: 'Tools found', tone: 'neutral', detail: 'Discovery passed. Tool execution has not been verified.' };
  return { label: 'Not tested', tone: 'neutral', detail: 'Use Test tools to check this saved connection.' };
}
