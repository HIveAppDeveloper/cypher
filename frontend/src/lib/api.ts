import { Bot, BotStatus, Message, MessageType, Attachment, RunOptions, Conversation, Job } from './types';
const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
async function request(path: string, init?: RequestInit, timeout=35000) {
  const response = await fetch(`${API_URL}/api${path}`, { ...init, signal: AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) { const error = await response.json().catch(() => null); const detail = error?.detail; throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((item: { msg?: string }) => item.msg || 'Invalid input').join('. ') : `Request failed (${response.status}). Try again.`); }
  return response.json();
}
interface BotResponse { id: string; name: string; role: string; description?: string; status: BotStatus; llm_provider: string; llm_model: string; tools_enabled: string[]; system_prompt: string; }
function botFromWire(b: BotResponse): Bot { return { ...b, llmProvider: b.llm_provider, llmModel: b.llm_model, toolsEnabled: b.tools_enabled, systemPrompt: b.system_prompt }; }
function botToWire(b: Partial<Bot>) { return { name: b.name, role: b.role, description: b.description, system_prompt: b.systemPrompt, llm_provider: b.llmProvider || 'openai', llm_model: b.llmModel || 'gpt-6.1-sol', tools_enabled: b.toolsEnabled || [] }; }
interface MessageResponse { id: string; conversation_id: string; sender_type: string; sender_bot_id?: string; content: string; message_type: MessageType; created_at: string; metadata_json?: { internal?: boolean; attachments?: Attachment[] }; }
export const api = {
  accountStatus: () => request('/accounts/status'),
  deviceStatus: () => request('/device/status'),
  deviceChallenge: (purpose:string) => request('/device/challenge',{method:'POST',body:JSON.stringify({purpose})}),
  deviceVerify: (challenge_id:string,credential:unknown) => request('/device/verify',{method:'POST',body:JSON.stringify({challenge_id,credential})}),
  setupPluginAccount: (data:unknown) => request('/plugins/account-setup',{method:'POST',body:JSON.stringify(data)}),
  getGoals: (): Promise<import('../components/GoalsPanel').Goal[]> => request('/goals'),
  createGoal: (data: unknown): Promise<import('../components/GoalsPanel').Goal> => request('/goals',{method:'POST',body:JSON.stringify(data)}),
  setGoalState: (id:string,status:string): Promise<import('../components/GoalsPanel').Goal> => request('/goals/'+id,{method:'PATCH',body:JSON.stringify({status})}),
  getChannels: (): Promise<import('../components/ChannelsPanel').Channel[]> => request('/channels'),
  createChannel: (data: unknown): Promise<import('../components/ChannelsPanel').Channel & {token:string;inbound_path:string}> => request('/channels',{method:'POST',body:JSON.stringify(data)}),
  setChannelState: (id:string,enabled:boolean): Promise<import('../components/ChannelsPanel').Channel> => request('/channels/'+id,{method:'PATCH',body:JSON.stringify({enabled})}),
  testChannel: (id:string) => request('/channels/'+id+'/test',{method:'POST'}),
  getDeliveries: (id:string): Promise<{id:string;status:string;attempts:number;detail:string}[]> => request('/channels/'+id+'/deliveries'),
  defaultTeam: (): Promise<Conversation> => request('/teams/default', { method: 'POST' }),
  getPluginCatalog: (): Promise<import('../components/PluginPanel').CatalogEntry[]> => request('/plugins/catalog'),
  resolvePlugin: (website:string): Promise<import('../components/PluginPanel').CatalogEntry> => request('/plugins/resolve',{method:'POST',body:JSON.stringify({website})}),
  authorizePlugin: (data:{name:string;url:string;approval_id?:string;reconnect?:boolean}): Promise<{status:string;flow_id?:string;authorization_url?:string;name:string}> => request('/plugins/authorize',{method:'POST',body:JSON.stringify(data)},65000),
  cancelPluginAuth: async (id:string) => { const response=await fetch('/api/plugin-oauth/callback?flow='+encodeURIComponent(id),{method:'DELETE'}); const data=await response.json(); if(!response.ok)throw new Error(data.detail||'Could not cancel sign-in.'); return data; },
  pluginAuthStatus: (id:string): Promise<{status:string;name:string}> => request('/plugins/oauth/status/'+id),
  getPlugins: (): Promise<import('../components/PluginPanel').PluginConnection[]> => request('/plugins'),
  connectPlugin: (data: { name: string; url: string; token: string; approval_id?:string }): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins', { method: 'POST', body: JSON.stringify(data) }),
  refreshPlugin: (id:string): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins/'+id+'/refresh',{method:'POST'}),
  setPluginTool: (id:string,name:string,enabled:boolean): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins/'+id+'/tools/'+encodeURIComponent(name),{method:'PATCH',body:JSON.stringify({enabled})}),
  togglePlugin: (id: string, enabled: boolean): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins/' + id, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  disconnectPlugin: (id: string) => request('/plugins/' + id, { method: 'DELETE' }),
  cancelJob: (conversation: string, id: string) => request(`/conversations/${conversation}/tasks/${id}/cancel`, { method: 'POST' }),
  getContext: (id:string) => request(`/conversations/${id}/context`),
  saveContext: (id:string,note:{name:string;kind:string;content:string}) => request(`/conversations/${id}/context`,{method:'POST',body:JSON.stringify(note)}),
  deleteContext: (id:string,note:string) => request(`/conversations/${id}/context/${note}`,{method:'DELETE'}),
  getBots: async (): Promise<Bot[]> => (await request('/bots')).map(botFromWire),
  createBot: async (b: Partial<Bot>): Promise<Bot> => botFromWire(await request('/bots', { method: 'POST', body: JSON.stringify(botToWire(b)) })),
  updateBot: async (id: string, b: Partial<Bot>): Promise<Bot> => botFromWire(await request(`/bots/${id}`, { method: 'PUT', body: JSON.stringify(botToWire(b)) })),
  deleteBot: (id: string) => request(`/bots/${id}`, { method: 'DELETE' }),
  startBot: (id: string) => request(`/bots/${id}/start`, { method: 'POST' }),
  steerJob: (id: string, taskId: string, instruction: string) => request(`/conversations/${id}/tasks/${taskId}/steer`, { method:'POST', body:JSON.stringify({instruction}) }),
  stopBot: (id: string) => request(`/bots/${id}/stop`, { method: 'POST' }),
  conversationForBot: async (bot: Bot): Promise<string> => {
    const conversations: { id: string; title: string }[] = await request('/conversations');
    const title = `Bot ${bot.id}`;
    const existing = conversations.find(c => c.title === title);
    if (existing) return existing.id;
    return (await request('/conversations', { method: 'POST', body: JSON.stringify({ title, bot_ids: [bot.id] }) })).id;
  },
  getMessages: async (id: string, before?: string): Promise<Message[]> => (await request(`/conversations/${id}/messages${before ? `?before_id=${encodeURIComponent(before)}` : ''}`)).reverse().map((m: MessageResponse) => ({ id: m.id, conversationId: m.conversation_id, senderType: m.sender_type, senderBotId: m.sender_bot_id, content: m.content, messageType: m.message_type, createdAt: m.created_at, internal: m.metadata_json?.internal, attachments: (m.metadata_json?.attachments || []).map(a => ({ ...a, url: a.url ? API_URL + a.url : undefined })) })),
  sendMessage: (id: string, content: string, attachments: Attachment[], options: RunOptions, client_message_id?: string) => request(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ sender_type: 'user', content, attachments, options, client_message_id }) }),
  getConversations: (): Promise<Conversation[]> => request('/conversations'),
  createRoom: (title: string, bot_ids: string[]): Promise<Conversation> => request('/conversations', { method: 'POST', body: JSON.stringify({ title, bot_ids, is_group: true }) }),
  getJobs: (id: string): Promise<Job[]> => request(`/conversations/${id}/tasks`),
};
