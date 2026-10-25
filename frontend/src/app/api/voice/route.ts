import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AppSession, readSignedPayload } from '../../../lib/auth-server';

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

const DEFAULT_ELEVENLABS_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';
const MAX_VOICE_TEXT = 2000;
const MAX_VOICE_BODY = 12 * 1024;

function getElevenLabsApiKey() {
  return process.env.ELEVENLABS_API_KEY?.trim() || process.env.ELEVEN_LABS_API_KEY?.trim() || '';
}

async function hasAppSession() {
  try { return !!readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); }
  catch { return false; }
}

export async function GET() {
  return NextResponse.json(
    { configured: !!getElevenLabsApiKey() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: Request) {
  if (process.env.REQUIRE_USER_AUTH === 'true' && !(await hasAppSession())) {
    return NextResponse.json({ detail: 'Sign in to use Cypher voice.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const apiKey = getElevenLabsApiKey();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  if (!apiKey) {
    return NextResponse.json({ detail: 'ElevenLabs voice needs server-side setup.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VOICE_BODY) return NextResponse.json({ detail: 'Voice request is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ detail: 'Send the text for Cypher to speak as JSON.' }, { status: 415, headers: { 'Cache-Control': 'no-store' } });
  }
  const rawBody = await readBoundedText(request, MAX_VOICE_BODY).catch(() => '');
  if (rawBody === null) return NextResponse.json({ detail: 'Voice request is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  let body: { text?: unknown } | null = null;
  try { body = JSON.parse(rawBody) as { text?: unknown }; } catch {}
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_VOICE_TEXT) {
    return NextResponse.json({ detail: `Voice text must be between 1 and ${MAX_VOICE_TEXT} characters.` }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`);
  url.searchParams.set('output_format', 'mp3_44100_128');
  try {
    const generationStarted = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'xi-api-key': apiKey },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.38, similarity_boost: 0.82, style: 0, use_speaker_boost: true, speed: 1.03 } }),
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
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
      headers: { 'Content-Type': response.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Server-Timing': `voice_provider_headers;dur=${(performance.now() - generationStarted).toFixed(1)}` },
    });
  } catch {
    return NextResponse.json({ detail: 'ElevenLabs did not respond in time. Try again.' }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
  }
}
