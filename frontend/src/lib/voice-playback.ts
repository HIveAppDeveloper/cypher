// Keep the same audio element connected to Web Audio across voice sessions.
// MP3-capable MSE browsers can play the first chunk while TTS is still arriving.
export async function playVoiceResponse(response: Response, audio: HTMLAudioElement, signal: AbortSignal, onPlaying: () => void) {
  signal.throwIfAborted();
  const cleanup = new AbortController();
  signal = AbortSignal.any([signal, cleanup.signal]);
  let url = '';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const waitFor = (target: EventTarget, event: string, action?: () => void) => new Promise<void>((resolve, reject) => {
    const clean = () => { target.removeEventListener(event, done); target.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
    const done = () => { clean(); resolve(); };
    const failed = () => { clean(); reject(new Error('Cypher’s reply could not be played.')); };
    const aborted = () => { clean(); reject(signal.reason); };
    if (signal.aborted) { reject(signal.reason); return; }
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    try { action?.(); } catch (error) { clean(); reject(error); }
  });
  let rejectPlayback: (reason: unknown) => void = () => {};
  let finishPlayback: () => void = () => {};
  const ended = new Promise<void>((resolve, reject) => { finishPlayback = resolve; rejectPlayback = reject; });
  // A source/setup error may occur before the playback promise is awaited.
  void ended.catch(() => {});
  const fail = () => rejectPlayback(new Error('Cypher’s reply could not be played.'));
  const abort = () => { rejectPlayback(signal.reason); void reader?.cancel().catch(() => {}); };
  audio.addEventListener('ended', finishPlayback);
  audio.addEventListener('error', fail);
  audio.addEventListener('playing', onPlaying);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const streamable = response.body && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg') && response.headers.get('content-type')?.split(';')[0].trim() === 'audio/mpeg';
    if (streamable) {
      const source = new MediaSource();
      url = URL.createObjectURL(source);
      const opened = waitFor(source, 'sourceopen', () => { audio.src = url; });
      await opened;
      signal.throwIfAborted();
      const buffer = source.addSourceBuffer('audio/mpeg');
      reader = response.body!.getReader();
      const feed = async () => {
        let started = false;
        while (true) {
          const { value, done } = await reader!.read();
          signal.throwIfAborted();
          if (done) break;
          if (!value.byteLength) continue;
          await waitFor(buffer, 'updateend', () => buffer.appendBuffer(value as Uint8Array<ArrayBuffer>));
          if (!started) { started = true; void audio.play().catch(rejectPlayback); }
        }
        if (!started) throw new Error('Cypher returned an empty voice reply.');
        if (source.readyState === 'open') source.endOfStream();
      };
      await Promise.all([feed(), ended]);
    } else {
      const blob = await Promise.race([response.blob(), ended.then(() => { throw new Error('Voice playback ended before it started.'); })]);
      signal.throwIfAborted();
      if (!blob.size) throw new Error('Cypher returned an empty voice reply.');
      url = URL.createObjectURL(blob);
      audio.src = url;
      await audio.play();
      await ended;
    }
  } finally {
    cleanup.abort();
    signal.removeEventListener('abort', abort);
    audio.removeEventListener('ended', finishPlayback);
    audio.removeEventListener('error', fail);
    audio.removeEventListener('playing', onPlaying);
    void reader?.cancel().catch(() => {});
    // A superseded request must never clear a newer session's source.
    if (url && audio.getAttribute('src') === url) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if (url) URL.revokeObjectURL(url);
  }
}

export function speakWithBrowser(text: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.06; utterance.pitch = .78;
    const voice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('en') && /male|david|daniel|alex|mark|guy|james|thomas/i.test(voice.name));
    if (voice) utterance.voice = voice;
    const clean = () => { signal.removeEventListener('abort', abort); utterance.onend = null; utterance.onerror = null; };
    const done = () => { clean(); resolve(); };
    const abort = () => { clean(); window.speechSynthesis.cancel(); reject(signal.reason); };
    utterance.onend = done;
    utterance.onerror = () => { clean(); reject(new Error('Browser speech could not be played.')); };
    signal.addEventListener('abort', abort, { once: true });
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}
