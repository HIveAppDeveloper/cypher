import { useEffect, useState } from 'react';
import { LoadingState } from './LoadingState';
import { Bot, Conversation } from '../lib/types';
import { BotAvatar } from './BotAvatar';
import { request } from '../lib/api';
import type { WorkspacePreferences } from './WorkspaceHub';

export function BotRoster({ bots, selectedBot, onSelectBot, onCreateNew, rooms, selectedRoom, onSelectRoom, onCreateRoom, onHome, onSetup, onPlugins, onPreferences, onGoals, onChannels, onWorkspace, onComputer, accountEmail, loadingAgents = false, loadingRooms = false, agentsError = false, roomsError = false }: { loadingAgents?: boolean; loadingRooms?: boolean; agentsError?: boolean; roomsError?: boolean; onWorkspace:()=>void; onComputer:()=>void; accountEmail?: string; bots: Bot[]; selectedBot: Bot | null; onSelectBot: (bot: Bot) => void; onCreateNew: () => void; rooms: Conversation[]; selectedRoom: Conversation | null; onSelectRoom: (room: Conversation) => void; onCreateRoom: () => void; onHome: () => void; onSetup: () => void; onPlugins: () => void; onPreferences: () => void; onGoals: () => void; onChannels: () => void }) {
  const [prefs, setPrefs] = useState<WorkspacePreferences>({});
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const [onlyWorking, setOnlyWorking] = useState(false);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAllRooms, setShowAllRooms] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      void request('/workspace/settings').then(data => { if (active) setPrefs(data); }).catch(() => {});
    };
    load();
    window.addEventListener('grokbot:preferences', load);
    return () => { active = false; window.removeEventListener('grokbot:preferences', load); };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('grokbot-pinned-agents-v1') || '[]');
      if (Array.isArray(saved)) setPinned(saved.filter((id: unknown): id is string => typeof id === 'string').slice(0, 100));
    } catch {}
    setPinsLoaded(true);
  }, []);
  useEffect(() => {
    if (pinsLoaded) try { localStorage.setItem('grokbot-pinned-agents-v1', JSON.stringify(pinned)); } catch {}
  }, [pinned, pinsLoaded]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleBots = bots
    .filter(bot => !prefs.hidden_bots?.includes(bot.id)
      && (!onlyWorking || bot.status === 'working')
      && [bot.name, bot.role, bot.description].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id))
      || (Object.entries(prefs.bot_sections || {}).find(([, ids]) => ids.includes(a.id))?.[0] || 'Agents')
        .localeCompare(Object.entries(prefs.bot_sections || {}).find(([, ids]) => ids.includes(b.id))?.[0] || 'Agents'));
  const previewBots = visibleBots.slice(0, 3);
  if (selectedBot && visibleBots.some(bot => bot.id === selectedBot.id) && !previewBots.some(bot => bot.id === selectedBot.id)) {
    previewBots.splice(previewBots.length - 1, 1, selectedBot);
  }
  const renderedBots = searching && normalizedQuery || showAllAgents ? visibleBots : previewBots;
  const hiddenAgentCount = visibleBots.length - previewBots.length;
  const showAgentToggle = (!searching || !normalizedQuery) && (hiddenAgentCount > 0 || showAllAgents);
  const visibleRooms = rooms.filter(room => room.title.toLowerCase().includes(normalizedQuery));
  const previewRooms = visibleRooms.slice(0, 1);
  if (selectedRoom && visibleRooms.some(room => room.id === selectedRoom.id) && !previewRooms.some(room => room.id === selectedRoom.id)) {
    previewRooms.splice(0, 1, selectedRoom);
  }
  const renderedRooms = searching && normalizedQuery || showAllRooms ? visibleRooms : previewRooms;
  const showRoomToggle = (!searching || !normalizedQuery) && (visibleRooms.length > previewRooms.length || showAllRooms);

  return <aside className="sidebar">
    <button className="new-task-button" onClick={onHome} title="New task">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>New task</span>
    </button>

    {searching ? <input autoFocus aria-label="Search agents and rooms" placeholder="Find an agent, role, or room…" value={query} onChange={event => setQuery(event.target.value)} className="search-input" onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearching(false); } }} /> : null}

    <header className="roster-toolbar">
      <span className="section-label">Agents</span>
      <button className="round-button" aria-label="Search agents and rooms" aria-expanded={searching} onClick={() => { setSearching(value => !value); setQuery(''); }}>
        <svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg>
      </button>
      <button className="round-button" aria-label="Create agent" onClick={onCreateNew}>
        <svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>
      </button>
    </header>

    <details className="roster-filter-details">
      <summary aria-label="Filter agents" title="Filter agents"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 7.2v5.5l-3 1.6v-7.1L4 5Z"/></svg></summary>
      <div className="roster-filters" aria-label="Filter agents">
        <button aria-pressed={!onlyWorking} onClick={() => setOnlyWorking(false)}>All</button>
        <button aria-pressed={onlyWorking} onClick={() => setOnlyWorking(value => !value)}>Working <span>{bots.filter(bot => bot.status === 'working').length}</span></button>
      </div>
    </details>

    <nav className="roster-list" aria-label="Agents and team rooms">
      {loadingAgents && !bots.length ? <LoadingState label="Loading your agents…" variant="roster"/> : null}
      {renderedBots.map((bot, index) => <div className="agent-roster-item" key={bot.id}>
        {(() => {
          const section = Object.entries(prefs.bot_sections || {}).find(([, ids]) => ids.includes(bot.id))?.[0];
          const prior = Object.entries(prefs.bot_sections || {}).find(([, ids]) => ids.includes(visibleBots[index - 1]?.id))?.[0];
          return section && section !== prior ? <div className="agent-section-label">{section}</div> : null;
        })()}
        <button aria-label={bot.name} aria-current={selectedBot?.id === bot.id ? 'page' : undefined} title={[bot.name, bot.description || bot.role].filter(Boolean).join(' · ')} className={`bot-row ${selectedBot?.id === bot.id ? 'selected' : ''}`} onClick={() => onSelectBot(bot)}>
          <BotAvatar name={bot.name}/><span className="bot-row-text"><strong>{bot.name}</strong><span>{bot.status === 'working' ? 'Working…' : bot.description || bot.role}</span></span>
        </button>
        <button className="pin-agent" aria-label={`${pinned.includes(bot.id) ? 'Unpin' : 'Pin'} ${bot.name}`} aria-pressed={pinned.includes(bot.id)} title={`${pinned.includes(bot.id) ? 'Unpin' : 'Pin'} ${bot.name}`} onClick={() => setPinned(current => current.includes(bot.id) ? current.filter(id => id !== bot.id) : [...current, bot.id])}>
          <svg viewBox="0 0 24 24"><path d="m8 3 8 0-1 6 4 4v2H5v-2l4-4-1-6Zm4 12v7"/></svg>
        </button>
      </div>)}
      {bots.length && !visibleBots.length ? <p className="roster-no-results">{onlyWorking ? 'No matching agents are working.' : 'No matching agents.'}</p> : null}
      {showAgentToggle ? <button className="roster-show-all" onClick={() => setShowAllAgents(value => !value)}>{showAllAgents ? 'Show fewer' : `Show all ${visibleBots.length} agents`}</button> : null}
      {!loadingAgents && !agentsError && !bots.length ? <div className="roster-empty">Your team starts here.<button onClick={onCreateNew}>Create your first agent</button></div> : null}

      <div className="section-label rooms-label"><span>Team rooms</span><button aria-label="Create team room" onClick={onCreateRoom}>New</button></div>
      {loadingRooms && !rooms.length ? <LoadingState label="Loading your team rooms…" variant="roster" rows={1}/> : null}
      {renderedRooms.map(room => <button aria-label={room.title} aria-current={selectedRoom?.id === room.id ? 'page' : undefined} title={room.title} key={room.id} className={`bot-row ${selectedRoom?.id === room.id ? 'selected' : ''}`} onClick={() => onSelectRoom(room)}>
        <span className="room-avatar"><svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM7 3v4m10-4v4M8 11h8m-8 4h5"/></svg></span>
        <span className="bot-row-text"><strong>{room.title === 'Agent lounge' ? 'Your team' : room.title}</strong><span>{room.bot_ids.length} agents · shared context</span></span>
      </button>)}
      {showRoomToggle ? <button className="roster-show-all rooms-show-all" onClick={() => setShowAllRooms(value => !value)}>{showAllRooms ? 'Show fewer rooms' : `Show all ${visibleRooms.length} rooms`}</button> : null}
      {!loadingRooms && normalizedQuery && !visibleRooms.length ? <p className="roster-no-results">No matching rooms.</p> : null}
      {!loadingRooms && !roomsError && !rooms.length ? <p className="roster-no-results">No team rooms yet.</p> : null}
    </nav>

    <details className="sidebar-more">
      <summary>More</summary>
      <div className="sidebar-more-content">
        <nav className="workspace-destinations" aria-label="Workspace tools">
          <button className="preferences-nav" onClick={onComputer} aria-label="Computer"><svg viewBox="0 0 24 24"><path d="M3 4h18v13H3zM8 21h8m-4-4v4"/></svg><span>Computer</span></button>
          <button className="preferences-nav" onClick={onWorkspace} aria-label="Workspace library"><svg viewBox="0 0 24 24"><path d="M4 4h6v16H4zM14 4h6v16h-6z"/></svg><span>Memory, skills &amp; routines</span></button>
          <button className="preferences-nav" onClick={onGoals} aria-label="Goals"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m12 12 8-8"/></svg><span>Goals</span></button>
        </nav>
        <nav className="workspace-tools" aria-label="Tools and settings">
          <button className="plugins-nav" onClick={onPlugins} aria-label="Connect tools" title="Connect tools"><svg viewBox="0 0 24 24"><path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v3"/></svg><span>Connect tools</span></button>
          <button className="preferences-nav" onClick={onChannels} aria-label="Channels"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z"/></svg><span>Channels</span></button>
          <button className="preferences-nav" onClick={onPreferences} aria-label="Appearance"><svg viewBox="0 0 24 24"><path d="M5 4v16M12 4v16M19 4v16M2 8h6m1 8h6m1-6h6"/></svg><span>Appearance</span></button>
        </nav>
      </div>
    </details>

    <footer className="roster-footer">
      <span className="owner-avatar" aria-hidden="true">{(accountEmail || 'W').slice(0, 1).toUpperCase()}</span>
      <button className="workspace-label" onClick={onSetup} title={accountEmail || 'Workspace settings'} aria-label="Workspace setup"><span>Settings</span><small>{accountEmail || 'Workspace settings'}</small></button>
    </footer>
  </aside>;
}
