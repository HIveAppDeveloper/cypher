import type { Bot, Message } from './types';

type Assignment = { name: string; task: string };
export type AgentActivity =
  | { kind: 'reply'; sender: Bot | undefined }
  | { kind: 'handoff'; sender: Bot | undefined; introduction: string; assignments: Assignment[] }
  | { kind: 'tool'; sender: Bot | undefined; label: string; toolName?: string; failed: boolean };

export function agentActivity(message: Message, bots: Bot[]): AgentActivity | null {
  const type = String(message.messageType);
  const sender = bots.find(bot => bot.id === message.senderBotId);
  if (type === 'tool_call') {
    const name = /^Calling tool: ([a-zA-Z_][\w.-]{0,119})$/.exec(message.content)?.[1];
    return { kind: 'tool', sender, label: 'Tool requested', toolName: name, failed: false };
  }
  if (type === 'tool_result') {
    let label = 'Tool result recorded', failed = false;
    // Read only outcome flags. Arguments, results and provider errors stay hidden.
    if (message.content.length <= 20000) {
      try {
        const result = JSON.parse(message.content);
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          if (result.error || result.success === false) { label = 'Tool reported an error'; failed = true; }
          else if (result.success === true) label = 'Tool reported success';
          else if (result.skipped) label = 'Tool skipped';
        }
      } catch { /* A recorded result need not be JSON; never print its payload. */ }
    }
    return { kind: 'tool', sender, label, failed };
  }
  if (message.senderType !== 'bot') return null;
  if (type === 'handoff') {
    // Same bounded saved-message syntax used by the coordinator parser.
    const pattern = /HANDOFF\[([^:\]\n]{1,100}):\s*([^\]]{1,4000})\]/gi;
    const assignments: Assignment[] = [];
    for (const match of Array.from(message.content.matchAll(pattern))) {
      const name = match[1].trim(), task = match[2].trim();
      if (name && task) assignments.push({ name, task });
    }
    if (!assignments.length) return null;
    return { kind: 'handoff', sender, assignments, introduction: message.content.replace(pattern, '').trim() };
  }
  if (message.internal && type === 'text' && message.content.trim()) return { kind: 'reply', sender };
  return null;
}

export function isAgentActivityMessage(message: Message): boolean {
  return !!message.internal || ['handoff', 'tool_call', 'tool_result'].includes(String(message.messageType));
}

export function conversationMessages(messages: Message[], bots: Bot[], group: boolean, query = ''): Message[] {
  const search = query.trim().toLocaleLowerCase();
  return messages.filter(message => {
    if (!isAgentActivityMessage(message)) return !search || message.content.toLocaleLowerCase().includes(search);
    if (!group) return false;
    const activity = agentActivity(message, bots);
    if (!activity) return false; // Hidden reasoning, debug and unknown internal events stay hidden.
    const text = activity.kind === 'tool' ? `${activity.sender?.name || ''} ${activity.label} ${activity.toolName || ''}`
      : activity.kind === 'handoff' ? `${activity.sender?.name || ''} ${activity.introduction} ${activity.assignments.map(item => `${item.name} ${item.task}`).join(' ')}`
        : `${activity.sender?.name || ''} ${message.content}`;
    return !search || text.toLocaleLowerCase().includes(search);
  });
}
