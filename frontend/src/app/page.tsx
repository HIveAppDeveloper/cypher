"use client";
import React, { useEffect, useState } from 'react';
import { useBots } from '../hooks/useBots';
import { BotRoster } from '../components/BotRoster';
import { ChatPanel } from '../components/ChatPanel';
import { BotCreator } from '../components/BotCreator';
import { WorkspaceSetup } from '../components/WorkspaceSetup';
import { RoomCreator } from '../components/RoomCreator';
import { AGENT_PRESETS } from '../lib/presets';
import { DEFAULT_OPTIONS } from '../components/RunControls';
import { Conversation, RunOptions } from '../lib/types';
import { api } from '../lib/api';
export default function Page() {
  const { bots, selectedBot, setSelectedBot, createBot, error } = useBots();
  const [creator, setCreator] = useState<'bot' | 'room' | 'setup' | null>(null);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Conversation | null>(null);
  const [roomError, setRoomError] = useState('');
  useEffect(() => { let active = true; api.getConversations().then(data => { if (active) { setRooms(data.filter(c => c.is_group)); setRoomError(''); } }).catch(() => { if (active) setRoomError('Team rooms could not load.'); }); return () => { active = false; }; }, []);
  async function quickStart(prompt: string, options: Partial<RunOptions>) {
    const preset = AGENT_PRESETS[0];
    const bot = bots.find(b => b.name === 'Assistant') || await createBot({ name: 'Assistant', role: preset.name, description: preset.description, systemPrompt: preset.prompt, llmProvider: 'openai', llmModel: 'gpt-6.1-sol', toolsEnabled: ['browser', 'shell', 'filesystem', 'media'] }, false);
    const conversation = await api.conversationForBot(bot);
    await api.sendMessage(conversation, prompt, [], { ...DEFAULT_OPTIONS, ...options });
    setSelectedRoom(null); setSelectedBot(bot);
  }
  return <div className="app-layout">
    {error || roomError ? <p className="runtime-notice" role="alert">{error ? 'Connect your cloud workspace to start working.' : roomError} <button onClick={() => setCreator('setup')}>Workspace setup</button></p> : null}
    <BotRoster bots={bots} selectedBot={selectedRoom ? null : selectedBot} onSelectBot={bot => { setSelectedRoom(null); setSelectedBot(bot); }} onCreateNew={() => setCreator('bot')} rooms={rooms} selectedRoom={selectedRoom} onSelectRoom={setSelectedRoom} onCreateRoom={() => setCreator('room')} onHome={() => { setSelectedRoom(null); setSelectedBot(null); }} onSetup={() => setCreator('setup')}/>
    <ChatPanel key={selectedRoom?.id || selectedBot?.id || "workspace"} bot={selectedRoom ? null : selectedBot} room={selectedRoom} bots={bots} onCreateBot={() => setCreator('bot')} onCreateRoom={() => setCreator('room')} onQuickStart={quickStart}/>
    {creator === 'setup' ? <WorkspaceSetup onClose={() => setCreator(null)}/> : null}
    {creator === 'bot' ? <BotCreator onClose={() => setCreator(null)} onCreate={createBot}/> : null}
    {creator === 'room' ? <RoomCreator bots={bots} onClose={() => setCreator(null)} onCreated={room => { setRooms(list => [...list, room]); setSelectedRoom(room); }}/> : null}
  </div>;
}
