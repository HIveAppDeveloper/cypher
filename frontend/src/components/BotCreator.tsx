import { GlassSelect } from './GlassSelect';
import React, { useState, useEffect, useRef } from 'react';
import { Bot } from '../lib/types';
import { ModelControls, ModelValue } from './ModelControls';
import { AGENT_PRESETS, MODEL_CHOICES } from '../lib/presets';
export function BotCreator({ onClose, onCreate }: { onClose: () => void; onCreate: (bot: Partial<Bot>, clientRequestId: string) => Promise<Bot> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef<string>();
  const customization = useRef<HTMLDetailsElement>(null);
  const instructionsField = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const [preset, setPreset] = useState(AGENT_PRESETS[0]);
  const [name, setName] = useState('');
  const [modelValue, setModelValue] = useState<ModelValue>({ provider: 'openai', model: 'gpt-6.1-sol', reasoning_effort: 'medium' });
  const [instructions, setInstructions] = useState(preset.prompt);
  const [tools, setTools] = useState(['browser', 'shell', 'filesystem', 'media', 'plugins', 'prospecting']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const el = dialog.current; const previous = document.activeElement as HTMLElement | null; el?.showModal(); return () => { el?.close(); previous?.focus(); }; }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!instructions.trim()) { setError('Add instructions before creating this agent.'); if(customization.current)customization.current.open=true; instructionsField.current?.focus({preventScroll:true}); instructionsField.current?.scrollIntoView({block:'nearest',behavior:'instant'}); return; }
    inFlight.current = true;
    requestId.current ||= crypto.randomUUID();
    setSaving(true); setError('');
    const model = { provider: modelValue.provider!, model: modelValue.model! };
    try {
      await onCreate({ name: name.trim(), role: preset.name, description: preset.description, systemPrompt: instructions.trim(), llmProvider: model.provider, llmModel: model.model, toolsEnabled: tools.length ? tools : ['none'], defaultOptions: { ...modelValue } }, requestId.current);
      onClose();
    } catch (e) { setError(String(e).replace(/^Error: /, '')); } finally { inFlight.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="bot-dialog" aria-labelledby="create-bot-heading" onCancel={e => { e.preventDefault(); if (!inFlight.current) onClose(); }}>
    <h2 id="create-bot-heading">Meet your next agent.</h2>
    <p className="dialog-intro">Pick a role. Everything else has a sensible default.</p>
    <form className="agent-form" aria-busy={saving} noValidate onSubmit={submit}><div className="agent-form-fields">
      <label htmlFor="agent-role">What should it do?</label>
      <GlassSelect autoFocus id="agent-role" value={preset.id} onChange={e => { const next = AGENT_PRESETS.find(p => p.id === e.target.value)!; setPreset(next); setInstructions(next.prompt); }}>{AGENT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}</GlassSelect>
      <label htmlFor="bot-name">Name <span className="optional-label">optional</span></label><input id="bot-name" placeholder={preset.name} maxLength={80} value={name} onChange={e => setName(e.target.value)}/>
      <p className="agent-model-summary">Model: <strong>{MODEL_CHOICES.find(choice=>choice.model===modelValue.model)?.label || modelValue.model}</strong><span>Customize the model, instructions and tools below.</span></p>
      <details ref={customization} className="advanced-settings"><summary>Customize this agent</summary>
        <label htmlFor="bot-prompt">Instructions</label><textarea ref={instructionsField} aria-invalid={!!error && !instructions.trim()} aria-describedby={error && !instructions.trim() ? 'agent-instructions-error' : undefined} id="bot-prompt" rows={5} required maxLength={20000} value={instructions} onChange={e => setInstructions(e.target.value)}/>
        <ModelControls value={modelValue} onChange={setModelValue}/>
        <fieldset className="tool-picker"><legend>Tools it can use</legend>{[{id:'browser',label:'Browse websites'},{id:'shell',label:'Run code'},{id:'filesystem',label:'Work with files'},{id:'media',label:'Generate images and analyze video'},{id:'plugins',label:'Use connected plugins'},{id:'prospecting',label:'VC sourcing, matching & outreach prep'}].map(tool => <label key={tool.id}><input type="checkbox" checked={tools.includes(tool.id)} onChange={e => setTools(e.target.checked ? [...tools, tool.id] : tools.filter(t => t !== tool.id))}/>{tool.label}</label>)}</fieldset>
      </details>
      </div><div className="dialog-actions">{error ? <p id="agent-instructions-error" className="form-error" role="alert">{error}</p> : null}<button disabled={saving} type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button disabled={saving} type="submit" className="btn-primary">{saving ? 'Creating…' : 'Create agent'}</button></div>
    </form>
  </dialog>;
}
