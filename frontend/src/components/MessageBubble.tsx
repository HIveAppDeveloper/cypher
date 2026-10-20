import { Bot, Message } from '../lib/types';
export function MessageBubble({ message }: { message: Message; bot?: Bot }) {
  const tool = message.messageType === 'tool_call' || String(message.messageType) === 'tool_result';
  return <article className={`message ${message.senderType === 'user' ? 'outgoing' : 'incoming'} ${tool ? 'tool-message' : ''}`}><div className="message-content">{message.content}</div><time dateTime={message.createdAt}>{new Date(message.createdAt + (message.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></article>;
}
