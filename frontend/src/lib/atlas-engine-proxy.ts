/** Exact service-to-service route. Authentication stays at the private engine.
 * It forwards signed bytes, never browser identity, cookies, model keys or a
 * deployment-protection bypass. All ordinary routes keep their session gate.
 */
const PATH = '/api/integrations/atlas/v1/chat';
const MAX_BODY = 256 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const RESPONSE_HEADERS = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

function failure(status: number, code: string, message: string, retryable = false) {
  return Response.json({ type: 'error', code, message, retryable }, { status, headers: RESPONSE_HEADERS });
}

export async function proxyAtlasEngine(request: Request): Promise<Response> {
  if (process.env.GROKBOT_ATLAS_ENGINE_ENABLED !== 'true') return failure(503, 'engine_disabled', 'The Atlas inference integration is disabled.');
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return failure(503, 'engine_unavailable', 'The inference service is unavailable.', true);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || request.headers.has('content-encoding')) return failure(415, 'invalid_content_type', 'Use an uncompressed JSON request.');
  const timestamp = request.headers.get('x-atlas-engine-timestamp');
  const signature = request.headers.get('x-atlas-engine-signature');
  if (!timestamp || !/^[1-9][0-9]{8,11}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) return failure(401, 'invalid_signature', 'The inference request could not be authenticated.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return failure(413, 'request_too_large', 'The inference request exceeds its size limit.');
  const bodyReader = request.body?.getReader();
  if (!bodyReader) return failure(400, 'invalid_request', 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let bodyTimedOut = false;
  const stopBody = () => { void bodyReader.cancel().catch(() => undefined); };
  const bodyTimer = setTimeout(() => { bodyTimedOut = true; stopBody(); }, 5000);
  request.signal.addEventListener('abort', stopBody, { once: true });
  if (request.signal.aborted) stopBody();
  try {
    for (;;) {
      const { value, done } = await bodyReader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await bodyReader.cancel();
        return failure(413, 'request_too_large', 'The inference request exceeds its size limit.');
      }
      chunks.push(value);
    }
    if (request.signal.aborted) return failure(499, 'request_cancelled', 'The inference request was cancelled.');
    if (bodyTimedOut) return failure(408, 'request_timeout', 'The request body did not arrive before its deadline.', true);
  } catch { return failure(400, 'invalid_request', 'The request body could not be read.'); }
  finally { clearTimeout(bodyTimer); request.signal.removeEventListener('abort', stopBody); bodyReader.releaseLock(); }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) abort.abort();
  // Retain through body consumption; clearing after headers alone would leave
  // a stalled stream running past the deployment's interactive deadline.
  const timer = setTimeout(() => abort.abort(), 35000);
  const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); };
  let response: Response;
  try {
    const target = new URL(PATH, backend);
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error('Invalid internal service URL');
    response = await fetch(target, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: abort.signal,
      headers: { 'content-type': 'application/json', 'x-atlas-engine-timestamp': timestamp, 'x-atlas-engine-signature': signature },
      body: raw,
    });
  } catch {
    cleanup();
    return failure(request.signal.aborted ? 499 : 503, request.signal.aborted ? 'request_cancelled' : 'engine_unavailable', request.signal.aborted ? 'The inference request was cancelled.' : 'The inference service is unavailable.', !request.signal.aborted);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || (!contentType.startsWith('application/json') && !contentType.startsWith('application/x-ndjson'))) {
    cleanup(); abort.abort();
    await response.body?.cancel();
    return failure(502, 'engine_protocol_error', 'The inference service returned an invalid response.', true);
  }
  const reader = response.body.getReader();
  let output = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) { cleanup(); reader.releaseLock(); controller.close(); return; }
        output += value.byteLength;
        if (output > MAX_OUTPUT) throw new Error('Inference output limit');
        controller.enqueue(value);
      } catch {
        cleanup(); abort.abort();
        await reader.cancel().catch(() => undefined);
        controller.error(new Error('The inference stream was interrupted.'));
      }
    },
    async cancel() { cleanup(); abort.abort(); await reader.cancel().catch(() => undefined); },
  });
  return new Response(stream, { status: response.status, headers: { ...RESPONSE_HEADERS, 'content-type': contentType, 'x-accel-buffering': 'no' } });
}
