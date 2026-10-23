import { MODEL_CHOICES } from '../lib/presets';
import { GlassSelect } from './GlassSelect';
import { useEffect, useRef, useState } from 'react';
import { RunOptions } from '../lib/types';
import BinaryLens from './cipher/BinaryLens';
import CipherIntro from './cipher/CipherIntro';

const STARTER_PROMPTS = [
  { text: 'Research a topic', prompt: 'Research this topic and give me a clear, sourced brief: ' },
  { text: 'Draft a creative brief', prompt: 'Create a detailed creative brief for ' },
  { text: 'Write a storyboard', prompt: 'Write a cinematic storyboard for ' },
];

export function QuickStart({ onStart, onCreateBot, onCreateRoom, onOpenLounge, onOpenSetup, options, onOptions, draftScope }: { draftScope?: string; options: RunOptions; onOptions: (options: RunOptions) => void; onStart: (prompt: string, options: Partial<RunOptions>) => Promise<void>; onCreateBot: () => void; onCreateRoom: () => void; onOpenLounge: () => Promise<unknown>; onOpenSetup?: () => void }) {
  const manager = options.routing==='manual'?(options.model || 'gpt-6.1-sol'):'auto';
  const [prompt, setPrompt] = useState('');
  const draftKey='grokbot-task-draft-v1-'+(draftScope || 'local');
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [restoredDraftKey, setRestoredDraftKey] = useState('');
  useEffect(() => { try { setPrompt(sessionStorage.getItem(draftKey) || ''); } catch {} setRestoredDraftKey(draftKey); }, [draftKey]);
  useEffect(() => { if(restoredDraftKey===draftKey) try { if(prompt) sessionStorage.setItem(draftKey,prompt); else sessionStorage.removeItem(draftKey); } catch {} }, [prompt,restoredDraftKey,draftKey]);
  const [output, setOutput] = useState<'text' | 'image'>('text');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  async function start(e: React.FormEvent) { e.preventDefault(); if (!prompt.trim() || busy || inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); try { await onStart(prompt, { ...options, output, provider: manager === 'auto' ? 'openai' : MODEL_CHOICES.find(choice => choice.model === manager)?.provider || options.provider || 'openai', model: manager === 'auto' ? 'gpt-6.1-sol' : manager, aspect_ratio: '16:9', duration: 4 }); if(mounted.current)setPrompt(''); try { if(sessionStorage.getItem(draftKey)===prompt)sessionStorage.removeItem(draftKey); } catch {} } catch (error) { const detail = error instanceof Error ? error.message : 'The task could not start. Try again.'; setError(detail + ' Your task is still here.'); } finally { inFlight.current = false; setBusy(false); } }
  return (
    <div className="quickstart">
      <CipherIntro />
      <BinaryLens className="cipher-home-mark" cols={17} rows={7} active label="Cypher mark" />
      <h1>What would you like to get done?</h1>
      <p className="quickstart-intro">Describe the outcome. Choose a model or output if your task needs one.</p>

      <form onSubmit={start} className="task-composer" aria-busy={busy}>
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
          placeholder={output === 'image' ? 'Describe the image you have in mind…' : 'Ask anything, or describe a task…'}
          rows={2}
          maxLength={20000}
        />
        <div className="task-composer-footer">
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
            <option value="auto">Auto · task specialists</option>
            {MODEL_CHOICES.map(model => <option key={model.id} value={model.model}>{model.label}</option>)}
          </GlassSelect>
          <GlassSelect disabled={busy} aria-label="Task output" value={output} onChange={event => setOutput(event.target.value as 'text' | 'image')}>
            <option value="text">Ask anything</option>
            <option value="image">Create an image</option>
          </GlassSelect>
          <button disabled={busy || !prompt.trim()} type="submit" className="btn-primary">
            <span>{busy ? 'Starting…' : 'Start task'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </button>
        </div>
      </form>

      {error ? <p className="quickstart-error" role="alert">{error}</p> : null}

      <section className="quickstart-section quickstart-suggestions" aria-labelledby="quickstart-suggestions-title">
        <h2 id="quickstart-suggestions-title">Try a starting point</h2>
        <div className="starter-prompts">
          {STARTER_PROMPTS.map(item => (
            <button
              disabled={busy}
              key={item.text}
              onClick={() => {
                setPrompt(item.prompt);
                setOutput('text');
                document.getElementById('first-task')?.focus();
              }}
            >{item.text}</button>
          ))}
        </div>
      </section>

      <section className="quickstart-section quickstart-actions" aria-labelledby="quickstart-actions-title">
        <h2 id="quickstart-actions-title">Your workspace</h2>
        <nav className="workspace-shortcuts" aria-label="Workspace shortcuts">
          <button onClick={onCreateBot}>Create an agent</button>
          <button onClick={() => { setBusy(true); onOpenLounge().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)); }} disabled={busy}>Open your team</button>
          <button onClick={onCreateRoom}>Create a team</button>
          {onOpenSetup ? <button onClick={onOpenSetup}>Connect models</button> : null}
        </nav>
      </section>

      <p className="quickstart-footnote">Enter to start · Shift + Enter for a new line · Draft saved in this tab</p>
      <span className={busy ? 'quickstart-status' : 'visually-hidden'} role="status">{busy ? 'Opening your conversation…' : ''}</span>
    </div>
  );
}
