import { useRef, useState } from 'react';
import { lazy, Suspense } from 'react';
import { Bot, Message } from '../lib/types';
import { BotAvatar } from './BotAvatar';
const MarkdownContent = lazy(() => import('./MarkdownContent'));
export function MessageBubble({ message, bot, grouped = false, groupEnd = true, showTimestamp = true, onReply }: { onReply?:(message:Message)=>void; message: Message; bot?: Bot; grouped?: boolean; groupEnd?: boolean; showTimestamp?: boolean }) {
  const [copyState, setCopyState] = useState('Copy');
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [failedImages, setFailedImages] = useState<number[]>([]);
  const [failedAudio, setFailedAudio] = useState<number[]>([]);
  const imageDialog = useRef<HTMLDialogElement>(null);
  function openImage(src: string, name: string) {
    setPreview({ src, name });
    imageDialog.current?.showModal();
  }
  async function copy() { try { await navigator.clipboard.writeText(message.content); setCopyState('Copied'); } catch { setCopyState('Copy unavailable'); } }
  function download() { const url=URL.createObjectURL(new Blob([message.content],{type:'text/plain'})); const link=document.createElement('a'); link.href=url; link.download='response.txt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  const tool = message.messageType === 'tool_call' || String(message.messageType) === 'tool_result';
  const displayContent = message.senderType === 'user'
    && message.content === 'Voice message attached. Please respond directly to what I said in the recording.'
    && message.attachments?.some(attachment => attachment.mime.startsWith('audio/'))
    ? 'Voice message' : message.content;
  const timestamp = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(message.createdAt) ? message.createdAt : message.createdAt + 'Z');
  const timeLabel = Number.isNaN(timestamp.getTime()) ? '' : timestamp.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  return <article className={`message ${message.senderType === 'user' ? 'outgoing' : 'incoming'} ${tool ? 'tool-message' : ''} ${grouped ? 'message-grouped' : ''} ${groupEnd ? 'message-group-end' : ''}`}>
    {message.senderType === 'bot' && !grouped ? <div className="message-sender-row"><BotAvatar name={bot?.name || 'Cypher'} small/><span className="message-sender">{bot?.name || 'Cypher'}</span></div> : null}
    {message.threadRootId?<small>Reply thread</small>:null}<div className="message-content">{tool ? <details><summary>{message.messageType === 'tool_call' ? 'Tool activity' : 'Tool result'}</summary><pre>{message.content}</pre></details> : message.senderType === 'bot' ? <div className="message-markdown"><Suspense fallback={<div className="message-text-fallback">{message.content}</div>}><MarkdownContent>{message.content}</MarkdownContent></Suspense></div> : displayContent}
    {message.attachments?.map((a,i) => {
      const src = a.url || (a.data ? `data:${a.mime};base64,${a.data}` : '');
      if (a.mime.startsWith('audio/')) return <div key={i} className="message-audio-attachment">
        {failedAudio.includes(i) ? <div role="status">Playback unavailable. <a href={src} download={a.name}>Download audio</a></div>
          : <audio className="message-audio" src={src} controls preload="metadata" aria-label={`Audio recording: ${a.name}`} onError={() => setFailedAudio(previous => [...previous, i])}/>}
      </div>;
      return a.mime.startsWith('video/') ? <video key={i} className="message-video" src={src} controls preload="metadata"/> : a.mime.startsWith('image/') ? failedImages.includes(i) ? <span key={i} className="attachment-unavailable" role="status">Image preview unavailable: {a.name}. Reload the conversation to try again.</span> : <button type="button" className="message-image-button" key={i} aria-label={`Open image: ${a.name}`} onClick={() => openImage(src, a.name)}><img className="message-image" src={src} alt={a.name} loading="lazy" onError={() => setFailedImages(previous => [...previous, i])}/><span>Open image</span></button> : <a className="file-chip" key={i} href={src} target="_blank" rel="noreferrer">{a.name}</a>;
    })}</div>
    <dialog ref={imageDialog} className="image-preview-dialog" aria-label={preview ? `Image: ${preview.name}` : 'Image preview'} onClick={event => { if (event.target === event.currentTarget) imageDialog.current?.close(); }} onClose={() => setPreview(null)}><div className="image-preview-toolbar"><span>{preview?.name}</span><button type="button" onClick={() => imageDialog.current?.close()} autoFocus>Close image</button></div>{preview ? <img src={preview.src} alt={preview.name}/> : null}</dialog>
    {!tool && !message.internal ? <details className="message-actions"><summary aria-label="Message actions" title="Message actions"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary><div>{onReply?<button onClick={()=>onReply(message)}>Reply in thread</button>:null}<button onClick={copy}>{copyState}</button><button onClick={download}>Download text</button><time dateTime={message.createdAt}>{timeLabel}</time>{message.modelRoutes?.map((r,i)=><p key={i}>Model: {r.model} · {r.specialty}{r.fallback?' · backup model':''}</p>)}</div></details> : null}
    {message.delivery === 'sending' || message.delivery === 'failed' ? <span className="message-delivery" role="status">{message.delivery === 'sending' ? 'Sending…' : 'Not confirmed'}</span> : null}
    {showTimestamp ? <time dateTime={message.createdAt}>{timeLabel}</time> : null}
  </article>;
}
