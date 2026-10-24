export enum BotStatus { ONLINE = 'online', IDLE = 'idle', WORKING = 'working', ERROR = 'error', OFFLINE = 'offline' }
export enum MessageType { TEXT = 'text', SYSTEM = 'status_update', TOOL_CALL = 'tool_call' }
export enum TaskStatus { RUNNING = 'running', COMPLETED = 'completed', FAILED = 'failed' }
export interface Bot { id: string; name: string; role: string; description?: string; avatar?: string; status: BotStatus; containerId?: string | null; llmProvider: string; llmModel: string; toolsEnabled: string[]; systemPrompt: string; defaultOptions?: Partial<RunOptions>; }
export interface Message { threadRootId?:string; replyToId?:string; delivery?: 'sending' | 'sent' | 'failed'; id: string; conversationId: string; senderType: string; senderBotId?: string; content: string; messageType: MessageType; createdAt: string; internal?: boolean; modelRoutes?: {provider:string;model:string;specialty:string;fallback:boolean}[]; attachments?: Attachment[]; }
export interface Task { id: string; conversationId: string; botId: string; title: string; description: string; status: TaskStatus; createdAt: string; steps: { id: string; description: string; completed: boolean }[]; }
export interface WebSocketMessage { type: string; payload: { channel?: string; botId?: string; status?: BotStatus }; }

export interface Attachment { name: string; mime: string; data: string; url?: string; }
export interface RunOptions { voice_mode?: boolean; routing?: 'auto' | 'manual'; allow_tools?: boolean; steering?: string; output?: 'text' | 'image'; aspect_ratio?: string; duration?: number; temperature: number; max_tokens: number; max_iterations: number; team_rounds: number; model?: string; provider?: string; reasoning_effort?: string; }
export interface Conversation { id: string; title: string; is_group: boolean; bot_ids: string[]; }
export interface Job { id: string; title: string; status: string; created_at: string; }
