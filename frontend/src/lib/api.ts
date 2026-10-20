import { Bot, BotStatus, Message, MessageType, Attachment, RunOptions, Conversation, Job } from './types';
const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) { const error = await response.json().catch(() => null); const detail = error?.detail; throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((item: { msg?: string }) => item.msg || 'Invalid input').join('. ') : `Request failed (${response.status}). Try again.`); }
  return response.json();
}
interface BotResponse { id: string; name: string; role: string; description?: string; status: BotStatus; llm_provider: string; llm_model: string; tools_enabled: string[]; system_prompt: string; }
function botFromWire(b: BotResponse): Bot { return { ...b, llmProvider: b.llm_provider, llmModel: b.llm_model, toolsEnabled: b.tools_enabled, systemPrompt: b.system_prompt }; }
function botToWire(b: Partial<Bot>) { return { name: b.name, role: b.role, description: b.description, system_prompt: b.systemPrompt, llm_provider: b.llmProvider || 'gemini', llm_model: b.llmModel || 'gemini-2.5-flash', tools_enabled: b.toolsEnabled || [] }; }
interface MessageResponse { id: string; conversation_id: string; sender_type: string; sender_bot_id?: string; content: string; message_type: MessageType; created_at: string; metadata_json?: { attachments?: Attachment[] }; }
export const api = {
  getBots: async (): Promise<Bot[]> => (await request('/bots')).map(botFromWire),
  createBot: async (b: Partial<Bot>): Promise<Bot> => botFromWire(await request('/bots', { method: 'POST', body: JSON.stringify(botToWire(b)) })),
  updateBot: async (id: string, b: Partial<Bot>): Promise<Bot> => botFromWire(await request(`/bots/${id}`, { method: 'PUT', body: JSON.stringify(botToWire(b)) })),
  deleteBot: (id: string) => request(`/bots/${id}`, { method: 'DELETE' }),
  startBot: (id: string) => request(`/bots/${id}/start`, { method: 'POST' }),
  conversationForBot: async (bot: Bot): Promise<string> => {
    const conversations: { id: string; title: string }[] = await request('/conversations');
    const title = `Bot ${bot.id}`;
    const existing = conversations.find(c => c.title === title);
    if (existing) return existing.id;
    return (await request('/conversations', { method: 'POST', body: JSON.stringify({ title, bot_ids: [bot.id] }) })).id;
  },
  getMessages: async (id: string, before?: string): Promise<Message[]> => (await request(`/conversations/${id}/messages${before ? `?before_id=${encodeURIComponent(before)}` : ''}`)).reverse().map((m: MessageResponse) => ({ id: m.id, conversationId: m.conversation_id, senderType: m.sender_type, senderBotId: m.sender_bot_id, content: m.content, messageType: m.message_type, createdAt: m.created_at, attachments: (m.metadata_json?.attachments || []).map(a => ({ ...a, url: a.url ? API_URL + a.url : undefined })) })),
  sendMessage: (id: string, content: string, attachments: Attachment[], options: RunOptions) => request(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ sender_type: 'user', content, attachments, options }) }),
  getConversations: (): Promise<Conversation[]> => request('/conversations'),
  createRoom: (title: string, bot_ids: string[]): Promise<Conversation> => request('/conversations', { method: 'POST', body: JSON.stringify({ title, bot_ids, is_group: true }) }),
  getJobs: (id: string): Promise<Job[]> => request(`/conversations/${id}/tasks`),
};
