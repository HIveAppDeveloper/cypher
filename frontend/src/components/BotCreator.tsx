import React, { useState, useEffect, useRef } from 'react';
import { Bot } from '../lib/types';
import { ModelControls, ModelValue } from './ModelControls';
import { AGENT_PRESETS } from '../lib/presets';
export function BotCreator({ onClose, onCreate }: { onClose: () => void; onCreate: (bot: Partial<Bot>) => Promise<Bot> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preset, setPreset] = useState(AGENT_PRESETS[0]);
  const [name, setName] = useState('');
  const [modelValue, setModelValue] = useState<ModelValue>({ provider: 'openai', model: 'gpt-6.1-sol', reasoning_effort: 'medium' });
  const [instructions, setInstructions] = useState(preset.prompt);
  const [tools, setTools] = useState(['browser', 'shell', 'filesystem', 'media', 'plugins']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const el = dialog.current; const previous = document.activeElement as HTMLElement | null; el?.showModal(); return () => { el?.close(); previous?.focus(); }; }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    const model = { provider: modelValue.provider!, model: modelValue.model! };
    try {
      await onCreate({ name: name.trim(), role: preset.name, description: preset.description, systemPrompt: instructions, llmProvider: model.provider, llmModel: model.model, toolsEnabled: tools.length ? tools : ['none'], defaultOptions: { ...modelValue } });
      onClose();
    } catch (e) { setError(String(e).replace(/^Error: /, '')); } finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="bot-dialog" aria-labelledby="create-bot-heading" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <h2 id="create-bot-heading">Meet your next agent.</h2>
    <p className="dialog-intro">Pick a role. Everything else has a sensible default.</p>
    <form className="agent-form" onSubmit={submit}><div className="agent-form-fields">
      <label htmlFor="agent-role">What should it do?</label>
      <select autoFocus id="agent-role" value={preset.id} onChange={e => { const next = AGENT_PRESETS.find(p => p.id === e.target.value)!; setPreset(next); setInstructions(next.prompt); }}>{AGENT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}</select>
      <label htmlFor="bot-name">Name <span className="optional-label">optional</span></label><input id="bot-name" placeholder={preset.name} maxLength={80} value={name} onChange={e => setName(e.target.value)}/>
      <ModelControls value={modelValue} onChange={setModelValue}/>
      <details className="advanced-settings"><summary>Customize this agent</summary>
        <label htmlFor="bot-prompt">Instructions</label><textarea id="bot-prompt" rows={5} required maxLength={20000} value={instructions} onChange={e => setInstructions(e.target.value)}/>
        <fieldset className="tool-picker"><legend>Tools it can use</legend>{[{id:'browser',label:'Browse websites'},{id:'shell',label:'Run code'},{id:'filesystem',label:'Work with files'},{id:'media',label:'Generate images & video'},{id:'plugins',label:'Use connected plugins'}].map(tool => <label key={tool.id}><input type="checkbox" checked={tools.includes(tool.id)} onChange={e => setTools(e.target.checked ? [...tools, tool.id] : tools.filter(t => t !== tool.id))}/>{tool.label}</label>)}</fieldset>
      </details>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div><div className="dialog-actions"><button disabled={saving} type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button disabled={saving} type="submit" className="btn-primary">{saving ? 'Creating…' : 'Create agent'}</button></div>
    </form>
  </dialog>;
}
