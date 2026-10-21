import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Message } from '../lib/types';
const markdownPlugins = [remarkGfm];
const markdownComponents = {
  a: ({ children, href }: React.ComponentProps<'a'>) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }: React.ComponentProps<'img'>) => <span>{alt || 'Image'}</span>,
};
export function MessageBubble({ message, bot, grouped = false }: { message: Message; bot?: Bot; grouped?: boolean }) {
  const [copyState, setCopyState] = useState('Copy');
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [failedImages, setFailedImages] = useState<number[]>([]);
  const imageDialog = useRef<HTMLDialogElement>(null);
  function openImage(src: string, name: string) {
    setPreview({ src, name });
    imageDialog.current?.showModal();
  }
  async function copy() { try { await navigator.clipboard.writeText(message.content); setCopyState('Copied'); } catch { setCopyState('Copy unavailable'); } }
  function download() { const url=URL.createObjectURL(new Blob([message.content],{type:'text/plain'})); const link=document.createElement('a'); link.href=url; link.download='response.txt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  const tool = message.messageType === 'tool_call' || String(message.messageType) === 'tool_result';
  return <article className={`message ${message.senderType === 'user' ? 'outgoing' : 'incoming'} ${tool ? 'tool-message' : ''} ${grouped ? 'message-grouped' : ''}`}>
    {bot && !grouped ? <div className="message-sender">{bot.name}</div> : null}
    <div className="message-content">{tool ? <details><summary>{message.messageType === 'tool_call' ? 'Tool activity' : 'Tool result'}</summary><pre>{message.content}</pre></details> : message.senderType === 'bot' ? <div className="message-markdown"><ReactMarkdown remarkPlugins={markdownPlugins} skipHtml components={markdownComponents}>{message.content}</ReactMarkdown></div> : message.content}
    {message.attachments?.map((a,i) => {
      const src = a.url || (a.data ? `data:${a.mime};base64,${a.data}` : '');
      return a.mime.startsWith('video/') ? <video key={i} className="message-video" src={src} controls preload="metadata"/> : a.mime.startsWith('image/') ? failedImages.includes(i) ? <span key={i} className="attachment-unavailable" role="status">Image preview unavailable: {a.name}. Reload the conversation to try again.</span> : <button type="button" className="message-image-button" key={i} aria-label={`Open image: ${a.name}`} onClick={() => openImage(src, a.name)}><img className="message-image" src={src} alt={a.name} loading="lazy" onError={() => setFailedImages(previous => [...previous, i])}/><span>Open image</span></button> : <a className="file-chip" key={i} href={src} target="_blank" rel="noreferrer">{a.name}</a>;
    })}</div>
    <dialog ref={imageDialog} className="image-preview-dialog" aria-label={preview ? `Image: ${preview.name}` : 'Image preview'} onClick={event => { if (event.target === event.currentTarget) imageDialog.current?.close(); }} onClose={() => setPreview(null)}><div className="image-preview-toolbar"><span>{preview?.name}</span><button type="button" onClick={() => imageDialog.current?.close()} autoFocus>Close image</button></div>{preview ? <img src={preview.src} alt={preview.name}/> : null}</dialog>
    {message.senderType === 'bot' && !tool && !message.internal ? <details className="message-actions"><summary aria-label="Message actions">Options</summary><div><button onClick={copy}>{copyState}</button><button onClick={download}>Download text</button></div></details> : null}
    {message.delivery === 'sending' || message.delivery === 'failed' ? <span className="message-delivery" role="status">{message.delivery === 'sending' ? 'Sending…' : 'Not confirmed'}</span> : null}
    <time dateTime={message.createdAt}>{new Date(message.createdAt + (message.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time>
  </article>;
}
