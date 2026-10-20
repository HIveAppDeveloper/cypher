export const MODEL_CHOICES = [
 { id:'sol61',label:'GPT-6.1 Sol',detail:'OpenAI coordinator · reasoning and everyday work',provider:'openai',model:'gpt-6.1-sol' },
 { id:'luna6',label:'GPT-6 Luna',detail:'Quick, economical supporting work',provider:'openai',model:'gpt-6-luna' },
 { id:'astra6',label:'GPT-6 Astra',detail:'Complex reasoning and difficult tasks',provider:'openai',model:'gpt-6-astra' },
 { id:'sol6',label:'GPT-6 Sol',detail:'General work and coding',provider:'openai',model:'gpt-6-sol' },
 { id:'reasoning',label:'GPT-5.4 mini',detail:'Lower-cost reasoning',provider:'openai',model:'gpt-5.4-mini' },
 { id:'power',label:'GPT-5.4',detail:'Complex professional work',provider:'openai',model:'gpt-5.4' },
 { id:'efficient',label:'GPT-4.1 mini',detail:'Fast and economical',provider:'openai',model:'gpt-4.1-mini' },
 { id:'balanced',label:'Gemini 3.5 Flash',detail:'Fast multimodal specialist',provider:'gemini',model:'gemini-3.5-flash' },
 { id:'gemini-pro',label:'Gemini 3.1 Pro',detail:'Multimodal reasoning specialist',provider:'gemini',model:'gemini-3.1-pro-preview' },
 { id:'gemini25',label:'Gemini 2.5 Flash',detail:'Balanced everyday work',provider:'gemini',model:'gemini-2.5-flash' },
 { id:'writing',label:'Claude Sonnet 4.6',detail:'Writing and coding specialist',provider:'anthropic',model:'claude-sonnet-4.6' },
 { id:'opus',label:'Claude Opus 4.8',detail:'Detailed review and complex work',provider:'anthropic',model:'claude-opus-4.8' },
 { id:'deepseek',label:'DeepSeek V3.2',detail:'Alternative reasoning specialist',provider:'deepseek',model:'deepseek-v3.2' },
];
export const AGENT_PRESETS = [
  { id: 'assistant', name: 'Assistant', description: 'A capable all-rounder', prompt: 'Complete the user’s task using the available tools. Make reasonable decisions without routine clarification. Check your work and give a concise result. Never claim an action succeeded without evidence. Explain a blocker clearly when a required connection is unavailable.' },
  { id: 'research', name: 'Researcher', description: 'Find, compare, and explain', prompt: 'Research the user’s question using available browser tools. Verify important claims against primary sources, identify uncertainty, and deliver a concise, useful result with source URLs. Collaborate with teammates and hand off clear findings. Never invent sources or completed actions.' },
  { id: 'writer', name: 'Writer', description: 'Turn an idea into finished copy', prompt: 'Write polished, clear content for the user’s audience and purpose. Make sensible assumptions, keep the user’s voice, and deliver the finished work. Use teammate research, improve weak reasoning, and check accuracy. Never invent facts.' },
  { id: 'developer', name: 'Developer', description: 'Build, debug, and test', prompt: 'Build and debug software using the available shell, filesystem, and browser tools. Inspect the project first, implement complete changes, and test the behavior. Work autonomously on reversible actions. Report exactly what changed, what was verified, and any remaining blocker.' },
  { id: 'creative', name: 'Creative director', description: 'Shape concepts and creative briefs', prompt: 'Develop strong visual concepts, image prompts, video storyboards, and creative briefs. Turn broad requests into concrete deliverables. Collaborate with researchers and writers. Use the image and video generation tools to produce the actual requested assets. Never pretend media was generated when it was not.' },
];
