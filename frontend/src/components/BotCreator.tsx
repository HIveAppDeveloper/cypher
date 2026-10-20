import React, { useState, useEffect, useRef } from 'react';
import { Bot } from '../lib/types';
import { ModelControls, ModelValue } from './ModelControls';
import { AGENT_PRESETS } from '../lib/presets';
export function BotCreator({ onClose, onCreate }: { onClose: () => void; onCreate: (bot: Partial<Bot>) => Promise<Bot> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preset, setPreset] = useState(AGENT_PRESETS[0]);
  const [name, setName] = useState('');
  const [modelValue, setModelValue] = useState<ModelValue>({ provider: 'gemini', model: 'gemini-2.5-flash' });
  const [instructions, setInstructions] = useState(preset.prompt);
  const [tools, setTools] = useState(['browser', 'shell', 'filesystem', 'media']);
  const [custom, setCustom] = useState(false);
  const [customProvider, setCustomProvider] = useState('openai');
  const [customModel, setCustomModel] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const el = dialog.current; const previous = document.activeElement as HTMLElement | null; el?.showModal(); return () => { el?.close(); previous?.focus(); }; }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    const model = { provider: modelValue.provider!, model: modelValue.model! };
    try {
      await onCreate({ name: name.trim(), role: preset.name, description: preset.description, systemPrompt: instructions, llmProvider: custom ? customProvider : model.provider, llmModel: custom ? customModel.trim() : model.model, toolsEnabled: tools.length ? tools : ['none'], defaultOptions: custom ? {} : { ...modelValue } });
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
      {!custom ? <ModelControls value={modelValue} onChange={setModelValue}/> : <p className="field-help">Using your custom model configuration.</p>}
      <details className="advanced-settings"><summary>Customize this agent</summary>
        <label htmlFor="bot-prompt">Instructions</label><textarea id="bot-prompt" rows={5} required maxLength={20000} value={instructions} onChange={e => setInstructions(e.target.value)}/>
        <fieldset className="tool-picker"><legend>Tools it can use</legend>{[{id:'browser',label:'Browse websites'},{id:'shell',label:'Run code'},{id:'filesystem',label:'Work with files'},{id:'media',label:'Generate images & video'}].map(tool => <label key={tool.id}><input type="checkbox" checked={tools.includes(tool.id)} onChange={e => setTools(e.target.checked ? [...tools, tool.id] : tools.filter(t => t !== tool.id))}/>{tool.label}</label>)}</fieldset>
        <label className="check-row"><input type="checkbox" checked={custom} onChange={e => setCustom(e.target.checked)}/>Use a custom model</label>
        {custom ? <div className="custom-model-fields"><label htmlFor="custom-provider">Provider</label><select id="custom-provider" value={customProvider} onChange={e => setCustomProvider(e.target.value)}><option value="openai">OpenAI / compatible</option><option value="gemini">Google Gemini</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option><option value="ollama">Ollama</option></select><label htmlFor="custom-model">Custom model ID</label><input id="custom-model" required value={customModel} onChange={e => setCustomModel(e.target.value)}/></div> : null}
      </details>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div><div className="dialog-actions"><button disabled={saving} type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button disabled={saving} type="submit" className="btn-primary">{saving ? 'Creating…' : 'Create agent'}</button></div>
    </form>
  </dialog>;
}
