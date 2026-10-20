import React, { useState, useEffect, useRef } from 'react';
import { Bot } from '../lib/types';
export function BotCreator({ onClose, onCreate }: { onClose: () => void; onCreate: (bot: Partial<Bot>) => Promise<Bot> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState({ name: '', role: '', systemPrompt: '', llmModel: 'gemini-2.5-flash', llmProvider: 'gemini' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const el = dialog.current; const previous = document.activeElement as HTMLElement | null; el?.showModal(); return () => { el?.close(); previous?.focus(); }; }, []);
  async function submit(e: React.FormEvent) { e.preventDefault(); setSaving(true); try { await onCreate(data); onClose(); } catch (e) { setError(String(e)); } finally { setSaving(false); } }
  return <dialog ref={dialog} className="bot-dialog" aria-labelledby="create-bot-heading" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <h2 id="create-bot-heading">Create a bot</h2>
    <form onSubmit={submit}>
      <label htmlFor="bot-name">Name</label><input autoFocus id="bot-name" required value={data.name} onChange={e => setData({ ...data, name: e.target.value })}/>
      <label htmlFor="bot-role">Role</label><input id="bot-role" required value={data.role} onChange={e => setData({ ...data, role: e.target.value })}/>
      <label htmlFor="bot-provider">Provider</label><input id="bot-provider" required value={data.llmProvider} onChange={e => setData({ ...data, llmProvider: e.target.value })}/>
      <label htmlFor="bot-model">Model</label><input id="bot-model" required value={data.llmModel} onChange={e => setData({ ...data, llmModel: e.target.value })}/>
      <label htmlFor="bot-prompt">Instructions</label><textarea id="bot-prompt" rows={4} required value={data.systemPrompt} onChange={e => setData({ ...data, systemPrompt: e.target.value })}/>
      {error ? <p role="alert">{error.replace(/^Error: /, '')}</p> : null}
      <div className="dialog-actions"><button disabled={saving} type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button disabled={saving} type="submit" className="btn-primary">{saving ? 'Creating…' : 'Create bot'}</button></div>
    </form>
  </dialog>;
}
