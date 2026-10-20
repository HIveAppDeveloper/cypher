import React, { useEffect, useState, useRef } from 'react';
import { Bot, Message, Attachment, Conversation, Job } from '../lib/types';
import { api } from '../lib/api';
import { BotAvatar } from './BotAvatar';
import { MessageBubble } from './MessageBubble';
import { QuickStart } from './QuickStart';
import { RunControls, DEFAULT_OPTIONS } from './RunControls';
const POLL_MS = 1500;
const MAX_BYTES = 3 * 1024 * 1024;
export function ChatPanel({ bot, room, bots, onCreateBot, onCreateRoom, onQuickStart, onOpenLounge }: { bot: Bot | null; room: Conversation | null; bots: Bot[]; onCreateBot: () => void; onCreateRoom: () => void; onQuickStart: (prompt: string, options: Partial<import('../lib/types').RunOptions>) => Promise<void>; onOpenLounge: () => Promise<Conversation> }) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [options, setOptions] = useState(() => { try { return { ...DEFAULT_OPTIONS, ...bot?.defaultOptions, ...JSON.parse(localStorage.getItem('grokbot-options-' + bot?.id) || '{}') }; } catch { return { ...DEFAULT_OPTIONS, ...bot?.defaultOptions }; } });
  useEffect(() => { if (bot) { try { localStorage.setItem('grokbot-options-' + bot.id, JSON.stringify(options)); } catch {} } }, [options, bot?.id]);
  const [font, setFont] = useState('inter');
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const prependOffset = useRef<number | null>(null);
  const firstPage = useRef(true);
  const stream = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const followLatest = useRef(true);
  const title = room?.title || bot?.name || 'Workspace';
  useEffect(() => { const el = stream.current; if (!el) return; if (prependOffset.current !== null) { el.scrollTop = el.scrollHeight - prependOffset.current; prependOffset.current = null; } else if (followLatest.current) el.scrollTop = el.scrollHeight; }, [messages.length, messages[messages.length - 1]?.id]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    followLatest.current = true; setConversationId(''); setMessages([]); setJobs([]); setAttachments([]); setError('');
    if (!bot && !room) return;
    const poll = async (id: string) => {
      try { const [data, tasks] = await Promise.all([api.getMessages(id), api.getJobs(id)]); if (active) { if (firstPage.current) { setHasEarlier(data.length === 50); firstPage.current = false; } setMessages(previous => mergeMessages(previous, data)); setJobs(tasks); setError(''); } }
      catch (e) { if (active) setError(String(e)); }
      if (active) timer = setTimeout(() => poll(id), POLL_MS);
    };
    const load = room ? Promise.resolve(room.id) : api.conversationForBot(bot!);
    load.then(id => { if (active) { setConversationId(id); void poll(id); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; clearTimeout(timer); };
  }, [bot?.id, room?.id]);
  function mergeMessages(previous: Message[], incoming: Message[]) {
    const map = new Map(previous.map(message => [message.id, message])); incoming.forEach(message => map.set(message.id, message));
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
    setError('');
    try {
      const list = Array.from(files);
      if (attachments.length + list.length > 4) throw new Error('Attach up to four files per message.');
      const existingBytes = attachments.reduce((sum, a) => sum + Math.floor(a.data.length * .75), 0);
      if (existingBytes + list.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) throw new Error('Keep combined attachments below 3 MB.');
      const allowed = ['image/png','image/jpeg','image/webp','application/pdf','text/plain','audio/wav','audio/mpeg'];
      const loaded = await Promise.all(list.map(file => new Promise<Attachment>((resolve, reject) => {
        if (!allowed.includes(file.type)) return reject(new Error('Use PNG, JPEG, WebP, PDF, TXT, MP3, or WAV.'));
        const reader = new FileReader(); reader.onerror = () => reject(new Error('File could not be read.')); reader.onload = () => resolve({ name: file.name, mime: file.type, data: String(reader.result).split(',')[1] }); reader.readAsDataURL(file);
      })));
      setAttachments(prev => [...prev, ...loaded]);
    } catch (e) { setError(String(e)); }
    if (fileInput.current) fileInput.current.value = '';
  }
  async function send() {
    if ((!input.trim() && !attachments.length) || !conversationId || sending) return;
    setSending(true); setError('');
    try { await api.sendMessage(conversationId, input, attachments, options); setInput(''); setAttachments([]); followLatest.current = true; }
    catch (e) { setError(String(e)); } finally { setSending(false); }
  }
  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running' || j.status === 'cancel_requested');
  const fontFamily = font === 'serif' ? 'Georgia, serif' : font === 'system' ? 'system-ui, sans-serif' : '"Inter Variable", sans-serif';
  return <main className="main-content" style={{ fontFamily }}>
    <header className="workspace-toolbar"><span className="workspace-context">{room ? 'Team conversation' : bot ? 'Agent conversation' : 'Your workspace'}</span><RunControls options={options} onChange={setOptions} font={font} onFont={setFont} group={!!room} model={bot ? { provider: bot.llmProvider, model: bot.llmModel } : undefined}/></header>
    {!bot && !room ? <QuickStart onStart={onQuickStart} onCreateBot={onCreateBot} onCreateRoom={onCreateRoom} onOpenLounge={onOpenLounge}/> : <>
    <header className="chat-header"><span className="identity-pill"><BotAvatar name={title} small/>{title}</span>{bot ? <button className="sandbox-button" onClick={() => api.startBot(bot.id).catch(e => setError(String(e)))}>Start computer</button> : null}</header>
    {room ? <div className="team-members">{bots.filter(b => room.bot_ids.includes(b.id)).map(b => <span key={b.id} title={`${b.llmProvider} · ${b.llmModel}`}><BotAvatar name={b.name} small/>{b.name}</span>)}</div> : null}
    {error ? <p role="alert">{error.replace(/^Error: /, '')}</p> : null}
    <div ref={stream} onScroll={() => { const el = stream.current; if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="message-stream" style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column' }}>{hasEarlier ? <button className="load-earlier" disabled={loadingEarlier} onClick={loadEarlier}>{loadingEarlier ? 'Loading…' : 'Load earlier messages'}</button> : null}{messages.map(m => <MessageBubble key={m.id} message={m} bot={bots.find(b => b.id === m.senderBotId)}/>)}{!messages.length ? <p className="conversation-empty">Start with a question, a file, or a task.</p> : null}</div>
    {jobs.length ? <details className="job-tray"><summary>{activeJobs.length ? `${activeJobs.length} job${activeJobs.length === 1 ? '' : 's'} in progress` : 'Recent work'}</summary>{jobs.slice(0,6).map(job => <div key={job.id}><span>{job.title}</span><strong data-status={job.status}>{job.status === 'cancel_requested' ? 'Stopping…' : job.status}</strong>{['pending','running'].includes(job.status) ? <button aria-label={`Cancel ${job.title}`} onClick={() => api.cancelJob(conversationId, job.id).catch(e => setError(e.message))}>Cancel</button> : null}</div>)}</details> : null}
    {attachments.length ? <div className="attachment-tray">{attachments.map((a,i) => <span key={`${a.name}-${i}`}>{a.mime.startsWith('image/') ? <img src={`data:${a.mime};base64,${a.data}`} alt=""/> : null}{a.name}<button aria-label={`Remove ${a.name}`} onClick={() => setAttachments(prev => prev.filter((_,index) => index !== i))}>Remove</button></span>)}</div> : null}
    <div className="output-controls"><label>Output<select aria-label="Output type" value={options.output || 'text'} onChange={e => setOptions({ ...options, output: e.target.value as 'text' | 'image' | 'video', aspect_ratio: '16:9' })}><option value="text">Let the agent decide</option><option value="image">Create an image</option><option value="video">Create a video</option></select></label>{options.output && options.output !== 'text' ? <><label>Shape<select aria-label="Media shape" value={options.aspect_ratio || '16:9'} onChange={e => setOptions({ ...options, aspect_ratio: e.target.value })}><option value="16:9">Landscape</option><option value="9:16">Portrait</option>{options.output === 'image' ? <option value="1:1">Square</option> : null}</select></label>{options.output === 'video' ? <label>Length<select aria-label="Video length" value={options.duration || 4} onChange={e => setOptions({ ...options, duration: +e.target.value })}><option value="4">4 seconds</option><option value="6">6 seconds</option><option value="8">8 seconds</option></select></label> : null}<span className="media-cost-note">Uses generation credits</span></> : null}</div>
    <div className="composer"><input className="visually-hidden" ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,audio/mpeg,audio/wav" onChange={e => void addFiles(e.target.files)}/><button className="attach-button" aria-label="Attach files" onClick={() => fileInput.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg></button><label className="visually-hidden" htmlFor="message">Message {title}</label><textarea id="message" rows={1} value={input} placeholder={`Message ${title}`} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/><button className="send-button" aria-label="Send message" disabled={!conversationId || sending || (!input.trim() && !attachments.length)} onClick={send}><svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div>
    <p className="input-note">{options.output && options.output !== 'text' ? 'Media mode uses your text prompt. Switch to Ask anything to discuss attached files.' : 'Files go to your model provider. Media generation uses separate model credits.'}</p>
    </>}
  </main>;
}
