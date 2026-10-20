import { Bot, Message } from '../lib/types';
export function MessageBubble({ message, bot }: { message: Message; bot?: Bot }) {
  const tool = message.messageType === 'tool_call' || String(message.messageType) === 'tool_result';
  return <article className={`message ${message.senderType === 'user' ? 'outgoing' : 'incoming'} ${tool ? 'tool-message' : ''}`}>
    {bot ? <div className="message-sender">{bot.name}</div> : null}
    <div className="message-content">{tool ? <details><summary>{message.messageType === 'tool_call' ? 'Tool activity' : 'Tool result'}</summary><pre>{message.content}</pre></details> : message.content}
    {message.attachments?.map((a,i) => a.mime.startsWith('video/') ? <video key={i} className="message-video" src={a.url} controls preload="metadata"/> : a.mime.startsWith('image/') ? <img className="message-image" key={i} src={a.url || `data:${a.mime};base64,${a.data}`} alt={a.name}/> : <a className="file-chip" key={i} href={a.url} target="_blank" rel="noreferrer">{a.name}</a>)}</div>
    <time dateTime={message.createdAt}>{new Date(message.createdAt + (message.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time>
  </article>;
}
