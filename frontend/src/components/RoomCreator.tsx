import { useEffect, useRef, useState } from 'react';
import { Bot, Conversation } from '../lib/types';
import { api } from '../lib/api';
import { BotAvatar } from './BotAvatar';
const MAX_TEAM_AGENTS = 200;

export function RoomCreator({ bots, onClose, onCreated }: { bots: Bot[]; onClose: () => void; onCreated: (room: Conversation) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const available = bots.filter((bot, index, all) => all.findIndex(item => item.id === bot.id) === index);
  const selectedIds = selected.filter(id => available.some(bot => bot.id === id));
  const visible = available.filter(bot => `${bot.name} ${bot.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visibleUnselected = visible.filter(bot => !selectedIds.includes(bot.id));
  function selectVisible() {
    setSelected(ids => Array.from(new Set([...ids.filter(id => available.some(bot => bot.id === id)), ...visible.map(bot => bot.id)])).slice(0, MAX_TEAM_AGENTS));
    setError('');
  }
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { const prev = document.activeElement as HTMLElement; const el = ref.current; el?.showModal(); return () => { el?.close(); prev?.focus(); }; }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const roomName = title.trim();
    if (!roomName) { setError('Add a name for this team room.'); return; }
    if (selectedIds.length < 2) { setError('Select at least two agents to create a team room.'); return; }
    if (selectedIds.length > MAX_TEAM_AGENTS) { setError('Choose up to 200 agents for this team room.'); return; }
    inFlight.current = true; setSaving(true); setError('');
    try { onCreated(await api.createRoom(roomName, selectedIds)); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <dialog ref={ref} className="bot-dialog team-room-dialog" aria-labelledby="team-heading" onCancel={e => { e.preventDefault(); if (!inFlight.current) onClose(); }}>
    <h2 id="team-heading">Create a team room</h2>
    <p className="dialog-intro">Bring up to 200 agents together. Each keeps its own instructions, shares work, and can hand a task to a teammate.</p>
    <span className="visually-hidden" role="status" aria-atomic="true">{saving ? 'Creating your team room…' : ''}</span>
    <form aria-busy={saving} onSubmit={submit}>
      <label htmlFor="room-name">Room name</label>
      <input id="room-name" autoFocus required disabled={saving} placeholder="Launch planning" value={title} onChange={e => { setTitle(e.target.value); setError(''); }}/>
      <fieldset className="agent-picker team-agent-picker" disabled={saving}>
        <legend>Select 2–200 agents</legend>
        <label className="team-agent-search" htmlFor="team-agent-search">Find agents</label>
        <input id="team-agent-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search names or roles"/>
        <div className="team-selection-tools">
          <span aria-live="polite" aria-atomic="true">{selectedIds.length} of {MAX_TEAM_AGENTS} selected</span>
          <button type="button" className="btn-secondary" disabled={saving || !visibleUnselected.length || selectedIds.length >= MAX_TEAM_AGENTS} onClick={selectVisible}>{query.trim() ? 'Select matches' : 'Select all'}</button>
          <button type="button" className="btn-secondary" disabled={saving || !selectedIds.length} onClick={() => { setSelected([]); setError(''); }}>Clear selection</button>
        </div>
        <div className="team-agent-list">
          {visible.map(bot => <label className="team-agent-option" key={bot.id} data-selected={selectedIds.includes(bot.id)}>
            <BotAvatar name={bot.name} agentRole={bot.role} small/>
            <span>{bot.name}<small>{bot.role}</small></span>
            <input type="checkbox" checked={selectedIds.includes(bot.id)} disabled={saving || (!selectedIds.includes(bot.id) && selectedIds.length >= MAX_TEAM_AGENTS)} onChange={e => { setSelected(ids => e.target.checked ? Array.from(new Set([...ids, bot.id])).slice(0, MAX_TEAM_AGENTS) : ids.filter(id => id !== bot.id)); setError(''); }}/>
          </label>)}
          {!visible.length && available.length ? <p className="field-help">No agents match this search.</p> : null}
          {available.length < 2 ? <p className="field-help">Create at least two agents first.</p> : null}
        </div>
      </fieldset>
      <p className="field-help">Agents collaborate in bounded turns. Adding members does not start a task or run every agent at once.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions"><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || selectedIds.length < 2}>{saving ? 'Creating…' : 'Create room'}</button></div>
    </form>
  </dialog>;
}
