"use client";
import React, { useEffect, useState } from 'react';
import { useBots } from '../hooks/useBots';
import { BotRoster } from '../components/BotRoster';
import { ChatPanel } from '../components/ChatPanel';
import { BotCreator } from '../components/BotCreator';
import { RoomCreator } from '../components/RoomCreator';
import { Conversation } from '../lib/types';
import { api } from '../lib/api';
export default function Page() {
  const { bots, selectedBot, setSelectedBot, createBot, error } = useBots();
  const [creator, setCreator] = useState<'bot' | 'room' | null>(null);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Conversation | null>(null);
  const [roomError, setRoomError] = useState('');
  useEffect(() => { let active = true; api.getConversations().then(data => { if (active) { setRooms(data.filter(c => c.is_group)); setRoomError(''); } }).catch(() => { if (active) setRoomError('Team rooms could not load.'); }); return () => { active = false; }; }, []);
  return <div className="app-layout">
    {error || roomError ? <p className="runtime-notice" role="alert">{error ? error.replace(/^Error: /, '') : roomError} <button onClick={() => window.location.reload()}>Retry connection</button></p> : null}
    <BotRoster bots={bots} selectedBot={selectedRoom ? null : selectedBot} onSelectBot={bot => { setSelectedRoom(null); setSelectedBot(bot); }} onCreateNew={() => setCreator('bot')} rooms={rooms} selectedRoom={selectedRoom} onSelectRoom={setSelectedRoom} onCreateRoom={() => setCreator('room')}/>
    <ChatPanel key={selectedRoom?.id || selectedBot?.id || "workspace"} bot={selectedRoom ? null : selectedBot} room={selectedRoom} bots={bots} onCreateBot={() => setCreator('bot')} onCreateRoom={() => setCreator('room')}/>
    {creator === 'bot' ? <BotCreator onClose={() => setCreator(null)} onCreate={createBot}/> : null}
    {creator === 'room' ? <RoomCreator bots={bots} onClose={() => setCreator(null)} onCreated={room => { setRooms(list => [...list, room]); setSelectedRoom(room); }}/> : null}
  </div>;
}
