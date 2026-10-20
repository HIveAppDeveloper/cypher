import { Bot, BotStatus, Message, MessageType } from './types';
const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}
interface BotResponse { id: string; name: string; role: string; description?: string; status: BotStatus; llm_provider: string; llm_model: string; tools_enabled: string[]; system_prompt: string; }
function botFromWire(b: BotResponse): Bot { return { ...b, llmProvider: b.llm_provider, llmModel: b.llm_model, toolsEnabled: b.tools_enabled, systemPrompt: b.system_prompt }; }
function botToWire(b: Partial<Bot>) { return { name: b.name, role: b.role, description: b.description, system_prompt: b.systemPrompt, llm_provider: b.llmProvider || 'gemini', llm_model: b.llmModel || 'gemini-2.5-flash', tools_enabled: b.toolsEnabled || [] }; }
interface MessageResponse { id: string; conversation_id: string; sender_type: string; sender_bot_id?: string; content: string; message_type: MessageType; created_at: string; }
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
  getMessages: async (id: string): Promise<Message[]> => (await request(`/conversations/${id}/messages`)).reverse().map((m: MessageResponse) => ({ id: m.id, conversationId: m.conversation_id, senderType: m.sender_type, senderBotId: m.sender_bot_id, content: m.content, messageType: m.message_type, createdAt: m.created_at })),
  sendMessage: (id: string, content: string) => request(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ sender_type: 'user', content }) }),
};
