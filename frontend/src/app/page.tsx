"use client";
import React, { useEffect, useState } from 'react';
import { useBots } from '../hooks/useBots';
import { BotRoster } from '../components/BotRoster';
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
export default function Page() {
  const { bots, selectedBot, setSelectedBot, createBot, error, refreshBots } = useBots();
  const [creator, setCreator] = useState<'bot' | 'room' | 'setup' | 'plugins' | 'preferences' | 'goals' | 'channels' | null>(null);
  useEffect(()=>restoreAppearance(),[]);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Conversation | null>(null);
  const [roomError, setRoomError] = useState('');
  useEffect(() => { let active = true; api.getConversations().then(data => { if (active) { setRooms(data.filter(c => c.is_group)); setRoomError(''); } }).catch(() => { if (active) setRoomError('Team rooms could not load.'); }); return () => { active = false; }; }, []);
  async function openLounge() {
    const room = await api.defaultTeam();
    await refreshBots();
    setRooms(list => list.some(item => item.id === room.id) ? list : [...list, room]);
    setSelectedBot(null); setSelectedRoom(room);
    return room;
  }
  async function openGoalWorkspace(id:string){
    const room=(await api.getConversations()).find(item=>item.id===id);
    if(!room)return;
    if(room.is_group){setSelectedRoom(room);setSelectedBot(null);}else{const agent=(await api.getBots()).find(item=>item.id===room.bot_ids[0]);if(agent){setSelectedRoom(null);setSelectedBot(agent);}}
    setCreator(null);
  }
  async function quickStart(prompt: string, options: Partial<RunOptions>) {
    const room = await api.defaultTeam();
    await api.sendMessage(room.id, prompt, [], { ...DEFAULT_OPTIONS, ...options });
    await openLounge();
  }
  return <div className="app-layout">
    {error || roomError ? <p className="runtime-notice" role="alert">{error ? 'Connect your cloud workspace to start working.' : roomError} <button onClick={() => setCreator('setup')}>Workspace setup</button></p> : null}
    <BotRoster bots={bots} selectedBot={selectedRoom ? null : selectedBot} onSelectBot={bot => { setSelectedRoom(null); setSelectedBot(bot); }} onCreateNew={() => setCreator('bot')} rooms={rooms} selectedRoom={selectedRoom} onSelectRoom={setSelectedRoom} onCreateRoom={() => setCreator('room')} onHome={() => { setSelectedRoom(null); setSelectedBot(null); }} onSetup={() => setCreator('setup')} onPlugins={() => setCreator('plugins')} onPreferences={()=>setCreator('preferences')} onGoals={()=>setCreator('goals')} onChannels={()=>setCreator('channels')}/>
    <ChatPanel key={selectedRoom?.id || selectedBot?.id || "workspace"} bot={selectedRoom ? null : selectedBot} room={selectedRoom} bots={bots} onCreateBot={() => setCreator('bot')} onCreateRoom={() => setCreator('room')} onQuickStart={quickStart} onOpenLounge={openLounge}/>
    {creator === 'preferences' ? <PreferencesPanel onClose={()=>setCreator(null)}/> : null}
    {creator === 'goals' ? <GoalsPanel onOpenWorkspace={id=>void openGoalWorkspace(id)} rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}
    {creator === 'channels' ? <ChannelsPanel rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}
    {creator === 'plugins' ? <PluginPanel onClose={() => setCreator(null)}/> : null}
    {creator === 'setup' ? <WorkspaceSetup onClose={() => setCreator(null)}/> : null}
    {creator === 'bot' ? <BotCreator onClose={() => setCreator(null)} onCreate={createBot}/> : null}
    {creator === 'room' ? <RoomCreator bots={bots} onClose={() => setCreator(null)} onCreated={room => { setRooms(list => [...list, room]); setSelectedRoom(room); }}/> : null}
  </div>;
}
