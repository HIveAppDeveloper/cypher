'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useBots } from '../hooks/useBots';
import { BotRoster } from '../components/BotRoster';
import { SidebarShell } from '../components/SidebarShell';
import { ChatPanel } from '../components/ChatPanel';
import { BotCreator } from '../components/BotCreator';
import { PluginPanel } from '../components/PluginPanel';
import { PreferencesPanel,restoreAppearance } from '../components/PreferencesPanel';
import { GoalsPanel } from '../components/GoalsPanel';
import { ChannelsPanel } from '../components/ChannelsPanel';
import { WorkspaceSetup } from '../components/WorkspaceSetup';
import { RoomCreator } from '../components/RoomCreator';
import { DEFAULT_OPTIONS } from '../components/RunControls';
import { Conversation, RunOptions } from '../lib/types';
import { api } from '../lib/api';

export default function WorkspaceApp({ accountEmail }: { accountEmail?: string }) {
  const { bots, selectedBot, setSelectedBot, createBot, error, refreshBots } = useBots();
  const [creator, setCreator] = useState<'bot' | 'room' | 'setup' | 'plugins' | 'preferences' | 'goals' | 'channels' | null>(null);
  useEffect(()=>{restoreAppearance();if(new URLSearchParams(window.location.search).has('plugins'))setCreator('plugins');},[]);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Conversation | null>(null);
  const [roomError, setRoomError] = useState('');
  useEffect(() => { let active = true; api.getConversations().then(data => { if (active) { setRooms(data.filter(c => c.is_group)); const lounge=data.find(c=>c.is_group && c.title==='Agent lounge'); if(lounge)setSelectedRoom(lounge); setRoomError(''); } }).catch(() => { if (active) setRoomError('Team rooms could not load.'); }); return () => { active = false; }; }, []);
  async function openLounge() { const room = await api.defaultTeam(); await refreshBots(); setRooms(list => list.some(item => item.id === room.id) ? list : [...list, room]); setSelectedBot(null); setSelectedRoom(room); return room; }
  async function openGoalWorkspace(id:string){ const room=(await api.getConversations()).find(item=>item.id===id); if(!room)return; if(room.is_group){setSelectedRoom(room);setSelectedBot(null);}else{const agent=(await api.getBots()).find(item=>item.id===room.bot_ids[0]);if(agent){setSelectedRoom(null);setSelectedBot(agent);}} setCreator(null); }
  const pendingQuickTask = useRef<{ signature: string; id: string } | null>(null);
  async function quickStart(prompt: string, options: Partial<RunOptions>) {
    const signature=JSON.stringify({prompt,options});
    if(pendingQuickTask.current?.signature!==signature)pendingQuickTask.current={signature,id:crypto.randomUUID()};
    const room=await api.defaultTeam();
    await api.sendMessage(room.id,prompt,[],{...DEFAULT_OPTIONS,...options},pendingQuickTask.current.id);
    pendingQuickTask.current=null;
    setRooms(list=>list.some(item=>item.id===room.id)?list:[...list,room]);setSelectedBot(null);setSelectedRoom(room);
    void refreshBots().catch(()=>{});
  }
  return <div className="app-layout"><SidebarShell><BotRoster accountEmail={accountEmail} bots={bots} selectedBot={selectedRoom ? null : selectedBot} onSelectBot={bot => { setSelectedRoom(null); setSelectedBot(bot); }} onCreateNew={() => setCreator('bot')} rooms={rooms} selectedRoom={selectedRoom} onSelectRoom={room => { setSelectedRoom(room); setSelectedBot(null); }} onCreateRoom={() => setCreator('room')} onHome={() => { setSelectedRoom(null); setSelectedBot(null); }} onSetup={() => setCreator('setup')} onPlugins={() => setCreator('plugins')} onPreferences={()=>setCreator('preferences')} onGoals={()=>setCreator('goals')} onChannels={()=>setCreator('channels')}/></SidebarShell><div className="workspace-main">{error || roomError ? <div className="workspace-alert" role="alert"><span>We couldn’t load {error ? 'your agents' : 'your rooms'}. Your existing work is preserved.</span><button onClick={() => { void refreshBots().catch(() => {}); api.getConversations().then(data => { setRooms(data.filter(c => c.is_group)); setRoomError(''); }).catch(() => setRoomError('Rooms could not load.')); }}>Retry</button><button onClick={() => setCreator('setup')}>Connection settings</button></div> : null}<ChatPanel key={selectedRoom?.id || selectedBot?.id || "workspace"} bot={selectedRoom ? null : selectedBot} room={selectedRoom} bots={bots} onCreateBot={() => setCreator('bot')} onCreateRoom={() => setCreator('room')} onQuickStart={quickStart} onOpenLounge={openLounge}/></div>{creator === 'preferences' ? <PreferencesPanel onClose={()=>setCreator(null)}/> : null}{creator === 'goals' ? <GoalsPanel onOpenWorkspace={id=>void openGoalWorkspace(id)} rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}{creator === 'channels' ? <ChannelsPanel rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}{creator === 'plugins' ? <PluginPanel onClose={() => setCreator(null)}/> : null}{creator === 'setup' ? <WorkspaceSetup onClose={() => setCreator(null)}/> : null}{creator === 'bot' ? <BotCreator onClose={() => setCreator(null)} onCreate={async data => { const bot = await createBot(data); setSelectedRoom(null); return bot; }}/> : null}{creator === 'room' ? <RoomCreator bots={bots} onClose={() => setCreator(null)} onCreated={room => { setRooms(list => [...list, room]); setSelectedRoom(room); }}/> : null}</div>;
}
