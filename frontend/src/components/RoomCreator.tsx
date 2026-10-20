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
  useEffect(() => { const prev = document.activeElement as HTMLElement; const el = ref.current; el?.showModal(); return () => { el?.close(); prev?.focus(); }; }, []);
  async function submit(e: React.FormEvent) { e.preventDefault(); setSaving(true); try { onCreated(await api.createRoom(title, selected)); onClose(); } catch (e) { setError(String(e)); } finally { setSaving(false); } }
  return <dialog ref={ref} className="bot-dialog" aria-labelledby="team-heading" onCancel={e => { e.preventDefault(); onClose(); }}><h2 id="team-heading">Create a team room</h2><p className="dialog-intro">Agents read each other’s work, take turns, and hand tasks to a teammate.</p><form onSubmit={submit}><label htmlFor="room-name">Room name</label><input id="room-name" autoFocus required placeholder="Launch planning" value={title} onChange={e => setTitle(e.target.value)}/><fieldset className="agent-picker"><legend>Select 2–6 agents</legend>{bots.map(bot => <label key={bot.id}><BotAvatar name={bot.name} small/><span>{bot.name}<small>{bot.role}</small></span><input type="checkbox" checked={selected.includes(bot.id)} disabled={!selected.includes(bot.id) && selected.length >= 6} onChange={e => setSelected(ids => e.target.checked ? [...ids, bot.id] : ids.filter(id => id !== bot.id))}/></label>)}{bots.length < 2 ? <p>Create at least two agents first.</p> : null}</fieldset>{error ? <p role="alert">{error}</p> : null}<div className="dialog-actions"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || selected.length < 2}>Create room</button></div></form></dialog>;
}
