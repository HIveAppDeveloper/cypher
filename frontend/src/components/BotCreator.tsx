import React, { useState, useEffect, useRef } from 'react';
import { Bot } from '../lib/types';
export function BotCreator({ onClose, onCreate }: { onClose: () => void; onCreate: (bot: Partial<Bot>) => Promise<Bot> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState({ name: '', role: '', systemPrompt: '', llmModel: 'gemini-2.5-flash', llmProvider: 'gemini', toolsEnabled: ['browser', 'shell', 'filesystem'] as string[] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  useEffect(() => { const el = dialog.current; const previous = document.activeElement as HTMLElement | null; el?.showModal(); return () => { el?.close(); previous?.focus(); }; }, []);
  async function submit(e: React.FormEvent) { e.preventDefault(); setSaving(true); try { await onCreate({ ...data, toolsEnabled: data.toolsEnabled.length ? data.toolsEnabled : ["none"] }); onClose(); } catch (e) { setError(String(e)); } finally { setSaving(false); } }
  return <dialog ref={dialog} className="bot-dialog" aria-labelledby="create-bot-heading" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <h2 id="create-bot-heading">Create a bot</h2>
    <form onSubmit={submit}>
      <label htmlFor="bot-name">Name</label><input autoFocus id="bot-name" required value={data.name} onChange={e => setData({ ...data, name: e.target.value })}/>
      <label htmlFor="bot-role">Role</label><input id="bot-role" required value={data.role} onChange={e => setData({ ...data, role: e.target.value })}/>
      <label htmlFor="bot-provider">Provider</label><select id="bot-provider" value={data.llmProvider} onChange={e => setData({ ...data, llmProvider: e.target.value, llmModel: e.target.value === "gemini" ? "gemini-2.5-flash" : "" })}><option value="gemini">Google Gemini</option><option value="openai">OpenAI / compatible</option><option value="anthropic">Anthropic</option><option value="ollama">Ollama</option><option value="deepseek">DeepSeek</option></select>
      <label htmlFor="model-choice">Model</label><select id="model-choice" value={customModel || data.llmProvider !== 'gemini' ? 'custom' : 'gemini-2.5-flash'} onChange={e => { setCustomModel(e.target.value === 'custom'); if (e.target.value !== 'custom') setData({ ...data, llmModel: e.target.value }); }}>{data.llmProvider === 'gemini' ? <option value="gemini-2.5-flash">Gemini 2.5 Flash</option> : null}<option value="custom">Custom model ID</option></select>{customModel || data.llmProvider !== 'gemini' ? <><label htmlFor="bot-model">Model ID</label><input id="bot-model" placeholder="Your provider's model ID" required value={data.llmModel} onChange={e => setData({ ...data, llmModel: e.target.value })}/></> : null}
      <fieldset className="tool-picker"><legend>Tools</legend>{['browser','shell','filesystem'].map(tool => <label key={tool}><input type="checkbox" checked={data.toolsEnabled.includes(tool)} onChange={e => setData({ ...data, toolsEnabled: e.target.checked ? [...data.toolsEnabled, tool] : data.toolsEnabled.filter(t => t !== tool) })}/>{tool}</label>)}</fieldset>
      <label htmlFor="bot-prompt">Instructions</label><textarea id="bot-prompt" rows={4} required value={data.systemPrompt} onChange={e => setData({ ...data, systemPrompt: e.target.value })}/>
      {error ? <p role="alert">{error.replace(/^Error: /, '')}</p> : null}
      <div className="dialog-actions"><button disabled={saving} type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button disabled={saving} type="submit" className="btn-primary">{saving ? 'Creating…' : 'Create bot'}</button></div>
    </form>
  </dialog>;
}
