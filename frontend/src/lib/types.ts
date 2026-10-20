export enum BotStatus { ONLINE = 'online', IDLE = 'idle', WORKING = 'working', ERROR = 'error', OFFLINE = 'offline' }
export enum MessageType { TEXT = 'text', SYSTEM = 'status_update', TOOL_CALL = 'tool_call' }
export enum TaskStatus { RUNNING = 'running', COMPLETED = 'completed', FAILED = 'failed' }
export interface Bot { id: string; name: string; role: string; description?: string; avatar?: string; status: BotStatus; llmProvider: string; llmModel: string; toolsEnabled: string[]; systemPrompt: string; }
export interface Message { id: string; conversationId: string; senderType: string; senderBotId?: string; content: string; messageType: MessageType; createdAt: string; }
export interface Task { id: string; conversationId: string; botId: string; title: string; description: string; status: TaskStatus; createdAt: string; steps: { id: string; description: string; completed: boolean }[]; }
export interface WebSocketMessage { type: string; payload: { channel?: string; botId?: string; status?: BotStatus }; }
