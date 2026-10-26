import { useEffect, useRef, useState } from 'react';
import { Bot, Conversation } from '../lib/types';
import { api } from '../lib/api';
import { BotAvatar } from './BotAvatar';
export function RoomCreator({ bots, onClose, onCreated }: { bots: Bot[]; onClose: () => void; onCreated: (room: Conversation) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { const prev = document.activeElement as HTMLElement; const el = ref.current; el?.showModal(); return () => { el?.close(); prev?.focus(); }; }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const roomName = title.trim();
    if (!roomName) { setError('Add a name for this team room.'); return; }
    if (selected.length < 2) { setError('Select at least two agents to create a team room.'); return; }
    inFlight.current = true; setSaving(true); setError('');
    try { onCreated(await api.createRoom(roomName, selected)); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <dialog ref={ref} className="bot-dialog" aria-labelledby="team-heading" onCancel={e => { e.preventDefault(); if (!inFlight.current) onClose(); }}>
    <h2 id="team-heading">Create a team room</h2>
    <p className="dialog-intro">Agents read each other’s work, take turns, and hand tasks to a teammate.</p>
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{saving ? 'Creating your team room…' : ''}</p>
    <form aria-busy={saving} onSubmit={submit}>
      <label htmlFor="room-name">Room name</label>
      <input id="room-name" autoFocus required disabled={saving} placeholder="Launch planning" value={title} onChange={e => { setTitle(e.target.value); setError(''); }}/>
      <fieldset className="agent-picker" disabled={saving}>
        <legend>Select 2–6 agents</legend>
        {bots.map(bot => <label key={bot.id}><BotAvatar name={bot.name} small/><span>{bot.name}<small>{bot.role}</small></span><input type="checkbox" checked={selected.includes(bot.id)} disabled={!selected.includes(bot.id) && selected.length >= 6} onChange={e => { setSelected(ids => e.target.checked ? [...ids, bot.id] : ids.filter(id => id !== bot.id)); setError(''); }}/></label>)}
        {bots.length < 2 ? <p>Create at least two agents first.</p> : null}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving || selected.length < 2}>{saving ? 'Creating…' : 'Create room'}</button>
      </div>
    </form>
  </dialog>;
}
