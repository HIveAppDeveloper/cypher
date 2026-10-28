import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import styles from './VoiceTranscript.module.css';

export function VoiceTranscript({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<'loading' | 'pending' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [copyLabel, setCopyLabel] = useState('Copy transcript');
  const downloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const downloadUrl = useRef('');
  useEffect(() => () => { clearTimeout(downloadTimer.current); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setStatus('loading'); setError(''); setTranscript(''); setCopyLabel('Copy transcript');
    async function load() {
      try {
        const result = await api.getTranscript(conversationId, messageId, controller.signal);
        if (controller.signal.aborted) return;
        setTranscript(result.text); setStatus(result.status);
        if (result.status === 'pending') timer = setTimeout(load, 1500);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The transcript could not load.');
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, conversationId, messageId, attempt]);
  async function copy() {
    try { await navigator.clipboard.writeText(transcript); setCopyLabel('Copied'); }
    catch { setCopyLabel('Copy unavailable'); }
  }
  function download() {
    clearTimeout(downloadTimer.current);
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
    downloadUrl.current = url;
    const link = document.createElement('a'); link.href = url; link.download = 'transcript.txt'; link.click();
    downloadTimer.current = setTimeout(() => { URL.revokeObjectURL(url); if (downloadUrl.current === url) downloadUrl.current = ''; }, 1000);
  }
  return <div className={styles.root}>
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide transcript' : 'Show transcript'}</button>
    {open ? <div className={styles.panel}>
      {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry transcript</button></div>
        : status === 'ready' ? <><p className={styles.text}>{transcript}</p><div className={styles.actions}><button type="button" onClick={() => void copy()}>{copyLabel}</button><button type="button" onClick={download}>Download transcript</button></div></>
        : <p role="status">{status === 'unavailable' ? 'No transcript is available. The original recording is saved.' : status === 'pending' ? 'Transcribing the recording…' : 'Loading transcript…'}</p>}
    </div> : null}
  </div>;
}
