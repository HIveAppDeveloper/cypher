import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AppSession, readSignedPayload } from '../../../lib/auth-server';
import { CYPHER_VOICE_INTRO } from '../../../lib/cypher-voice';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function readBoundedText(request: Request, limit: number) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(body); }
  catch { return ''; }
}

function hasAppSession() {
  try { return !!readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); }
  catch { return false; }
}

export async function GET() {
  return NextResponse.json(
    { configured: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: Request) {
  if (process.env.REQUIRE_USER_AUTH === 'true' && !hasAppSession()) {
    return NextResponse.json({ detail: 'Sign in to use Cypher voice.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return NextResponse.json({ detail: 'ElevenLabs voice needs server-side setup.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 512) return NextResponse.json({ detail: 'Voice request is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ detail: 'Send the Cypher welcome line as JSON.' }, { status: 415, headers: { 'Cache-Control': 'no-store' } });
  }
  const rawBody = await readBoundedText(request, 512).catch(() => '');
  if (rawBody === null) return NextResponse.json({ detail: 'Voice request is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  let body: { text?: unknown } | null = null;
  try { body = JSON.parse(rawBody) as { text?: unknown }; } catch {}
  if (body?.text !== CYPHER_VOICE_INTRO) {
    return NextResponse.json({ detail: 'This voice control only reads the Cypher welcome line.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set('output_format', 'mp3_44100_128');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'xi-api-key': apiKey },
      body: JSON.stringify({ text: CYPHER_VOICE_INTRO, model_id: 'eleven_flash_v2_5' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body) {
      if (response.status === 429) return NextResponse.json({ detail: 'ElevenLabs usage limit reached. Check your account quota and try again.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 422) {
        return NextResponse.json({ detail: 'ElevenLabs rejected this voice setup. Check the server-side key and voice ID.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
      return NextResponse.json({ detail: 'ElevenLabs could not generate this voice line. Try again.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': response.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return NextResponse.json({ detail: 'ElevenLabs did not respond in time. Try again.' }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
  }
}
