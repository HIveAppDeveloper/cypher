import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type AppSession = { sub: string; email: string; name?: string; exp: number };

function secret() {
  const value = process.env.AUTH_SESSION_SECRET || '';
  if (value.length < 32) throw new Error('AUTH_SESSION_SECRET is not configured.');
  return value;
}

export function signPayload(value: object) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readSignedPayload<T>(value?: string): T | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  const expected = createHmac('sha256', secret()).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & { exp?: number };
    return parsed.exp && parsed.exp > Math.floor(Date.now() / 1000) ? parsed : null;
  } catch { return null; }
}

export function getSessionFromCookieHeader(cookieHeader: string | null) {
  const value = cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith('grokbot_session='))?.slice('grokbot_session='.length);
  try { return readSignedPayload<AppSession>(value); } catch { return null; }
}

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge };
}

export function randomSecret(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
