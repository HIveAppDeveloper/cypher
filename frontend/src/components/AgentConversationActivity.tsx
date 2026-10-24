import type { Bot, Message } from '../lib/types';
import { agentActivity } from '../lib/agent-conversation';
import { BotAvatar } from './BotAvatar';
import { MessageBubble } from './MessageBubble';
import './agent-conversation-activity.css';

export { conversationMessages, isAgentActivityMessage } from '../lib/agent-conversation';

export function AgentConversationActivity({ message, bots }: { message: Message; bots: Bot[] }) {
  const activity = agentActivity(message, bots);
  if (!activity) return null;
  const timestamp = new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(message.createdAt) ? message.createdAt : message.createdAt + 'Z');
  const label = Number.isNaN(timestamp.getTime()) ? '' : timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const senderName = activity.sender?.name || 'Agent';
  if (activity.kind === 'reply') return activity.sender
    ? <div className="agent-conversation-reply"><MessageBubble message={message} bot={activity.sender} showTimestamp /></div>
    : <article className="message incoming message-group-end agent-unattributed-reply"><div className="message-sender-row"><span className="message-sender">Agent name unavailable</span></div><div className="message-content">{message.content}</div>{label ? <time dateTime={message.createdAt}>{label}</time> : null}</article>;
  if (activity.kind === 'tool') return <article className="agent-tool-event" data-failed={activity.failed || undefined} aria-label={activity.label}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-5 7 5 7m8-14 5 7-5 7m-3-16-2 18" /></svg>
    <div>{activity.sender ? <span>{senderName} · </span> : null}<strong>{activity.label}</strong>{activity.toolName ? <span className="agent-tool-name">{activity.toolName}</span> : null}</div>
    {label ? <time dateTime={message.createdAt}>{label}</time> : null}
  </article>;
  return <article className="message incoming message-group-end agent-handoff-message" aria-label={`${senderName} requested a handoff`}>
    <div className="message-sender-row"><BotAvatar name={senderName} small /><span className="message-sender">{senderName}</span>{label ? <time dateTime={message.createdAt}>{label}</time> : null}</div>
    <div className="message-content">{activity.introduction ? <p className="agent-handoff-introduction">{activity.introduction}</p> : null}
      {activity.assignments.map((assignment, index) => <div className="agent-assignment" key={index}><p className="agent-assignment-target">Requested help from <strong>{assignment.name}</strong></p><p>{assignment.task}</p></div>)}
    </div>
  </article>;
}
