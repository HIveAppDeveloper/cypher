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
import { api,request } from '../lib/api';
import { CommandPalette, WorkspaceCommand } from './CommandPalette';
import { WorkspaceHub } from './WorkspaceHub';
import { ComputerPanel } from './ComputerPanel';

export default function WorkspaceApp({ accountEmail }: { accountEmail?: string }) {
  const { bots, selectedBot, setSelectedBot, createBot, error, refreshBots } = useBots();
  const [creator, setCreator] = useState<'bot' | 'room' | 'setup' | 'plugins' | 'preferences' | 'goals' | 'channels' | 'hub' | 'computer' | null>(null);
  useEffect(()=>{restoreAppearance();if(new URLSearchParams(window.location.search).has('plugins'))setCreator('plugins');},[]);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Conversation | null>(null);
  const [roomError, setRoomError] = useState('');
  const [pendingApprovals,setPendingApprovals]=useState(0);
  const [hubTab,setHubTab]=useState<'Memory'|'Activity'>('Memory');
  useEffect(()=>{let active=true;const load=()=>{if(document.hidden)return;void request('/computer/approvals/pending').then(data=>{if(active)setPendingApprovals(data.length);}).catch(()=>{});};load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[]);
  useEffect(() => { let active = true; api.getConversations().then(data => { if (active) { setRooms(data.filter(c => c.is_group)); const lounge=data.find(c=>c.is_group && c.title==='Agent lounge'); if(lounge && !new URLSearchParams(window.location.search).has('conversation'))setSelectedRoom(lounge); setRoomError(''); } }).catch(() => { if (active) setRoomError('Team rooms could not load.'); }); return () => { active = false; }; }, []);
  async function openLounge() { const room = await api.defaultTeam(); await refreshBots(); setRooms(list => list.some(item => item.id === room.id) ? list : [...list, room]); setSelectedBot(null); setSelectedRoom(room); return room; }
  async function openGoalWorkspace(id:string){ const room=(await api.getConversations()).find(item=>item.id===id); if(!room){setRoomError('This saved conversation could not be found.');return;} const agent=room.is_group?null:(await api.getBots()).find(item=>item.id===room.bot_ids[0])||null;setSelectedRoom(room);setSelectedBot(agent);setCreator(null); }
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
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('conversation');if(id)void openGoalWorkspace(id).catch(()=>setRoomError('Could not open the saved conversation.'));},[]);
  const commands: WorkspaceCommand[] = [
    {id:'new',label:'New task',group:'Action',run:()=>{setSelectedRoom(null);setSelectedBot(null);}},
    {id:'plugins',label:'Connect tools',group:'Action',detail:'Browse and manage plugins',run:()=>setCreator('plugins')},
    {id:'agent',label:'Create an agent',group:'Action',run:()=>setCreator('bot')},
    {id:'room',label:'Create a team',group:'Action',run:()=>setCreator('room')},
    {id:'goals',label:'Scheduled goals',group:'Action',run:()=>setCreator('goals')},
    {id:'computer',label:'Computer, browser & files',group:'Workspace',run:()=>setCreator('computer')},
    {id:'workspace',label:'Memory, skills & routines',group:'Workspace',detail:'Agents, usage and activity',run:()=>setCreator('hub')},
    {id:'appearance',label:'Appearance',group:'Settings',run:()=>setCreator('preferences')},
    ...rooms.map(room=>({id:'room-'+room.id,label:room.title==='Agent lounge'?'Your team':room.title,group:'Team',run:()=>{setSelectedRoom(room);setSelectedBot(null);}})),
    ...bots.map(bot=>({id:'bot-'+bot.id,label:bot.name,detail:bot.description||bot.role,group:'Agent',run:()=>{setSelectedRoom(null);setSelectedBot(bot);}})),
  ];
  return <div className="app-layout"><SidebarShell><CommandPalette commands={commands}/><BotRoster accountEmail={accountEmail} bots={bots} selectedBot={selectedRoom?.is_group ? null : selectedBot} onSelectBot={bot => { setSelectedRoom(null); setSelectedBot(bot); }} onCreateNew={() => setCreator('bot')} rooms={rooms} selectedRoom={selectedRoom} onSelectRoom={room => { setSelectedRoom(room); setSelectedBot(null); }} onCreateRoom={() => setCreator('room')} onHome={() => { setSelectedRoom(null); setSelectedBot(null); }} onSetup={() => setCreator('setup')} onPlugins={() => setCreator('plugins')} onPreferences={()=>setCreator('preferences')} onGoals={()=>setCreator('goals')} onChannels={()=>setCreator('channels')} onWorkspace={()=>{setHubTab('Memory');setCreator('hub');}} onComputer={()=>setCreator('computer')}/></SidebarShell><div className="workspace-main">{pendingApprovals?<div className="workspace-alert" role="status"><span>{pendingApprovals} tool action{pendingApprovals===1?'':'s'} need your approval.</span><button onClick={()=>{setHubTab('Activity');setCreator('hub');}}>Review actions</button></div>:null}{error || roomError ? <div className="workspace-alert" role="alert"><span>{error ? error.replace(/^Error: /,'') : roomError}</span><button onClick={() => { void refreshBots().catch(() => {}); api.getConversations().then(data => { setRooms(data.filter(c => c.is_group)); setRoomError(''); }).catch(() => setRoomError('Rooms could not load.')); }}>Retry</button><button onClick={() => setCreator('setup')}>Connection settings</button></div> : null}<ChatPanel key={selectedRoom?.id || selectedBot?.id || "workspace"} bot={selectedRoom?.is_group ? null : selectedBot} room={selectedRoom} bots={bots} onCreateBot={() => setCreator('bot')} onCreateRoom={() => setCreator('room')} onQuickStart={quickStart} onOpenLounge={openLounge}/></div>{creator === 'computer' ? <ComputerPanel bots={bots} onClose={()=>setCreator(null)}/> : null}{creator === 'hub' ? <WorkspaceHub initialTab={hubTab} bots={bots} rooms={rooms} ensureRoom={openLounge} onRefresh={refreshBots} onOpenWorkspace={id=>void openGoalWorkspace(id)} onClose={()=>setCreator(null)}/> : null}{creator === 'preferences' ? <PreferencesPanel onClose={()=>setCreator(null)}/> : null}{creator === 'goals' ? <GoalsPanel onOpenWorkspace={id=>void openGoalWorkspace(id)} rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}{creator === 'channels' ? <ChannelsPanel rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}{creator === 'plugins' ? <PluginPanel onClose={() => setCreator(null)}/> : null}{creator === 'setup' ? <WorkspaceSetup onClose={() => setCreator(null)}/> : null}{creator === 'bot' ? <BotCreator onClose={() => setCreator(null)} onCreate={async (data, requestId) => { const bot = await createBot(data, true, requestId); setSelectedRoom(null); return bot; }}/> : null}{creator === 'room' ? <RoomCreator bots={bots} onClose={() => setCreator(null)} onCreated={room => { setRooms(list => [...list, room]); setSelectedRoom(room); }}/> : null}</div>;
}
