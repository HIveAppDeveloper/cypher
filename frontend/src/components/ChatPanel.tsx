import { ContextPanel } from './ContextPanel';
import { SteeringPanel } from './SteeringPanel';
import { GlassSelect } from './GlassSelect';
import React, { useEffect, useState, useRef } from 'react';
import { Bot, Message, MessageType, Attachment, Conversation, Job, RunOptions } from '../lib/types';
import { api } from '../lib/api';
import { BotAvatar } from './BotAvatar';
import { MessageBubble } from './MessageBubble';
import { QuickStart } from './QuickStart';
import { RunControls, DEFAULT_OPTIONS } from './RunControls';
import { modelPolicy } from '../lib/modelPolicy';
import { readAttachment } from '../lib/attachments';
const POLL_MS = 1500;
const MAX_BYTES = 3 * 1024 * 1024;
export function ChatPanel({ bot, room, bots, onCreateBot, onCreateRoom, onQuickStart, onOpenLounge }: { bot: Bot | null; room: Conversation | null; bots: Bot[]; onCreateBot: () => void; onCreateRoom: () => void; onQuickStart: (prompt: string, options: Partial<import('../lib/types').RunOptions>) => Promise<void>; onOpenLounge: () => Promise<Conversation> }) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [readingFiles,setReadingFiles]=useState(false);
  const [draggingFiles,setDraggingFiles]=useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const unconfirmedDraft = useRef<{id:string;text:string;files:Attachment[]} | null>(null);
  const [computerBotId, setComputerBotId] = useState<string | null>(null);
  const [computerBusy, setComputerBusy] = useState(false);
  const [computerError, setComputerError] = useState('');
  const [options, setOptions] = useState<RunOptions>(() => ({ ...DEFAULT_OPTIONS, provider: 'openai', model: 'gpt-6.1-sol', ...bot?.defaultOptions }));
  const [optionsRestored, setOptionsRestored] = useState(false);
  useEffect(() => {
    try { setOptions({ ...DEFAULT_OPTIONS, provider: 'openai', model: localStorage.getItem('grokbot-manager') === 'gpt-6-luna' ? 'gpt-6-luna' : 'gpt-6.1-sol', ...bot?.defaultOptions, ...modelPolicy(JSON.parse(localStorage.getItem('grokbot-options-' + bot?.id) || '{}')) }); }
    catch { /* Keep the deterministic defaults when browser storage is unavailable. */ }
    setOptionsRestored(true);
  }, [bot?.id]);
  useEffect(() => { if (optionsRestored && bot) { try { localStorage.setItem('grokbot-options-' + bot.id, JSON.stringify(options)); } catch {} } }, [options, bot?.id, optionsRestored]);
  const [font, setFont] = useState('inter');
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const prependOffset = useRef<number | null>(null);
  const firstPage = useRef(true);
  const stream = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const followLatest = useRef(true);
  const title = room?.title === 'Agent lounge' ? 'Your team' : room?.title || bot?.name || 'Workspace';
  useEffect(() => { const el = stream.current; if (!el) return; if (prependOffset.current !== null) { el.scrollTop = el.scrollHeight - prependOffset.current; prependOffset.current = null; } else if (followLatest.current) el.scrollTop = el.scrollHeight; }, [messages.length, messages[messages.length - 1]?.id]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    followLatest.current = true; setConversationId(''); setMessages([]); setJobs([]); setAttachments([]); setError('');
    if (!bot && !room) return;
    const poll = async (id: string) => {
      try { const [data, tasks] = await Promise.all([api.getMessages(id), api.getJobs(id)]); if (active) { if (firstPage.current) { setHasEarlier(data.length === 50); firstPage.current = false; } setMessages(previous => mergeMessages(previous, data)); setJobs(tasks); } }
      catch (e) { if (active) setError(String(e)); }
      if (active) timer = setTimeout(() => poll(id), POLL_MS);
    };
    const load = room ? Promise.resolve(room.id) : api.conversationForBot(bot!);
    load.then(id => { if (active) { setConversationId(id); void poll(id); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; clearTimeout(timer); };
  }, [bot?.id, room?.id]);
  function mergeMessages(previous: Message[], incoming: Message[]) {
    const map = new Map(previous.map(message => [message.id, message])); incoming.forEach(message => map.set(message.id, {...message,delivery:message.delivery || 'sent'}));
    return Array.from(map.values()).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async function loadEarlier() {
    if (!conversationId || !messages.length || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const older = await api.getMessages(conversationId, messages[0].id);
      if (stream.current) prependOffset.current = stream.current.scrollHeight - stream.current.scrollTop;
      followLatest.current = false;
      setMessages(previous => mergeMessages(previous, older)); setHasEarlier(older.length === 50);
    } catch (e) { setError(String(e)); } finally { setLoadingEarlier(false); }
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(''); setReadingFiles(true);
    try {
      const list = Array.from(files);
      if (attachments.length + list.length > 4) throw new Error('Attach up to four files per message.');
      const existingBytes = attachments.reduce((sum, a) => sum + Math.floor(a.data.length * .75), 0);
      if (existingBytes + list.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) throw new Error('Keep combined attachments below 3 MB.');
      const allowed = ['image/png','image/jpeg','image/webp','application/pdf','text/plain','audio/wav','audio/mpeg'];
      const loaded = await Promise.all(list.map(file => {
        const extensions:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',md:'text/plain',csv:'text/plain',json:'text/plain',wav:'audio/wav',mp3:'audio/mpeg'};
        const mime=allowed.includes(file.type)?file.type:extensions[file.name.split('.').pop()?.toLowerCase()||''];
        if (!mime) throw new Error(`${file.name}: use PNG, JPEG, WebP, PDF, text, MP3, or WAV.`);
        return readAttachment(file, mime);
      }));
      setAttachments(prev => [...prev, ...loaded]);
      setOptions(current=>({...current,output:'text'}));
    } catch (e) { setError(String(e)); }
    finally { setReadingFiles(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function toggleComputer() {
    if (!bot || computerBusy) return;
    const id = bot.id;
    setComputerBusy(true); setComputerError('');
    try {
      if (computerBotId === id) { await api.stopBot(id); setComputerBotId(null); }
      else { await api.startBot(id); setComputerBotId(id); }
    } catch (e) { setComputerError(e instanceof Error ? e.message : String(e)); }
    finally { setComputerBusy(false); }
  }
  async function send() {
    if ((!input.trim() && !attachments.length) || !conversationId || readingFiles || sendingRef.current) return;
    sendingRef.current = true;
    const text = input;
    const files = attachments;
    const previousDraft=unconfirmedDraft.current;
    const messageId=previousDraft?.text===text && JSON.stringify(previousDraft.files)===JSON.stringify(files)?previousDraft.id:crypto.randomUUID();
    followLatest.current = true;
    setSending(true); setError(''); setInput(''); setAttachments([]);
    const composerInput=document.getElementById("message"); if(composerInput)composerInput.style.height="auto";
    setMessages(previous => mergeMessages(previous, [{id:messageId,conversationId,senderType:'user',content:text,messageType:MessageType.TEXT,createdAt:new Date().toISOString(),attachments:files,delivery:'sending'}]));
    try {
      const accepted = await api.sendMessage(conversationId, text, files, options, messageId);
      unconfirmedDraft.current=null;
      setMessages(previous=>previous.map(message=>message.id===messageId?{...message,delivery:'sent'}:message));
      setJobs(previous=>previous.some(job=>job.id===accepted.task_id)?previous:[{id:accepted.task_id,title:text.slice(0,100),status:'pending',created_at:new Date().toISOString()},...previous]);
    } catch (e) {
      unconfirmedDraft.current={id:messageId,text,files};
      setMessages(previous=>previous.map(message=>message.id===messageId?{...message,delivery:'failed'}:message));
      setInput(current=>current || text);setAttachments(current=>current.length?current:files);
      setError(`Message was not confirmed. ${String(e).replace(/^Error: /,'')} Your message is kept in this thread; resend from the composer to retry.`);
    } finally { sendingRef.current=false;setSending(false); }
  }
  const visibleMessages = messages.filter(m => !m.internal);
  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running' || j.status === 'cancel_requested');
  const fontFamily = font === 'serif' ? 'Georgia, serif' : font === 'system' ? 'system-ui, sans-serif' : '"Inter Variable", sans-serif';
  return <main className={`main-content ${draggingFiles ? 'files-dragging' : ''}`} style={{ fontFamily }} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDraggingFiles(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDraggingFiles(false);}} onDrop={e=>{e.preventDefault();setDraggingFiles(false);if(!readingFiles)void addFiles(e.dataTransfer.files);}}>
    {draggingFiles?<div className="file-drop-hint">Drop files into this conversation</div>:null}
    <header className="workspace-toolbar"><span className="workspace-context">{room ? 'Team thread' : bot ? 'Direct message' : 'Your workspace'}</span><details className="thread-settings"><summary>Settings</summary><div className="thread-settings-sheet"><h2>Conversation settings</h2><RunControls options={options} onChange={setOptions} font={font} onFont={setFont} group={!!room} model={bot ? { provider: bot.llmProvider, model: bot.llmModel } : undefined}/>    {jobs.length ? <details className="job-tray"><summary>{activeJobs.length ? `${activeJobs.length} job${activeJobs.length === 1 ? '' : 's'} in progress` : 'Recent work'}</summary>{jobs.slice(0,6).map(job => <div key={job.id}><span>{job.title}</span><strong data-status={job.status}>{job.status === 'cancel_requested' ? 'Stopping…' : job.status}</strong>{['pending','running'].includes(job.status) ? <button aria-label={`Cancel ${job.title}`} onClick={() => api.cancelJob(conversationId, job.id).catch(e => setError(e.message))}>Cancel</button> : null}</div>)}</details> : null}
    {conversationId ? <ContextPanel key={'context-'+conversationId} conversationId={conversationId}/> : null}
    {conversationId ? <SteeringPanel key={conversationId} conversationId={conversationId} jobs={jobs} options={options} onChange={setOptions}/> : null}
    <details className="thread-options"><summary>Message options <span>{options.output === 'video' ? 'Video' : options.output === 'image' ? 'Image' : 'Automatic'} · {options.model === 'gpt-6-luna' ? 'Luna' : 'Sol'}</span></summary><div className="output-controls"><label>Manager<GlassSelect aria-label="Manager model" value={options.model || bot?.llmModel || 'gpt-6.1-sol'} onChange={e => { setOptions({...options,provider:'openai',model:e.target.value}); try { localStorage.setItem('grokbot-manager',e.target.value); } catch {} }}><option value="gpt-6.1-sol">GPT-6.1 Sol</option><option value="gpt-6-luna">GPT-6 Luna</option></GlassSelect></label><label>Output<GlassSelect aria-label="Output type" value={options.output || 'text'} onChange={e => setOptions({ ...options, output: e.target.value as 'text' | 'image' | 'video', aspect_ratio: '16:9' })}><option value="text">Automatic</option><option value="image">Create an image</option><option value="video">Create a video</option></GlassSelect></label>{options.output && options.output !== 'text' ? <><label>Shape<GlassSelect aria-label="Media shape" value={options.aspect_ratio || '16:9'} onChange={e => setOptions({ ...options, aspect_ratio: e.target.value })}><option value="16:9">Landscape</option><option value="9:16">Portrait</option>{options.output === 'image' ? <option value="1:1">Square</option> : null}</GlassSelect></label>{options.output === 'video' ? <label>Length<GlassSelect aria-label="Video length" value={options.duration || 4} onChange={e => setOptions({ ...options, duration: +e.target.value })}><option value="4">4 seconds</option><option value="6">6 seconds</option><option value="8">8 seconds</option></GlassSelect></label> : null}<span className="media-cost-note">Uses generation credits</span></> : null}</div></details>
</div></details></header>
    {!bot && !room ? <QuickStart options={options} onOptions={setOptions} onStart={onQuickStart} onCreateBot={onCreateBot} onCreateRoom={onCreateRoom} onOpenLounge={onOpenLounge}/> : <>
    <header className="chat-header"><div className="thread-identity"><span className="identity-pill"><BotAvatar name={title} small/>{title}</span><span className="thread-subtitle">{room ? 'One conversation. Shared context.' : 'Tasks, updates, and finished work.'}</span></div>{bot ? <div className="computer-controls">{computerBotId === bot.id ? <span role="status">Computer connected</span> : null}<button className="sandbox-button" disabled={computerBusy} onClick={() => void toggleComputer()}>{computerBusy ? 'Connecting…' : computerBotId === bot.id ? 'Stop computer' : 'Start computer'}</button></div> : null}</header>
    {room ? <details className="thread-members"><summary>{room.bot_ids.length} teammates</summary><div className="team-members">{bots.filter(b => room.bot_ids.includes(b.id)).map(b => <span key={b.id} title={`${b.llmProvider} · ${b.llmModel}`}><BotAvatar name={b.name} small/>{b.name}</span>)}</div></details> : null}
    {computerError ? <p role="alert">{computerError}</p> : null}
    {error ? <p role="alert">{error.replace(/^Error: /, '')}</p> : null}
    <div ref={stream} onScroll={() => { const el = stream.current; if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="message-stream" style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column' }}>{hasEarlier ? <button className="load-earlier" disabled={loadingEarlier} onClick={loadEarlier}>{loadingEarlier ? 'Loading…' : 'Load earlier messages'}</button> : null}{messages.some(m => m.internal) ? <details className="fleet-activity"><summary>Background activity</summary>{messages.filter(m => m.internal).map(m => <MessageBubble key={m.id} message={m} bot={bots.find(b => b.id === m.senderBotId)}/>)}</details> : null}{visibleMessages.map((m,index) => { const previous=visibleMessages[index-1]; const grouped=!!previous && previous.senderType===m.senderType && previous.senderBotId===m.senderBotId && new Date(m.createdAt).getTime()-new Date(previous.createdAt).getTime()<300000; return <MessageBubble key={m.id} message={m} grouped={grouped} bot={bots.find(b => b.id === m.senderBotId)}/>; })}{!visibleMessages.length ? <div className="conversation-empty"><strong>{room ? 'What should we take care of?' : 'What should I take care of?'}</strong><p>Send the outcome you want, or drop in a file.</p><span>Work continues in the cloud when you close this tab.</span></div> : null}{activeJobs.length ? <div className="thread-working" role="status"><BotAvatar name={title} small/><span>{activeJobs.some(j=>j.status==='running') ? `${room ? 'Your team' : title} is working` : activeJobs.some(j=>j.status==='cancel_requested') ? 'Stopping work' : 'Message queued'}<small>{activeJobs.length > 1 ? `${activeJobs.length} tasks in progress` : 'The result will arrive here.'}</small></span></div> : null}</div>
    {attachments.length ? <div className="attachment-tray">{attachments.map((a,i) => <span key={`${a.name}-${i}`}>{a.mime.startsWith('image/') ? <img src={`data:${a.mime};base64,${a.data}`} alt=""/> : null}{a.name}<button aria-label={`Remove ${a.name}`} onClick={() => setAttachments(prev => prev.filter((_,index) => index !== i))}>Remove</button></span>)}</div> : null}
    <div className="composer"><input className="visually-hidden" ref={fileInput} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.json,.mp3,.wav" onChange={e => void addFiles(e.target.files)}/><button className="attach-button" aria-label="Attach files" disabled={readingFiles} onClick={() => fileInput.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg></button><label className="visually-hidden" htmlFor="message">Message {title}</label><textarea id="message" rows={1} value={input} placeholder={`Message ${title}`} onChange={e => { setInput(e.target.value); e.currentTarget.style.height="auto"; e.currentTarget.style.height=Math.min(e.currentTarget.scrollHeight,150)+"px"; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/><button className="send-button" aria-label="Send message" disabled={!conversationId || sending || readingFiles || (!input.trim() && !attachments.length)} onClick={send}><svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div>
    {readingFiles?<p className="input-note" role="status">Reading files…</p>:null}
    <p className="input-note">{options.output && options.output !== 'text' ? 'Media mode uses your text prompt. Choose Automatic to discuss attached files.' : 'Enter to send · Shift + Enter for a new line'}</p>
    </>}
  </main>;
}
