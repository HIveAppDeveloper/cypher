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

function kokoroConfig() {
  if (process.env.KOKORO_TTS_ENABLED !== 'true') return null;
  const key = process.env.GROKBOT_BACKEND_API_TOKEN?.trim() || process.env.BACKEND_API_TOKEN?.trim() || '';
  try {
    const url = new URL('/v1/audio/speech', process.env.KOKORO_INTERNAL_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || key.length < 32) return null;
    return { url, key };
  } catch { return null; }
}

export async function GET() {
  return NextResponse.json(
    { configured: process.env.KOKORO_TTS_ENABLED === 'true' ? !!kokoroConfig() : !!getElevenLabsApiKey() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: Request) {
  if (process.env.REQUIRE_USER_AUTH === 'true' && !(await hasAppSession())) {
    return NextResponse.json({ detail: 'Sign in to use Cypher voice.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const useKokoro = process.env.KOKORO_TTS_ENABLED === 'true';
  const kokoro = kokoroConfig();
  const apiKey = getElevenLabsApiKey();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  if (useKokoro ? !kokoro : !apiKey) {
    return NextResponse.json({ detail: `${useKokoro ? 'Kokoro' : 'ElevenLabs'} voice needs server-side setup.` }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
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
    const response = await fetch(kokoro?.url || url, {
      method: 'POST',
      headers: kokoro ? { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'Authorization': `Bearer ${kokoro.key}` } : { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'xi-api-key': apiKey },
      body: JSON.stringify(kokoro ? { model: 'kokoro', input: text, voice: 'af_bella', response_format: 'mp3', speed: 1.0 } : { text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.38, similarity_boost: 0.82, style: 0, use_speaker_boost: true, speed: 1.03 } }),
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    const provider = useKokoro ? 'Kokoro' : 'ElevenLabs';
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 429) return NextResponse.json({ detail: `${provider} is busy or its usage limit was reached. Try again shortly.` }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 422) {
        return NextResponse.json({ detail: `${provider} rejected this voice setup. Check the server-side configuration.` }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
      return NextResponse.json({ detail: `${provider} could not generate this voice line. Try again.` }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (useKokoro && response.headers.get('content-type')?.split(';')[0].trim() !== 'audio/mpeg') {
      void response.body.cancel().catch(() => {});
      return NextResponse.json({ detail: 'Kokoro returned an unsupported audio format.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const firstAudio = response.headers.get('x-server-first-audio-ms');
    const kokoroTiming = useKokoro && firstAudio && /^\d+(\.\d+)?$/.test(firstAudio) ? `, tts_first_audio;dur=${firstAudio}` : '';
    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': response.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Voice-Provider': provider.toLowerCase(), 'Server-Timing': `voice_provider_headers;dur=${(performance.now() - generationStarted).toFixed(1)}${kokoroTiming}` },
    });
  } catch {
    return NextResponse.json({ detail: `${useKokoro ? 'Kokoro' : 'ElevenLabs'} did not respond in time. Try again.` }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
  }
}
