// Only an explicit build-time operator setting may change the origin. Request
// headers and user input must never select an OAuth callback/login destination.
export function selfHostedOrigin(value?: string): string | null {
  if (!value || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
const configuredOrigin = typeof process === 'undefined' ? '' : process.env.NEXT_PUBLIC_SELF_HOSTED_ORIGIN;
export const CANONICAL_APP_ORIGIN = selfHostedOrigin(configuredOrigin) || 'https://cypher-agent.vercel.app';
const CANONICAL_APP_HOST = new URL(CANONICAL_APP_ORIGIN).hostname;

export function isOffCanonicalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return Boolean(host && host !== CANONICAL_APP_HOST && host !== 'localhost' && host !== '127.0.0.1');
}

export function safeInternalReturnTo(value?: string | null): string | null {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value, CANONICAL_APP_ORIGIN);
    if (parsed.origin !== CANONICAL_APP_ORIGIN) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

export function requestHostname(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const raw = forwarded || headers.get('host') || '';
  return raw.replace(/:\d+$/, '').trim().toLowerCase();
}

export function internalPathWithSearch(pathname: string, params?: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value)) for (const entry of value) query.append(key, entry);
  }
  return safeInternalReturnTo(`${pathname}${query.size ? `?${query.toString()}` : ''}`) || pathname;
}
