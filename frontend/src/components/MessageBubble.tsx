import { useState } from 'react';
import { Bot, Message } from '../lib/types';
export function MessageBubble({ message, bot, grouped = false }: { message: Message; bot?: Bot; grouped?: boolean }) {
  const [copyState, setCopyState] = useState('Copy');
  async function copy() { try { await navigator.clipboard.writeText(message.content); setCopyState('Copied'); } catch { setCopyState('Copy unavailable'); } }
  function download() { const url=URL.createObjectURL(new Blob([message.content],{type:'text/plain'})); const link=document.createElement('a'); link.href=url; link.download='response.txt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  const tool = message.messageType === 'tool_call' || String(message.messageType) === 'tool_result';
  return <article className={`message ${message.senderType === 'user' ? 'outgoing' : 'incoming'} ${tool ? 'tool-message' : ''} ${grouped ? 'message-grouped' : ''}`}>
    {bot && !grouped ? <div className="message-sender">{bot.name}</div> : null}
    <div className="message-content">{tool ? <details><summary>{message.messageType === 'tool_call' ? 'Tool activity' : 'Tool result'}</summary><pre>{message.content}</pre></details> : message.content}
    {message.attachments?.map((a,i) => a.mime.startsWith('video/') ? <video key={i} className="message-video" src={a.url} controls preload="metadata"/> : a.mime.startsWith('image/') ? <img className="message-image" key={i} src={a.url || `data:${a.mime};base64,${a.data}`} alt={a.name}/> : <a className="file-chip" key={i} href={a.url} target="_blank" rel="noreferrer">{a.name}</a>)}</div>
    {message.senderType === 'bot' && !tool && !message.internal ? <details className="message-actions"><summary aria-label="Message actions">Options</summary><div><button onClick={copy}>{copyState}</button><button onClick={download}>Download text</button></div></details> : null}
    <time dateTime={message.createdAt}>{new Date(message.createdAt + (message.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time>
  </article>;
}
