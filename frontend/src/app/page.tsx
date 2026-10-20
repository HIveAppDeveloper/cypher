"use client";
import React, { useState } from 'react';
import { useBots } from '../hooks/useBots';
import { BotRoster } from '../components/BotRoster';
import { ChatPanel } from '../components/ChatPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { BotCreator } from '../components/BotCreator';

export default function Page() {
  const { bots, selectedBot, setSelectedBot, createBot, error } = useBots();
  const [showCreator, setShowCreator] = useState(false);

  return (
    <div className="app-layout">
      {error ? <p className="runtime-notice" role="alert">{error.replace(/^Error: /, "")}</p> : null}
      <BotRoster 
        bots={bots} 
        selectedBot={selectedBot} 
        onSelectBot={setSelectedBot} 
        onCreateNew={() => setShowCreator(true)} 
      />
      
      <ChatPanel bot={selectedBot} />
      

      
      {showCreator && (
        <BotCreator 
          onClose={() => setShowCreator(false)} 
          onCreate={createBot} 
        />
      )}
    </div>
  );
}
