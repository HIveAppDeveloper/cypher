import { Bot, BotStatus, Message, MessageType, Attachment, RunOptions, Conversation, Job } from './types';
import { directConversation } from './conversations';
const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
export class ApiError extends Error { constructor(message:string,public status:number,public code?:string,public retryAfter=0,public details?:Record<string,unknown>){super(message);} }
export async function request(path: string, init?: RequestInit, timeout=35000) {
  const response = await fetch(`${API_URL}/api${path}`, { ...init, signal: init?.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) { const error = await response.json().catch(() => null); const detail = error?.detail; const fields=detail && typeof detail==='object' && !Array.isArray(detail)?detail:undefined; throw new ApiError(typeof detail === 'string' ? detail : typeof fields?.message==='string'?fields.message:Array.isArray(detail) ? detail.map((item: { msg?: string }) => item.msg || 'Invalid input').join('. ') : `Request failed (${response.status}). Try again.`,response.status,error?.code||fields?.code,Number(response.headers.get('Retry-After')||0),fields); }
  return response.json();
}
interface BotResponse { id: string; name: string; role: string; description?: string; status: BotStatus; container_id?: string | null; llm_provider: string; llm_model: string; tools_enabled: string[]; system_prompt: string; }
function botFromWire(b: BotResponse): Bot { return { ...b, containerId: b.container_id, llmProvider: b.llm_provider, llmModel: b.llm_model, toolsEnabled: b.tools_enabled, systemPrompt: b.system_prompt }; }
function botToWire(b: Partial<Bot>) { return { name: b.name, role: b.role, description: b.description, system_prompt: b.systemPrompt, llm_provider: b.llmProvider || 'openai', llm_model: b.llmModel || 'gpt-6.1-sol', tools_enabled: b.toolsEnabled || [] }; }
interface MessageResponse { id: string; conversation_id: string; sender_type: string; sender_bot_id?: string; content: string; message_type: MessageType; created_at: string; metadata_json?: { task_id?:string; internal?: boolean; thread_root_id?:string; reply_to_id?:string; model_routes?: Message['modelRoutes']; attachments?: Attachment[] }; }
function messageFromWire(m:MessageResponse):Message { return {id:m.id,taskId:m.metadata_json?.task_id,conversationId:m.conversation_id,senderType:m.sender_type,senderBotId:m.sender_bot_id,content:m.content,messageType:m.message_type,createdAt:m.created_at,internal:m.metadata_json?.internal,threadRootId:m.metadata_json?.thread_root_id,replyToId:m.metadata_json?.reply_to_id,modelRoutes:m.metadata_json?.model_routes,attachments:(m.metadata_json?.attachments||[]).map(a=>({...a,url:a.url?API_URL+a.url:undefined}))}; }
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
  getMcpDirectory: (params:{q?:string;category?:string;kind?:'all'|'hosted'|'local'|'verified'|'auth';offset?:number;limit?:number}={}): Promise<import('../components/McpDirectory').McpDirectoryPage> => {const query=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value!==undefined&&value!=='')query.set(key,String(value));const encoded=query.toString();return request('/plugins/directory'+(encoded?'?'+encoded:''));},
  getMcpDirectoryPreview: (id:string): Promise<import('../components/McpDirectory').McpToolPreview> => request('/plugins/directory/'+encodeURIComponent(id)+'/preview'),
  searchMcpRegistry: (query:string,cursor?:string): Promise<{items:import('../components/PluginPanel').CatalogEntry[];next_cursor:string|null}> => request('/plugins/registry/search?q='+encodeURIComponent(query)+(cursor?'&cursor='+encodeURIComponent(cursor):'')),
  getAvailableConnections: (): Promise<import('../components/PluginPanel').AvailableConnection[]> => request('/plugins/available-connections'),
  pluginSyncStatus: (): Promise<import('../components/PluginPanel').PluginSync|null> => request('/plugins/catalog/sync'),
  syncPlugins: (approval_id?:string): Promise<import('../components/PluginPanel').PluginSync> => request('/plugins/catalog/sync',{method:'POST',body:JSON.stringify({approval_id})}),
  resolvePlugin: (website:string): Promise<import('../components/PluginPanel').CatalogEntry> => request('/plugins/resolve',{method:'POST',body:JSON.stringify({website})}),
  authorizePlugin: (data:{name:string;url:string;approval_id?:string;reconnect?:boolean;connection_id?:string;oauth_client?:{client_id:string;client_secret?:string;scope?:string}}): Promise<{status:string;flow_id?:string;plugin_id?:string;authorization_url?:string;name:string}> => request('/plugins/authorize',{method:'POST',body:JSON.stringify(data)},65000),
  cancelPluginAuth: async (id:string) => { const response=await fetch('/api/plugin-oauth/callback?flow='+encodeURIComponent(id),{method:'DELETE'}); const data=await response.json(); if(!response.ok)throw new Error(data.detail||'Could not cancel sign-in.'); return data; },
  pluginAuthStatus: (id:string): Promise<{status:string;name:string;plugin_id?:string}> => request('/plugins/oauth/status/'+id),
  getPlugins: (): Promise<import('../components/PluginPanel').PluginConnection[]> => request('/plugins'),
  connectPlugin: (data: { name: string; url: string; token: string; auth_header?: string; approval_id?:string }): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins', { method: 'POST', body: JSON.stringify(data) }),
  testPlugin: (id: string) => request(`/plugins/${id}/test`, {method:'POST'}, 65000) as Promise<{status:string;message:string;tool?:string;latency_ms?:number}>,
  refreshPlugin: (id:string): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins/'+id+'/refresh',{method:'POST'}),
  setPluginTool: (id:string,name:string,enabled:boolean): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins/'+id+'/tools/'+encodeURIComponent(name),{method:'PATCH',body:JSON.stringify({enabled})}),
  togglePlugin: (id: string, enabled: boolean): Promise<import('../components/PluginPanel').PluginConnection> => request('/plugins/' + id, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  disconnectPlugin: (id: string) => request('/plugins/' + id, { method: 'DELETE' }),
  cancelJob: (conversation: string, id: string) => request(`/conversations/${conversation}/tasks/${id}/cancel`, { method: 'POST' }),
  getContext: (id:string) => request(`/conversations/${id}/context`),
  saveContext: (id:string,note:{name:string;kind:string;content:string}) => request(`/conversations/${id}/context`,{method:'POST',body:JSON.stringify(note)}),
  deleteContext: (id:string,note:string) => request(`/conversations/${id}/context/${note}`,{method:'DELETE'}),
  getBots: async (): Promise<Bot[]> => (await request('/bots')).map(botFromWire),
  createBot: async (b: Partial<Bot>, clientRequestId?: string): Promise<Bot> => botFromWire(await request('/bots', { method: 'POST', body: JSON.stringify({ ...botToWire(b), client_request_id: clientRequestId }) })),
  updateBot: async (id: string, b: Partial<Bot>): Promise<Bot> => botFromWire(await request(`/bots/${id}`, { method: 'PUT', body: JSON.stringify(botToWire(b)) })),
  deleteBot: (id: string) => request(`/bots/${id}`, { method: 'DELETE' }),
  startBot: (id: string) => request(`/bots/${id}/start`, { method: 'POST' }),
  steerJob: (id: string, taskId: string, instruction: string) => request(`/conversations/${id}/tasks/${taskId}/steer`, { method:'POST', body:JSON.stringify({instruction}) }),
  stopBot: (id: string) => request(`/bots/${id}/stop`, { method: 'POST' }),
  conversationForBot: async (bot: Bot): Promise<string> => {
    const conversations: Conversation[] = await request('/conversations');
    const title = `Bot ${bot.id}`;
    const existing = directConversation(conversations,bot.id);
    if (existing) return existing.id;
    return (await request('/conversations', { method: 'POST', body: JSON.stringify({ title, bot_ids: [bot.id] }) })).id;
  },
  syncConversation: async (id:string,after?:string,signal?:AbortSignal): Promise<{messages:Message[];tasks:Job[]}> => { const data=await request(`/conversations/${id}/sync${after?'?after_id='+encodeURIComponent(after):''}`,{signal});return {messages:data.messages.reverse().map(messageFromWire),tasks:data.tasks}; },
  getTranscript: (conversation: string, messageId: string, signal?: AbortSignal): Promise<{status:'pending'|'ready'|'unavailable';text:string}> => request(`/conversations/${conversation}/messages/${messageId}/transcript`, {signal}),
  getMessages: async (id:string,before?:string): Promise<Message[]> => (await request(`/conversations/${id}/messages${before ? `?before_id=${encodeURIComponent(before)}` : ''}`)).reverse().map(messageFromWire),
  sendMessage: (id: string, content: string, attachments: Attachment[], options: RunOptions, client_message_id?: string,reply_to_id?:string) => request(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ sender_type: 'user', content, attachments, options, client_message_id,reply_to_id }) }),
  getConversations: (): Promise<Conversation[]> => request('/conversations'),
  createRoom: (title: string, bot_ids: string[]): Promise<Conversation> => request('/conversations', { method: 'POST', body: JSON.stringify({ title, bot_ids, is_group: true }) }),
  getJobs: (id: string): Promise<Job[]> => request(`/conversations/${id}/tasks`),
};
