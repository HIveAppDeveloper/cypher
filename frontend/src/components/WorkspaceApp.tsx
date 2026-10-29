'use client';

import React, { useEffect, useRef, useState } from 'react';
import { PanelBoundary, RetryablePanel } from './PanelBoundary';
import { useBots } from '../hooks/useBots';
import { BotRoster } from '../components/BotRoster';
import { SidebarShell } from '../components/SidebarShell';
import { ChatPanel } from '../components/ChatPanel';
import { PreferencesPanel,restoreAppearance } from '../components/PreferencesPanel';
import { DEFAULT_OPTIONS } from '../components/RunControls';
import { Conversation, RunOptions, Attachment } from '../lib/types';
import { api,request } from '../lib/api';
import { CommandPalette, WorkspaceCommand } from './CommandPalette';
import CypherEntrance from './cipher/CypherEntrance';

const loadBotCreator = () => import('./BotCreator').then(module => ({ default: module.BotCreator }));
const loadPluginPanel = () => import('./PluginPanel').then(module => ({ default: module.PluginPanel }));
const loadGoalsPanel = () => import('./GoalsPanel').then(module => ({ default: module.GoalsPanel }));
const loadChannelsPanel = () => import('./ChannelsPanel').then(module => ({ default: module.ChannelsPanel }));
const loadWorkspaceSetup = () => import('./WorkspaceSetup').then(module => ({ default: module.WorkspaceSetup }));
const loadRoomCreator = () => import('./RoomCreator').then(module => ({ default: module.RoomCreator }));
const loadWorkspaceHub = () => import('./WorkspaceHub').then(module => ({ default: module.WorkspaceHub }));
const loadComputerPanel = () => import('./ComputerPanel').then(module => ({ default: module.ComputerPanel }));

const BotCreator = (props: Parameters<typeof import('./BotCreator').BotCreator>[0]) => <RetryablePanel loader={loadBotCreator} componentProps={props}/>;
const PluginPanel = (props: Parameters<typeof import('./PluginPanel').PluginPanel>[0]) => <RetryablePanel loader={loadPluginPanel} componentProps={props}/>;
const GoalsPanel = (props: Parameters<typeof import('./GoalsPanel').GoalsPanel>[0]) => <RetryablePanel loader={loadGoalsPanel} componentProps={props}/>;
const ChannelsPanel = (props: Parameters<typeof import('./ChannelsPanel').ChannelsPanel>[0]) => <RetryablePanel loader={loadChannelsPanel} componentProps={props}/>;
const WorkspaceSetup = (props: Parameters<typeof import('./WorkspaceSetup').WorkspaceSetup>[0]) => <RetryablePanel loader={loadWorkspaceSetup} componentProps={props}/>;
const RoomCreator = (props: Parameters<typeof import('./RoomCreator').RoomCreator>[0]) => <RetryablePanel loader={loadRoomCreator} componentProps={props}/>;
const WorkspaceHub = (props: Parameters<typeof import('./WorkspaceHub').WorkspaceHub>[0]) => <RetryablePanel loader={loadWorkspaceHub} componentProps={props}/>;
const ComputerPanel = (props: Parameters<typeof import('./ComputerPanel').ComputerPanel>[0]) => <RetryablePanel loader={loadComputerPanel} componentProps={props}/>;

const PANEL_TITLES = { bot: 'Create agent', room: 'Create team', setup: 'Connection and AI settings', plugins: 'Apps', preferences: 'Settings', goals: 'Goals', channels: 'Channels', hub: 'Library', computer: 'Computer' };

export default function WorkspaceApp({ accountEmail, accountId }: { accountEmail?: string; accountId?: string }) {
  const { bots, selectedBot, setSelectedBot, createBot, error, refreshBots, loading: botsLoading } = useBots();
  const [creator, setCreatorState] = useState<'bot' | 'room' | 'setup' | 'plugins' | 'preferences' | 'goals' | 'channels' | 'hub' | 'computer' | null>(null);
  const createFromComputer = useRef(false);
  useEffect(()=>{restoreAppearance();const params=new URLSearchParams(window.location.search);if(params.has('plugins')||params.has('connect'))setCreatorState('plugins');},[]);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const navigated = useRef(false);
  const restoredBotFromReturn = useRef(false);
  const [selectedRoom, setSelectedRoom] = useState<Conversation | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null);
  const [roomError, setRoomError] = useState('');
  const [pendingApprovals,setPendingApprovals]=useState(0);
  const [hubTab,setHubTab]=useState<'Memory'|'Skills'|'Activity'>('Memory');
  const navigationGeneration = useRef(0);
  const [savedOpen, setSavedOpen] = useState<{id:string;closePanel:boolean;pending:boolean;error:string}|null>(null);
  function beginNavigation() { navigated.current = true; navigationGeneration.current++; setSavedOpen(null); return navigationGeneration.current; }
  function setCreator(next: typeof creator) { beginNavigation(); setCreatorState(next); }
  useEffect(() => () => { navigationGeneration.current++; }, []);

  useEffect(()=>{let active=true;const load=()=>{if(document.hidden)return;void request('/computer/approvals/pending').then(data=>{if(active)setPendingApprovals(data.length);}).catch(()=>{});};load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[]);
  useEffect(() => { let active = true; api.getConversations().then(data => { if (active) { setRooms(data.filter(c => c.is_group)); setRoomError(''); } }).catch(() => { if (active) setRoomError('Team rooms could not load.'); }).finally(() => { if (active) setRoomsLoading(false); }); return () => { active = false; }; }, []);
  async function openLounge() {
    const generation = beginNavigation();
    const room = await api.defaultTeam();
    if (generation !== navigationGeneration.current) throw new Error('Navigation changed before the team opened.');
    setRooms(list => list.some(item => item.id === room.id) ? list : [...list, room]);
    setSelectedBot(null); setSelectedRoom(room);
    void refreshBots().catch(() => {});
    return room;
  }
  function stopVoice() { setVoiceMode(false); setVoiceStream(current => { current?.getTracks().forEach(track => track.stop()); return null; }); }
  async function startVoiceFromHome(stream: MediaStream) { try { await openLounge(); setVoiceStream(stream); setVoiceMode(true); } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; } }
  function enableVoiceInConversation(stream: MediaStream) { setVoiceStream(stream); setVoiceMode(true); }
  async function openGoalWorkspace(id:string,closePanel=true) {
    const generation = beginNavigation();
    setSavedOpen({id,closePanel,pending:true,error:''});
    if (closePanel) setCreatorState(null);
    try {
      const conversations = await api.getConversations();
      if (generation !== navigationGeneration.current) return;
      const room = conversations.find(item => item.id === id);
      if (!room) { setSavedOpen({id,closePanel,pending:false,error:'This saved conversation could not be found.'}); return; }
      const agent = room.is_group ? null : (await api.getBots()).find(item => item.id === room.bot_ids[0]) || null;
      if (generation !== navigationGeneration.current) return;
      setRooms(conversations.filter(item => item.is_group));
      setSelectedRoom(room); setSelectedBot(agent);
      setRoomError(''); setSavedOpen(null);
    } catch (failure) {
      if (generation !== navigationGeneration.current) return;
      const detail = failure instanceof Error ? failure.message.replace(/^Error: /,'') : '';
      setSavedOpen({id,closePanel,pending:false,error:detail ? `This saved conversation could not be opened. ${detail}` : 'This saved conversation could not be opened. Please try again.'});
    }
  }
  const pendingQuickTask = useRef<{ signature: string; id: string } | null>(null);
  async function quickStart(prompt: string, options: Partial<RunOptions>, attachments: Attachment[] = []) {
    beginNavigation();
    const signature=JSON.stringify({prompt,options,attachments});
    if(pendingQuickTask.current?.signature!==signature)pendingQuickTask.current={signature,id:crypto.randomUUID()};
    const room=await api.defaultTeam();
    await api.sendMessage(room.id,prompt,attachments,{...DEFAULT_OPTIONS,...options},pendingQuickTask.current.id);
    pendingQuickTask.current=null;
    setRooms(list=>list.some(item=>item.id===room.id)?list:[...list,room]);setSelectedBot(null);setSelectedRoom(room);
    void refreshBots().catch(()=>{});
  }
  async function exploreConnection(name:string){
    setCreator(null);
    const prompt=`Use only my connected ${name} service and only its read-only tools. Show me a short, plain-language preview of useful information in my account. Do not create, change, delete, send, or share anything. If no read-only tool can show account information, explain that and stop.`;
    try{await quickStart(prompt,{allow_tools:true,output:'text',max_iterations:8,max_tokens:2048});}
    catch(error){setRoomError(error instanceof Error?error.message:'Could not open this service.');}
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('conversation');
    if (id) void openGoalWorkspace(id, false);
    else if (params.get('view') === 'work') { setHubTab('Activity'); setCreatorState('hub'); }
    else if (params.get('view') === 'saved') { setHubTab('Memory'); setCreatorState('hub'); }
    else if (params.get('view') === 'settings') setCreatorState('setup');
  }, []);
  useEffect(() => {
    if (navigated.current || botsLoading || restoredBotFromReturn.current) return;
    const botId = new URLSearchParams(window.location.search).get('bot');
    if (!botId) return;
    const requestedBot = bots.find(bot => bot.id === botId);
    if (!requestedBot) {
      if (!error) {
        restoredBotFromReturn.current = true;
        setRoomError('The agent from your sign-in link could not be found. Choose an agent from the sidebar.');
      }
      return;
    }
    restoredBotFromReturn.current = true;
    setSelectedRoom(null);
    setSelectedBot(requestedBot);
  }, [bots, botsLoading, error]);
  function openApps() { beginNavigation(); stopVoice(); setCreatorState('plugins'); }
  function openHome() { beginNavigation(); stopVoice(); setCreatorState(null); setSelectedRoom(null); setSelectedBot(null); }
  const activeView = creator === 'plugins' ? 'apps' : creator === 'hub' ? (hubTab === 'Activity' ? 'work' : 'saved') : creator === 'setup' || creator === 'preferences' ? 'settings' : !selectedBot && !selectedRoom ? 'home' : 'conversation';
  const commands: WorkspaceCommand[] = [
    {id:'new',label:'New task',group:'Action',run:openHome},
    {id:'plugins',label:'Connect an app',group:'Action',detail:'Find apps and manage access',run:openApps},
    {id:'agent',label:'Create an agent',group:'Action',run:()=>setCreator('bot')},
    {id:'room',label:'Create a team',group:'Action',run:()=>setCreator('room')},
    {id:'goals',label:'Scheduled goals',group:'Action',run:()=>setCreator('goals')},
    {id:'computer',label:'Computer, browser & files',group:'Workspace',run:()=>setCreator('computer')},
    {id:'workspace',label:'Saved info and tasks',group:'Workspace',detail:'Notes, instructions and scheduled work',run:()=>setCreator('hub')},
    {id:'appearance',label:'Settings',group:'Settings',run:()=>setCreator('preferences')},
    ...rooms.map(room=>({id:'room-'+room.id,label:room.title==='Agent lounge'?'Your team':room.title,group:'Team',run:()=>{beginNavigation();setSelectedRoom(room);setSelectedBot(null);}})),
    ...bots.map(bot=>({id:'bot-'+bot.id,label:bot.name,detail:bot.description||bot.role,group:'Agent',run:()=>{beginNavigation();setSelectedRoom(null);setSelectedBot(bot);}})),
  ];
  return <div className="app-layout"><CypherEntrance/><SidebarShell><CommandPalette commands={commands}/><BotRoster loadingAgents={botsLoading} loadingRooms={roomsLoading} agentsError={Boolean(error)} roomsError={Boolean(roomError)} accountEmail={accountEmail} bots={bots} selectedBot={selectedRoom?.is_group ? null : selectedBot} onSelectBot={bot => { beginNavigation(); setSelectedRoom(null); setSelectedBot(bot); }} onCreateNew={() => setCreator('bot')} rooms={rooms} selectedRoom={selectedRoom} onSelectRoom={room => { beginNavigation(); setSelectedRoom(room); setSelectedBot(null); }} onCreateRoom={() => setCreator('room')} onHome={openHome} activeView={activeView} onSetup={() => setCreator('setup')} onPlugins={openApps} onPreferences={()=>setCreator('preferences')} onGoals={()=>setCreator('goals')} onChannels={()=>setCreator('channels')} onWorkspace={()=>{setHubTab('Memory');setCreator('hub');}} onMyWork={()=>{setHubTab('Activity');setCreator('hub');}} onOpenRecent={id=>void openGoalWorkspace(id)} onComputer={()=>setCreator('computer')}/></SidebarShell><div className="workspace-main">{pendingApprovals?<div className="workspace-alert" role="status"><span>{pendingApprovals} tool action{pendingApprovals===1?'':'s'} need your approval.</span><button onClick={()=>{setHubTab('Activity');setCreator('hub');}}>Review actions</button></div>:null}{savedOpen?.pending ? <div className="workspace-alert" role="status">Opening saved conversation…</div> : null}{error || roomError || savedOpen?.error ? <div className="workspace-alert" role="alert"><span>{savedOpen?.error || (error ? error.replace(/^Error: /,'') : roomError)}</span><button disabled={Boolean(savedOpen?.pending)} onClick={() => { if (savedOpen) { void openGoalWorkspace(savedOpen.id,savedOpen.closePanel); return; } void refreshBots().catch(() => {}); api.getConversations().then(data => { setRooms(data.filter(c => c.is_group)); setRoomError(''); }).catch(() => setRoomError('Rooms could not load.')); }}>Retry</button><button onClick={() => setCreator('setup')}>Connection settings</button></div> : null}{creator === 'plugins' ? <PanelBoundary inline title="Apps" onClose={() => setCreator(null)}><PluginPanel embedded onExploreConnection={name => void exploreConnection(name)} onManageSkills={()=>{setHubTab('Skills');setCreator('hub');}} onClose={() => setCreator(null)}/></PanelBoundary> : null}<div className="workspace-conversation" hidden={creator === 'plugins'}><ChatPanel draftScope={accountId} key={selectedRoom?.id || selectedBot?.id || "workspace"} bot={selectedRoom?.is_group ? null : selectedBot} room={selectedRoom} bots={bots} onCreateBot={() => setCreator('bot')} onCreateRoom={() => setCreator('room')} onQuickStart={quickStart} onOpenLounge={openLounge} onOpenSetup={() => setCreator('setup')} onOpenRecent={id => void openGoalWorkspace(id)} onVoiceStart={startVoiceFromHome} voiceMode={voiceMode} voiceStream={voiceStream} onVoiceStream={enableVoiceInConversation} onVoiceStop={stopVoice}/></div></div>{creator && creator !== 'plugins' ? <PanelBoundary key={creator} title={PANEL_TITLES[creator]} onClose={()=>setCreator(null)}>{creator === 'computer' ? <ComputerPanel bots={bots} selectedBot={selectedBot} loadingAgents={botsLoading} agentsError={error} onRefreshAgents={()=>refreshBots()} onRetryAgents={()=>{void refreshBots().catch(()=>{});}} onSelectBot={bot=>{beginNavigation();setSelectedRoom(null);setSelectedBot(bot);}} onCreateAgent={()=>{createFromComputer.current=true;setCreator('bot');}} onClose={()=>setCreator(null)}/> : null}{creator === 'hub' ? <WorkspaceHub initialTab={hubTab} bots={bots} rooms={rooms} ensureRoom={openLounge} onRefresh={refreshBots} onOpenWorkspace={id=>void openGoalWorkspace(id)} onClose={()=>setCreator(null)}/> : null}{creator === 'preferences' ? <PreferencesPanel onClose={()=>setCreator(null)} onSetup={()=>setCreator('setup')}/> : null}{creator === 'goals' ? <GoalsPanel onOpenWorkspace={id=>void openGoalWorkspace(id)} rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}{creator === 'channels' ? <ChannelsPanel rooms={rooms} ensureRoom={openLounge} onClose={()=>setCreator(null)}/> : null}{creator === 'setup' ? <WorkspaceSetup onClose={() => setCreator(null)}/> : null}{creator === 'bot' ? <BotCreator onClose={() => {if(createFromComputer.current){createFromComputer.current=false;setCreator('computer');}else setCreator(null);}} onCreate={async (data, requestId) => { const bot = await createBot(data, true, requestId); setSelectedRoom(null); return bot; }}/> : null}{creator === 'room' ? <RoomCreator bots={bots} onClose={() => setCreator(null)} onCreated={room => { setRooms(list => [...list, room]); setSelectedRoom(room); }}/> : null}</PanelBoundary> : null}</div>;
}
