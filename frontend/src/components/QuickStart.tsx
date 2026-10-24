import { MODEL_CHOICES } from '../lib/presets';
import { GlassSelect } from './GlassSelect';
import BinaryLens from './cipher/BinaryLens';
import { RecentWork } from './cipher/RecentWork';
import { useEffect, useRef, useState } from 'react';
import { RunOptions } from '../lib/types';
import { createSpeechRecognition, describeSpeechError, type SpeechRecognitionLike } from '../lib/speech';

const STARTER_PROMPTS = [
  { text: 'Research', prompt: 'Research this topic and give me a clear, sourced brief: ' },
  { text: 'Write', prompt: 'Write a clear first draft of ' },
  { text: 'Build', prompt: 'Help me plan and build ' },
];

export function QuickStart({ onStart, onOpenRecent, options, onOptions, draftScope }: { draftScope?: string; options: RunOptions; onOptions: (options: RunOptions) => void; onStart: (prompt: string, options: Partial<RunOptions>) => Promise<void>; onOpenRecent: (conversationId: string) => void }) {
  const manager = options.routing==='manual'?(options.model || 'gpt-6.1-sol'):'auto';
  const [prompt, setPrompt] = useState('');
  const logoRef = useRef<HTMLDivElement>(null);
  const [logoMotionActive, setLogoMotionActive] = useState(false);
  const [homeHasEntered, setHomeHasEntered] = useState(false);
  const draftKey='grokbot-task-draft-v1-'+(draftScope || 'local');
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [restoredDraftKey, setRestoredDraftKey] = useState('');
  useEffect(() => { try { setPrompt(sessionStorage.getItem(draftKey) || ''); } catch {} setRestoredDraftKey(draftKey); }, [draftKey]);
  useEffect(() => { if(restoredDraftKey===draftKey) try { if(prompt) sessionStorage.setItem(draftKey,prompt); else sessionStorage.removeItem(draftKey); } catch {} }, [prompt,restoredDraftKey,draftKey]);
  useEffect(() => {
    const logo = logoRef.current;
    if (!logo) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isVisible = false;
    const syncMotion = () => {
      const active = isVisible && !document.hidden && !reducedMotion.matches && document.documentElement.dataset.motion !== 'false';
      setLogoMotionActive(active);
      if (active) setHomeHasEntered(true);
    };
    const visibilityObserver = new IntersectionObserver(([entry]) => { isVisible = entry.isIntersecting; syncMotion(); }, { threshold: 0.1 });
    const settingsObserver = new MutationObserver(syncMotion);
    visibilityObserver.observe(logo);
    settingsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    document.addEventListener('visibilitychange', syncMotion);
    reducedMotion.addEventListener('change', syncMotion);
    return () => {
      visibilityObserver.disconnect();
      settingsObserver.disconnect();
      document.removeEventListener('visibilitychange', syncMotion);
      reducedMotion.removeEventListener('change', syncMotion);
    };
  }, []);
  const [output, setOutput] = useState<'text' | 'image'>('text');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [dictating, setDictating] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef('');
  const finalSpeechRef = useRef('');
  const interimSpeechRef = useRef('');
  const speechFailedRef = useRef(false);
  useEffect(() => () => recognitionRef.current?.stop(), []);
  function toggleDictation() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setSpeechStatus('Speech input is not supported in this browser. You can type your task instead.');
      return;
    }
    dictationBaseRef.current = prompt.trim();
    finalSpeechRef.current = '';
    interimSpeechRef.current = '';
    speechFailedRef.current = false;
    setSpeechStatus('Listening. Speech recognition is handled by your browser.');
    setDictating(true);
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result[0]?.transcript.trim();
        if (!transcript) continue;
        (result.isFinal ? finalParts : interimParts).push(transcript);
      }
      finalSpeechRef.current = finalParts.join(' ');
      interimSpeechRef.current = interimParts.join(' ');
      setPrompt([dictationBaseRef.current, finalSpeechRef.current, interimSpeechRef.current].filter(Boolean).join(' '));
    };
    recognition.onerror = event => {
      speechFailedRef.current = true;
      setSpeechStatus(describeSpeechError(event.error));
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setDictating(false);
      if (speechFailedRef.current) return;
      setSpeechStatus(finalSpeechRef.current
        ? 'Dictation added. Review or edit it before starting.'
        : 'No speech detected. Try again.');
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setDictating(false);
      setSpeechStatus('Could not start speech recognition. Check your browser microphone permissions.');
    }
  }
  async function start(e: React.FormEvent) { e.preventDefault(); if (!prompt.trim() || busy || inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); try { await onStart(prompt, { ...options, output, provider: manager === 'auto' ? 'openai' : MODEL_CHOICES.find(choice => choice.model === manager)?.provider || options.provider || 'openai', model: manager === 'auto' ? 'gpt-6.1-sol' : manager, aspect_ratio: '16:9', duration: 4 }); if(mounted.current)setPrompt(''); try { if(sessionStorage.getItem(draftKey)===prompt)sessionStorage.removeItem(draftKey); } catch {} } catch (error) { const detail = error instanceof Error ? error.message : 'The task could not start. Try again.'; setError(detail + ' Your task is still here.'); } finally { inFlight.current = false; setBusy(false); } }
  return (
    <div className="quickstart">
      <div className="quickstart-panel" data-motion-entered={homeHasEntered}>
      <div className="quickstart-mark" ref={logoRef} data-motion-active={logoMotionActive}>
        <BinaryLens className="quickstart-real-lens" active={logoMotionActive} label="Cypher binary lens" />
      </div>
      <h1>What do you need done?</h1>
      <p className="quickstart-intro">Ask, research, write, or delegate work to your agents.</p>

      <form onSubmit={start} className="task-composer" aria-busy={busy} data-motion-active={logoMotionActive}>
        <label className="visually-hidden" htmlFor="first-task">Your task</label>
        <textarea
          disabled={busy}
          id="first-task"
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={output === 'image' ? 'Describe the image you have in mind…' : 'Ask anything…'}
          rows={1}
          maxLength={20000}
        />
        <div className="task-composer-footer">
          <button type="button" className="task-dictate-button" onClick={toggleDictation} disabled={busy} aria-label={dictating ? 'Stop dictation' : 'Dictate task'} aria-pressed={dictating} title="Dictate a task with your browser speech service">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></svg>
            <span>{dictating ? 'Listening…' : 'Dictate'}</span>
          </button>
          <div className="task-composer-options">
            <GlassSelect
              disabled={busy}
              aria-label="Manager model"
              value={manager}
              onChange={event => {
                const selectedModel = event.target.value;
                onOptions({
                  ...options,
                  routing: selectedModel === 'auto' ? 'auto' : 'manual',
                  provider: MODEL_CHOICES.find(model => model.model === selectedModel)?.provider || 'openai',
                  model: selectedModel === 'auto' ? 'gpt-6.1-sol' : selectedModel,
                });
                try { localStorage.setItem('grokbot-manager', selectedModel); } catch {}
              }}
            >
              <option value="auto">Auto</option>
              {MODEL_CHOICES.map(model => <option key={model.id} value={model.model}>{model.label}</option>)}
            </GlassSelect>
            <GlassSelect disabled={busy} aria-label="Task output" value={output} onChange={event => setOutput(event.target.value as 'text' | 'image')}>
              <option value="text">Text</option>
              <option value="image">Create an image</option>
            </GlassSelect>
          </div>
          <button aria-label={busy ? 'Starting task' : 'Start task'} disabled={busy || !prompt.trim()} type="submit" className="btn-primary">
            <span>{busy ? 'Starting…' : 'Start task'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </button>
        </div>
      </form>
      {speechStatus ? <p className="speech-status" role="status">{speechStatus}</p> : null}

      {error ? <p className="quickstart-error" role="alert">{error}</p> : null}

      <nav className="starter-prompts" aria-label="Start with an idea">
          {STARTER_PROMPTS.map(item => (
            <button
              type="button"
              disabled={busy}
              key={item.text}
              onClick={() => {
                setPrompt(item.prompt);
                setOutput('text');
                document.getElementById('first-task')?.focus();
              }}
            >{item.text}</button>
          ))}
      </nav>

      <RecentWork onOpen={onOpenRecent} />

      <span className={busy ? 'quickstart-status' : 'visually-hidden'} role="status">{busy ? <><BinaryLens className="quickstart-busy-lens" active={logoMotionActive} label="Cypher working" />Opening your conversation…</> : ''}</span>
      </div>
    </div>
  );
}
