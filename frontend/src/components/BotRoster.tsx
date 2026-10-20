import { useState } from 'react';
import { Bot, Conversation } from '../lib/types';
import { BotAvatar } from './BotAvatar';
export function BotRoster({ bots, selectedBot, onSelectBot, onCreateNew, rooms, selectedRoom, onSelectRoom, onCreateRoom }: { bots: Bot[]; selectedBot: Bot | null; onSelectBot: (bot: Bot) => void; onCreateNew: () => void; rooms: Conversation[]; selectedRoom: Conversation | null; onSelectRoom: (room: Conversation) => void; onCreateRoom: () => void }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  return <aside className="sidebar">
    <header className="roster-toolbar"><span className="workspace-name">GrokBot</span><button className="round-button" aria-label="Search bots" onClick={() => setSearching(v => !v)}><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg></button><button className="round-button" aria-label="Create bot" onClick={onCreateNew}><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg></button></header>
    {searching ? <input autoFocus aria-label="Search bots" placeholder="Search bots" value={query} onChange={e => setQuery(e.target.value)} className="search-input" /> : null}
    <nav className="roster-list" aria-label="Bots"><div className="section-label">Agents</div>{bots.filter(b => b.name.toLowerCase().includes(query.toLowerCase())).map(bot => <button key={bot.id} className={`bot-row ${selectedBot?.id === bot.id ? 'selected' : ''}`} onClick={() => onSelectBot(bot)}><BotAvatar name={bot.name}/><span className="bot-row-text"><strong>{bot.name}</strong><span>{bot.status === 'working' ? 'Working…' : bot.description || bot.role}</span></span></button>)}
    {!bots.length ? <div className="roster-empty">Your team starts here.<button onClick={onCreateNew}>Create your first bot</button></div> : null}<div className="section-label rooms-label"><span>Team rooms</span><button aria-label="Create team room" onClick={onCreateRoom}>New</button></div>{rooms.map(room => <button key={room.id} className={`bot-row ${selectedRoom?.id === room.id ? "selected" : ""}`} onClick={() => onSelectRoom(room)}><span className="room-avatar"><svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM7 3v4m10-4v4M8 11h8m-8 4h5"/></svg></span><span className="bot-row-text"><strong>{room.title}</strong><span>{room.bot_ids.length} agents · shared context</span></span></button>)}</nav>
    <footer className="roster-footer"><span className="owner-avatar">B</span><span className="workspace-label">Hive + Atlas</span></footer>
  </aside>;
}
