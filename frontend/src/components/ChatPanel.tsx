import React, { useEffect, useState, useRef } from 'react';
import { Bot, Message } from '../lib/types';
import { api } from '../lib/api';
import { BotAvatar } from './BotAvatar';
import { MessageBubble } from './MessageBubble';
const POLL_INTERVAL_MS = 1500;
export function ChatPanel({ bot }: { bot: Bot | null }) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const stream = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => { if (followLatest.current && stream.current) stream.current.scrollTop = stream.current.scrollHeight; }, [messages.length, messages[messages.length - 1]?.id]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    followLatest.current = true;
    setConversationId(''); setMessages([]); setError('');
    if (!bot) return;
    const poll = async (id: string) => {
      try { const data = await api.getMessages(id); if (active) { setMessages(data); setError(''); } }
      catch (e) { if (active) setError(String(e)); }
      if (active) timer = setTimeout(() => poll(id), POLL_INTERVAL_MS);
    };
    api.conversationForBot(bot).then(id => { if (active) { setConversationId(id); void poll(id); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; clearTimeout(timer); };
  }, [bot?.id]);
  async function send() {
    if (!input.trim() || !conversationId || sending) return;
    setSending(true); setError('');
    try { await api.sendMessage(conversationId, input); setInput(''); }
    catch (e) { setError(String(e)); }
    finally { setSending(false); }
  }
  if (!bot) return <main className="main-content empty-chat"><h1>Your team, in one conversation.</h1><p>Create a bot to begin.</p></main>;
  return <main className="main-content">
    <header className="chat-header"><span className="identity-pill"><BotAvatar name={bot.name} small />{bot.name}</span><button className="sandbox-button" onClick={() => api.startBot(bot.id).catch(e => setError(String(e)))}>Start computer</button></header>
    {error ? <p role="alert">{error}</p> : null}
    <div ref={stream} onScroll={() => { const el = stream.current; if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="message-stream" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>{messages.map(m => <MessageBubble key={m.id} message={m} bot={bot} />)}</div>
    <div className="composer"><label htmlFor="message" className="visually-hidden">Message {bot.name}</label>
    <textarea rows={1} placeholder={`Message ${bot.name}`} id="message" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
    <button className="send-button" aria-label="Send message" disabled={!conversationId || sending || !input.trim()} onClick={send}><svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div>
  </main>;
}
