import React, { useState, useRef, useEffect } from 'react';
import { Bot, Message, MessageType } from '../lib/types';
import { MessageBubble } from './MessageBubble';
import { api } from '../lib/api';

interface ChatPanelProps {
  bot: Bot | null;
}

export function ChatPanel({ bot }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bot) {
      // Mock fetch messages
      setMessages([
        { id: '1', conversationId: '1', senderType: 'bot', senderBotId: bot.id, content: `Hello! I'm ${bot.name}, ready to work.`, messageType: MessageType.TEXT, createdAt: new Date().toISOString() }
      ]);
    } else {
      setMessages([]);
    }
  }, [bot]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !bot) return;
    
    const newMsg: Message = {
      id: Date.now().toString(),
      conversationId: '1', // Mock conv ID
      senderType: 'user',
      content: input,
      messageType: MessageType.TEXT,
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    
    // Mock response
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        conversationId: '1',
        senderType: 'bot',
        senderBotId: bot.id,
        content: `I received: ${newMsg.content}`,
        messageType: MessageType.TEXT,
        createdAt: new Date().toISOString()
      }]);
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!bot) {
    return (
      <div className="main-content" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <h2 className="h2" style={{ color: 'var(--text-muted)' }}>Select a bot to start chatting</h2>
      </div>
    );
  }

  return (
    <div className="main-content">
      <div style={{
        padding: 'var(--space-md)',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <h2 className="h2">{bot.name}</h2>
          <span className="small">{bot.role}</span>
        </div>
        <button className="btn-secondary" onClick={() => api.startBot(bot.id)}>Start Sandbox</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} bot={bot || undefined} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            style={{ resize: 'none', minHeight: '44px', maxHeight: '120px' }}
            rows={1}
          />
          <button className="btn-primary" onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  );
}
