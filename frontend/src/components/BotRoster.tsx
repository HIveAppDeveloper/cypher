import { useState } from 'react';
import { Bot } from '../lib/types';
import { BotAvatar } from './BotAvatar';
export function BotRoster({ bots, selectedBot, onSelectBot, onCreateNew }: { bots: Bot[]; selectedBot: Bot | null; onSelectBot: (bot: Bot) => void; onCreateNew: () => void }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  return <aside className="sidebar">
    <header className="roster-toolbar"><span className="workspace-name">GrokBot</span><button className="round-button" aria-label="Search bots" onClick={() => setSearching(v => !v)}><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg></button><button className="round-button" aria-label="Create bot" onClick={onCreateNew}><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg></button></header>
    {searching ? <input autoFocus aria-label="Search bots" placeholder="Search bots" value={query} onChange={e => setQuery(e.target.value)} className="search-input" /> : null}
    <nav className="roster-list" aria-label="Bots">{bots.filter(b => b.name.toLowerCase().includes(query.toLowerCase())).map(bot => <button key={bot.id} className={`bot-row ${selectedBot?.id === bot.id ? 'selected' : ''}`} onClick={() => onSelectBot(bot)}><BotAvatar name={bot.name}/><span className="bot-row-text"><strong>{bot.name}</strong><span>{bot.status === 'working' ? 'Working…' : bot.description || bot.role}</span></span></button>)}
    {!bots.length ? <div className="roster-empty">Your team starts here.<button onClick={onCreateNew}>Create your first bot</button></div> : null}</nav>
    <footer className="roster-footer"><span className="owner-avatar">B</span><span className="workspace-label">Hive + Atlas</span></footer>
  </aside>;
}
