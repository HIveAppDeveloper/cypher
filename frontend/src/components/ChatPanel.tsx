import { MODEL_CHOICES } from '../lib/presets';
import { ContextPanel } from './ContextPanel';
import { WorkPanel } from './WorkPanel';
import { GlassSelect } from './GlassSelect';
import React, { useEffect, useState, useRef } from 'react';
import { Bot, Message, MessageType, Attachment, Conversation, Job, RunOptions } from '../lib/types';
import { api, ApiError } from '../lib/api';
import { BotAvatar } from './BotAvatar';
import { MessageBubble } from './MessageBubble';
import { QuickStart } from './QuickStart';
import { RunControls, DEFAULT_OPTIONS } from './RunControls';
import { modelPolicy } from '../lib/modelPolicy';
import { readAttachment } from '../lib/attachments';
import { createSpeechRecognition, describeSpeechError, hasSpeechRecognition, type SpeechRecognitionLike } from '../lib/speech';
const POLL_MS = 1500;
const MAX_BYTES = 3 * 1024 * 1024;
export function ChatPanel({ bot, room, bots, onCreateBot, onCreateRoom, onQuickStart, onOpenLounge, onOpenSetup, onOpenRecent, draftScope }: { draftScope?: string; bot: Bot | null; room: Conversation | null; bots: Bot[]; onCreateBot: () => void; onCreateRoom: () => void; onQuickStart: (prompt: string, options: Partial<import('../lib/types').RunOptions>) => Promise<void>; onOpenLounge: () => Promise<Conversation>; onOpenSetup?: () => void; onOpenRecent: (conversationId: string) => void }) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [input, setInput] = useState('');
  const [dictating, setDictating] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceModeRef = useRef(false);
  const skipRecognitionEndRef = useRef(false);
  const speechFailedRef = useRef(false);
  const speechFinalRef = useRef('');
  const speechInterimRef = useRef('');
  const dictationBaseRef = useRef('');
  const pendingVoiceReplyRef = useRef(false);
  const voiceReplyCursorRef = useRef('');
  const voiceRestartTimerRef = useRef<number | null>(null);
  const sendSpeechRef = useRef<(text: string) => void>(() => {});
  const startVoiceListeningRef = useRef<() => void>(() => {});
  const [replyTo,setReplyTo]=useState<Message|null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [loading, setLoading] = useState(!!bot || !!room);
  const [syncError, setSyncError] = useState('');
  const [syncAttempt,setSyncAttempt] = useState(0);
  const [refreshing,setRefreshing] = useState(false);
  const [sessionExpired,setSessionExpired] = useState(false);
  const [retryAt,setRetryAt] = useState(0);
  const retryNotBefore = useRef(0);
  const retryOpening = useRef(false);
  useEffect(()=>{if(!retryAt)return;const timer=setTimeout(()=>{retryNotBefore.current=0;setRetryAt(0);},Math.max(0,retryAt-Date.now()));return()=>clearTimeout(timer);},[retryAt]);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [messageQuery, setMessageQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger=useRef<HTMLButtonElement>(null);
  function closeSearch(){setSearchOpen(false);setMessageQuery('');searchTrigger.current?.focus();}
  const settings = useRef<HTMLDetailsElement>(null);
  const draftKey = 'grokbot-draft-' + (room?.id || bot?.id || 'home');
  useEffect(() => { try { setInput(sessionStorage.getItem(draftKey) || ''); } catch {} setDraftReady(true); }, [draftKey]);
  useEffect(() => { if(draftReady) try { if(input) sessionStorage.setItem(draftKey, input); else sessionStorage.removeItem(draftKey); } catch {} }, [draftKey, input, draftReady]);
  useEffect(() => {
    function close(event: KeyboardEvent | globalThis.PointerEvent) {
      if (!settings.current?.open) return;
      if(event.type === 'keydown' && !event.defaultPrevented && (event as KeyboardEvent).key === 'Escape') { settings.current.open=false; settings.current.querySelector('summary')?.focus(); }
      else if(event.type === 'pointerdown' && !settings.current.contains(event.target as Node) && !(event.target as HTMLElement).closest('[role=listbox],[role=option]')) settings.current.open=false;
    }
    document.addEventListener('keydown',close); document.addEventListener('pointerdown',close);
    return () => { document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close); };
  }, []);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [readingFiles,setReadingFiles]=useState(false);
  const [draggingFiles,setDraggingFiles]=useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const unconfirmedDraft = useRef<{id:string;text:string;files:Attachment[];reply?:string} | null>(null);
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
  const [font, setFont] = useState('system');
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const prependOffset = useRef<number | null>(null);
  const firstPage = useRef(true);
  const stream = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const followLatest = useRef(true);
  const title = room?.title === 'Agent lounge' ? 'Your team' : room?.title || bot?.name || 'Workspace';
  useEffect(() => () => {
    if (voiceRestartTimerRef.current !== null) window.clearTimeout(voiceRestartTimerRef.current);
    speechRecognitionRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);
  useEffect(() => { const el = stream.current; if (!el) return; if (prependOffset.current !== null) { el.scrollTop = el.scrollHeight - prependOffset.current; prependOffset.current = null; } else if (followLatest.current) el.scrollTop = el.scrollHeight; }, [messages.length, messages[messages.length - 1]?.id]);
  useEffect(()=>{followLatest.current=true;setConversationId('');setMessages([]);setJobs([]);setAttachments([]);setError('');setLoading(!!bot || !!room);setSyncError('');setSessionExpired(false);retryNotBefore.current=0;setRetryAt(0);firstPage.current=true;},[bot?.id,room?.id]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>; let failures=0; let pending=false;
    const controller=new AbortController();
    if (!bot && !room) return;
    retryOpening.current=true;setRefreshing(true);
    let currentId='';let latestMessageId:string|undefined;
    const poll = async () => {
      if(!active || pending || !currentId || Date.now()<retryNotBefore.current)return;
      pending=true; clearTimeout(timer); let delay=10000;
      try { const {messages:data,tasks}=await api.syncConversation(currentId,latestMessageId,controller.signal); if(active){failures=0;if(data.length)latestMessageId=data[data.length-1].id;if(firstPage.current){setHasEarlier(data.length===50);firstPage.current=false;}setMessages(previous=>mergeMessages(previous,data));setJobs(tasks);setLoading(false);setSyncError('');setSessionExpired(false);delay=tasks.some(t=>['pending','running','cancel_requested'].includes(t.status))?POLL_MS:10000;} }
      catch(e){if(active){failures++;setLoading(false);setSessionExpired(e instanceof ApiError && e.status===401);const wait=e instanceof ApiError?Math.max(0,e.retryAfter*1000):0;retryNotBefore.current=wait?Date.now()+wait:0;setRetryAt(retryNotBefore.current);setSyncError(e instanceof ApiError && e.code==='database_quota'?e.message:e instanceof ApiError && e.status===401?'Your session expired. Sign in again to reconnect.':'Couldn’t refresh this conversation. Your messages are saved; reconnecting automatically…');delay=Math.max(e instanceof ApiError?e.retryAfter*1000:0,Math.min(60000,2000*2**Math.min(failures,5)));}}
      finally{pending=false;if(active){retryOpening.current=false;setRefreshing(false);}if(active)timer=setTimeout(poll,document.hidden?Math.max(delay,60000):delay);}
    };
    const refresh=()=>{if(document.hidden || pending || retryOpening.current || Date.now()<retryNotBefore.current)return;if(currentId){setRefreshing(true);void poll();}else{retryOpening.current=true;setSyncAttempt(value=>value+1);}};
    document.addEventListener('visibilitychange',refresh);window.addEventListener('grokbot:refresh',refresh);window.addEventListener('online',refresh);
    const load = room ? Promise.resolve(room.id) : api.conversationForBot(bot!);
    load.then(id=>{if(active){currentId=id;setConversationId(id);void poll();}}).catch(e=>{if(active){retryOpening.current=false;setRefreshing(false);setLoading(false);setSessionExpired(e instanceof ApiError && e.status===401);const wait=e instanceof ApiError?Math.max(0,e.retryAfter*1000):0;retryNotBefore.current=wait?Date.now()+wait:0;setRetryAt(retryNotBefore.current);setSyncError(e instanceof ApiError && e.status===401?'Your session expired. Sign in again to reconnect.':(e instanceof ApiError?e.message:'Couldn’t open this conversation.')+' Your draft is kept here. Reconnect to try again.');}});
    return()=>{active=false;controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('grokbot:refresh',refresh);window.removeEventListener('online',refresh);};
  }, [bot?.id, room?.id, syncAttempt]);
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
      const allowed = ['image/png','image/jpeg','image/webp','application/pdf','text/plain','audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/flac','video/mp4','video/webm','video/quicktime'];
      const loaded = await Promise.all(list.map(file => {
        const extensions:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',md:'text/plain',csv:'text/plain',json:'text/plain',wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
        const mime=allowed.includes(file.type)?file.type:extensions[file.name.split('.').pop()?.toLowerCase()||''];
        if (!mime) throw new Error(`${file.name}: use images, PDF, text, audio, MP4, WebM, or MOV.`);
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
  function startSpeechCapture(voiceTurn: boolean) {
    if (speechRecognitionRef.current) return;
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setVoiceError('Speech input is not available in this browser. Type your message instead.');
      if (voiceTurn) { voiceModeRef.current = false; setVoiceMode(false); }
      return;
    }
    speechFailedRef.current = false;
    speechFinalRef.current = '';
    speechInterimRef.current = '';
    dictationBaseRef.current = voiceTurn ? '' : input.trim();
    setVoiceError('');
    setVoiceStatus(voiceTurn ? 'Listening. Speak a message.' : 'Listening. Speech recognition is handled by your browser.');
    setDictating(true);
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result[0]?.transcript.trim();
        if (!transcript) continue;
        (result.isFinal ? finalParts : interimParts).push(transcript);
      }
      speechFinalRef.current = finalParts.join(' ');
      speechInterimRef.current = interimParts.join(' ');
      setInput([dictationBaseRef.current, speechFinalRef.current, speechInterimRef.current].filter(Boolean).join(' '));
    };
    recognition.onerror = event => {
      if (event.error === 'no-speech') {
        setVoiceStatus(voiceTurn ? 'No speech detected. Listening again…' : describeSpeechError(event.error));
        return;
      }
      speechFailedRef.current = true;
      setVoiceError(describeSpeechError(event.error));
      if (voiceTurn) { voiceModeRef.current = false; setVoiceMode(false); pendingVoiceReplyRef.current = false; }
    };
    recognition.onend = () => {
      speechRecognitionRef.current = null;
      setDictating(false);
      if (skipRecognitionEndRef.current) { skipRecognitionEndRef.current = false; return; }
      if (speechFailedRef.current) return;
      const transcript = speechFinalRef.current.trim();
      if (voiceTurn && voiceModeRef.current) {
        if (transcript) {
          setVoiceStatus('Sending your message…');
          sendSpeechRef.current(transcript);
        } else {
          setVoiceStatus('Listening again. Speak when ready.');
          voiceRestartTimerRef.current = window.setTimeout(() => startVoiceListeningRef.current(), 600);
        }
      } else if (!voiceTurn) {
        setVoiceStatus(transcript ? 'Dictation added. Review or edit it before sending.' : 'No speech detected. Try again.');
      }
    };
    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      speechRecognitionRef.current = null;
      setDictating(false);
      setVoiceError('Could not start speech recognition. Check your browser microphone permissions.');
      if (voiceTurn) { voiceModeRef.current = false; setVoiceMode(false); }
    }
  }
  startVoiceListeningRef.current = () => startSpeechCapture(true);

  function stopVoiceMode() {
    voiceModeRef.current = false;
    pendingVoiceReplyRef.current = false;
    setVoiceMode(false);
    setDictating(false);
    setVoiceStatus('Voice mode is off.');
    if (voiceRestartTimerRef.current !== null) window.clearTimeout(voiceRestartTimerRef.current);
    voiceRestartTimerRef.current = null;
    if (speechRecognitionRef.current) {
      skipRecognitionEndRef.current = true;
      speechRecognitionRef.current.stop();
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  async function send(spokenText?: string) {
    const text = spokenText ?? input;
    if ((!text.trim() && !attachments.length) || !conversationId || readingFiles || sendingRef.current) return;
    if (speechRecognitionRef.current) {
      skipRecognitionEndRef.current = true;
      speechRecognitionRef.current.stop();
    }
    if (voiceModeRef.current) {
      const latestReply = [...messages].reverse().find(message => message.senderType === 'bot' && message.messageType === MessageType.TEXT);
      voiceReplyCursorRef.current = latestReply?.id || '';
      pendingVoiceReplyRef.current = true;
      setVoiceStatus('Cypher is working on your message…');
    }
    sendingRef.current = true;
    const files = attachments;
    const previousDraft=unconfirmedDraft.current;
    const messageId=previousDraft?.text===text && JSON.stringify(previousDraft.files)===JSON.stringify(files) && previousDraft.reply===replyTo?.id?previousDraft.id:crypto.randomUUID();
    followLatest.current = true;
    setSending(true); setError(''); setInput(''); setAttachments([]);
    const composerInput=document.getElementById("message"); if(composerInput)composerInput.style.height="auto";
    setMessages(previous => mergeMessages(previous, [{id:messageId,conversationId,senderType:'user',content:text,messageType:MessageType.TEXT,createdAt:new Date().toISOString(),attachments:files,threadRootId:replyTo?.threadRootId||replyTo?.id,replyToId:replyTo?.id,delivery:'sending'}]));
    try {
      const accepted = await api.sendMessage(conversationId, text, files, options, messageId,replyTo?.id);
      setReplyTo(null);
      unconfirmedDraft.current=null;
      window.dispatchEvent(new Event('grokbot:refresh'));
      setMessages(previous=>previous.map(message=>message.id===messageId?{...message,delivery:'sent'}:message));
      setJobs(previous=>previous.some(job=>job.id===accepted.task_id)?previous:[{id:accepted.task_id,title:text.slice(0,100),status:'pending',created_at:new Date().toISOString()},...previous]);
    } catch (e) {
      unconfirmedDraft.current={id:messageId,text,files,reply:replyTo?.id};
      setMessages(previous=>previous.map(message=>message.id===messageId?{...message,delivery:'failed'}:message));
      setInput(current=>current || text);setAttachments(current=>current.length?current:files);
      setError(`Message was not confirmed. ${String(e).replace(/^Error: /,'')} Your message is kept in this thread; resend from the composer to retry.`);
    } finally { sendingRef.current=false;setSending(false); }
  }
  const visibleMessages = messages.filter(m => !m.internal && (!messageQuery.trim() || m.content.toLowerCase().includes(messageQuery.trim().toLowerCase())));
  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running' || j.status === 'cancel_requested');
  sendSpeechRef.current = text => { void send(text); };
  const latestVoiceReply = [...messages].reverse().find(message => !message.internal && message.senderType === 'bot' && message.messageType === MessageType.TEXT && !!message.content.trim());
  function toggleVoiceMode() {
    if (voiceModeRef.current) { stopVoiceMode(); return; }
    if (!conversationId || loading || sending || activeJobs.length) {
      setVoiceError('Wait for the current work to finish before starting Voice mode.');
      return;
    }
    if (input.trim() || attachments.length || replyTo) {
      setVoiceError('Send or clear the current draft before starting Voice mode.');
      return;
    }
    if (!('speechSynthesis' in window)) {
      setVoiceError('Voice replies are not supported in this browser.');
      return;
    }
    if (!hasSpeechRecognition()) {
      setVoiceError('Speech input is not available in this browser. Type your message instead.');
      return;
    }
    voiceReplyCursorRef.current = latestVoiceReply?.id || '';
    pendingVoiceReplyRef.current = false;
    voiceModeRef.current = true;
    setVoiceMode(true);
    setVoiceError('');
    setVoiceStatus('Voice mode is on. Speak when the microphone starts.');
    startSpeechCapture(true);
  }
  useEffect(() => {
    if (!voiceMode || !pendingVoiceReplyRef.current || sending || activeJobs.length) return;
    if (!latestVoiceReply || latestVoiceReply.id === voiceReplyCursorRef.current) {
      const retryTimer = window.setTimeout(() => {
        if (voiceModeRef.current && pendingVoiceReplyRef.current) setVoiceStatus('Still waiting for Cypher’s reply…');
      }, 10000);
      return () => window.clearTimeout(retryTimer);
    }
    voiceReplyCursorRef.current = latestVoiceReply.id;
    pendingVoiceReplyRef.current = false;
    const speechText = latestVoiceReply.content
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[#*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!speechText) {
      setVoiceStatus('Listening again. Speak when ready.');
      voiceRestartTimerRef.current = window.setTimeout(() => startVoiceListeningRef.current(), 500);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = navigator.language || 'en-US';
    utterance.onend = () => {
      if (!voiceModeRef.current) return;
      setVoiceStatus('Listening again. Speak when ready.');
      voiceRestartTimerRef.current = window.setTimeout(() => startVoiceListeningRef.current(), 400);
    };
    utterance.onerror = () => {
      if (!voiceModeRef.current) return;
      setVoiceError('Voice playback failed. Turn Voice mode off and on to retry.');
      voiceModeRef.current = false;
      pendingVoiceReplyRef.current = false;
      setVoiceMode(false);
    };
    window.speechSynthesis.cancel();
    setVoiceStatus('Cypher is speaking…');
    window.speechSynthesis.speak(utterance);
  }, [voiceMode, sending, activeJobs.length, latestVoiceReply?.id, latestVoiceReply?.content]);
  useEffect(() => {
    if (voiceModeRef.current) stopVoiceMode();
    else if (speechRecognitionRef.current) {
      skipRecognitionEndRef.current = true;
      speechRecognitionRef.current.stop();
      setDictating(false);
    }
    setVoiceError('');
    setVoiceStatus('');
  }, [bot?.id, room?.id]);
  useEffect(() => {
    if (error && voiceModeRef.current) stopVoiceMode();
  }, [error]);
  const fontFamily = font === 'serif' ? 'Georgia, serif' : font === 'system' ? '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' : '"Inter Variable", sans-serif';
  return <main className={`main-content ${draggingFiles ? 'files-dragging' : ''}`} style={{ fontFamily }} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDraggingFiles(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDraggingFiles(false);}} onDrop={e=>{e.preventDefault();setDraggingFiles(false);if(!readingFiles && conversationId)void addFiles(e.dataTransfer.files);}}>
    {draggingFiles?<div className="file-drop-hint">Drop files into this conversation</div>:null}
    <header className="workspace-toolbar"><div className="toolbar-location"><strong>{title}</strong></div><div className="toolbar-actions">{conversationId?<><button ref={searchTrigger} className="toolbar-button" aria-label="Search this conversation" aria-pressed={searchOpen} onClick={()=>{if(searchOpen)closeSearch();else setSearchOpen(true);}}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>Search</span></button><button className="toolbar-button" aria-expanded={workOpen} onClick={()=>setWorkOpen(true)}>Work <span className="work-count">{activeJobs.length||jobs.length}</span></button></>:null}<details ref={settings} className="thread-settings"><summary>Conversation settings</summary><div className="thread-settings-sheet"><h2>Conversation settings</h2><RunControls options={options} onChange={setOptions} font={font} onFont={setFont} group={!!room?.is_group} model={bot ? { provider: bot.llmProvider, model: bot.llmModel } : undefined}/><button type="button" className="model-connection-link" onClick={() => onOpenSetup?.()}>Connect or test a model</button>    {jobs.length ? <details className="job-tray"><summary>{activeJobs.length ? `${activeJobs.length} job${activeJobs.length === 1 ? '' : 's'} in progress` : 'Recent work'}</summary>{jobs.slice(0,6).map(job => <div key={job.id}><span>{job.title}</span><strong data-status={job.status}>{job.status === 'cancel_requested' ? 'Stopping…' : job.status}</strong>{['pending','running'].includes(job.status) ? <button aria-label={`Cancel ${job.title}`} onClick={() => api.cancelJob(conversationId, job.id).catch(e => setError(e.message))}>Cancel</button> : null}</div>)}</details> : null}
    {conversationId ? <ContextPanel key={'context-'+conversationId} conversationId={conversationId}/> : null}

    <details className="thread-options"><summary>Message options <span>{options.output === 'image' ? 'Image' : 'Automatic'} · {options.routing!=='manual'?'Auto specialists':options.model}</span></summary><div className="output-controls"><label>Manager<GlassSelect aria-label="Manager model" value={options.routing!=='manual'?'auto':options.model || bot?.llmModel || 'gpt-6.1-sol'} onChange={e => { setOptions({...options,routing:e.target.value==='auto'?'auto':'manual',provider:MODEL_CHOICES.find(m=>m.model===e.target.value)?.provider||'openai',model:e.target.value==='auto'?'gpt-6.1-sol':e.target.value}); try { localStorage.setItem('grokbot-manager',e.target.value); } catch {} }}><option value="auto">Auto · task specialists</option>{MODEL_CHOICES.map(m=><option key={m.id} value={m.model}>{m.label}</option>)}</GlassSelect></label><label>Output<GlassSelect aria-label="Output type" value={options.output || 'text'} onChange={e => setOptions({ ...options, output: e.target.value as 'text' | 'image', aspect_ratio: '16:9' })}><option value="text">Automatic</option><option value="image">Create an image</option></GlassSelect></label>{options.output && options.output !== 'text' ? <><label>Shape<GlassSelect aria-label="Media shape" value={options.aspect_ratio || '16:9'} onChange={e => setOptions({ ...options, aspect_ratio: e.target.value })}><option value="16:9">Landscape</option><option value="9:16">Portrait</option>{options.output === 'image' ? <option value="1:1">Square</option> : null}</GlassSelect></label><span className="media-cost-note">Uses generation credits</span></> : null}</div></details>
</div></details></div></header>
    {searchOpen?<div className="conversation-search"><input autoFocus type="search" aria-label="Search loaded messages" placeholder="Search loaded messages…" value={messageQuery} onChange={event=>setMessageQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape')closeSearch();}}/><span role="status">{visibleMessages.length} results</span><button onClick={closeSearch}>Close</button></div>:null}
    {conversationId?<WorkPanel open={workOpen} onClose={()=>setWorkOpen(false)} conversationId={conversationId} jobs={jobs} options={options} onChange={setOptions} onRefresh={async()=>setJobs(await api.getJobs(conversationId))}/>:null}
    {!bot && !room ? <QuickStart key={draftScope || 'local'} draftScope={draftScope} options={options} onOptions={setOptions} onStart={onQuickStart} onOpenRecent={onOpenRecent}/> : <>
    {bot ? <div className="conversation-computer"><span>{computerBotId === bot.id ? 'Computer connected' : 'Computer tools'}</span><button disabled={computerBusy} onClick={() => void toggleComputer()}>{computerBusy ? 'Connecting…' : computerBotId === bot.id ? 'Stop computer' : 'Start computer'}</button></div> : null}
    {room?.is_group ? <details className="thread-members"><summary>{room.bot_ids.length} teammates</summary><div className="team-members">{bots.filter(b => room.bot_ids.includes(b.id)).map(b => <span key={b.id} title={`${b.llmProvider} · ${b.llmModel}`}><BotAvatar name={b.name} small/>{b.name}</span>)}</div></details> : null}
    {computerError ? <p role="alert">{computerError}</p> : null}
    {error ? <div className="conversation-alert" role="alert"><span>{error.replace(/^Error: /, '')}</span><button aria-label="Dismiss error" onClick={() => setError('')}>Dismiss</button></div> : null}{syncError ? <div className="sync-status" role="status"><span>{syncError}</span>{sessionExpired?<a href="/login">Sign in</a>:<button disabled={refreshing || retryAt>Date.now()} onClick={()=>window.dispatchEvent(new Event('grokbot:refresh'))}>{refreshing?'Reconnecting…':retryAt>Date.now()?'Waiting to retry…':'Reconnect'}</button>}</div> : null}
    <div ref={stream} onScroll={() => { const el = stream.current; if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; setAwayFromLatest(!followLatest.current); }} className="message-stream" style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column' }}>{hasEarlier ? <button className="load-earlier" disabled={loadingEarlier} onClick={loadEarlier}>{loadingEarlier ? 'Loading…' : 'Load earlier messages'}</button> : null}{messages.some(m => m.internal) ? <details className="fleet-activity"><summary>Background activity</summary>{messages.filter(m => m.internal).map(m => <MessageBubble key={m.id} message={m} bot={bots.find(b => b.id === m.senderBotId)}/>)}</details> : null}{visibleMessages.map((m,index) => { const previous=visibleMessages[index-1]; const grouped=!!previous && previous.senderType===m.senderType && previous.senderBotId===m.senderBotId && new Date(m.createdAt).getTime()-new Date(previous.createdAt).getTime()<300000; return <MessageBubble key={m.id} message={m} onReply={message=>{setReplyTo(message);document.getElementById("message")?.focus();}} grouped={grouped} bot={bots.find(b => b.id === m.senderBotId)}/>; })}{!loading && messageQuery.trim() && !visibleMessages.length ? <div className="work-empty"><h3>No matching messages</h3><p>Try a different search. Only loaded messages are included.</p></div> : null}{loading ? <div className="conversation-loading" role="status">Loading conversation…</div> : null}{!loading && !syncError && !error && !visibleMessages.length && !messageQuery.trim() ? <div className="conversation-empty"><strong>{room ? 'What should we take care of?' : 'What should I take care of?'}</strong><p>Send the outcome you want, or drop in a file.</p><span>Work continues in the cloud when you close this tab.</span></div> : null}</div>
    {awayFromLatest ? <button className="jump-latest" onClick={() => { followLatest.current=true; setAwayFromLatest(false); stream.current?.scrollTo({top:stream.current.scrollHeight, behavior:document.documentElement.dataset.motion==='false' || window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }}>Jump to latest</button> : null}
    {activeJobs.length ? <div className="active-work" role="status"><span>{activeJobs.some(job => job.status === 'running') ? 'Working on your request' : activeJobs.some(job => job.status === 'cancel_requested') ? 'Stopping…' : 'Request queued'}{activeJobs.length > 1 ? ` · ${activeJobs.length} tasks` : ''}</span><button disabled={stopping || activeJobs.every(job => job.status === 'cancel_requested')} onClick={async () => { setStopping(true); const cancellable=activeJobs.filter(job => job.status !== 'cancel_requested'); const results=await Promise.allSettled(cancellable.map(job => api.cancelJob(conversationId,job.id))); if(results.some(result => result.status === 'rejected')) setError('Some work could not be stopped. Try again.'); setJobs(await api.getJobs(conversationId).catch(() => jobs)); setStopping(false); }}>Stop</button></div> : null}
    {attachments.length ? <div className="attachment-tray">{attachments.map((a,i) => <span key={`${a.name}-${i}`}>{a.mime.startsWith('image/') ? <img src={`data:${a.mime};base64,${a.data}`} alt=""/> : null}{a.name}<button aria-label={`Remove ${a.name}`} onClick={() => setAttachments(prev => prev.filter((_,index) => index !== i))}>Remove</button></span>)}</div> : null}
    {replyTo?<div className="reply-preview"><span>Replying in an isolated thread: {replyTo.content.slice(0,110)}</span><button onClick={()=>setReplyTo(null)}>Cancel reply</button></div>:null}
    <div className="composer"><input className="visually-hidden" ref={fileInput} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.json,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mov" onChange={e => void addFiles(e.target.files)}/><label className="visually-hidden" htmlFor="message">Message {title}</label><textarea id="message" rows={1} maxLength={20000} value={input} placeholder={`Message ${title}`} onChange={e => { setInput(e.target.value); e.currentTarget.style.height="auto"; e.currentTarget.style.height=Math.min(e.currentTarget.scrollHeight,150)+"px"; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/><div className="composer-footer"><button className="attach-button" aria-label="Attach files" disabled={readingFiles || !conversationId || voiceMode} onClick={() => fileInput.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg></button><button type="button" className="chat-speech-button" aria-label={dictating ? "Stop dictation" : "Dictate message"} aria-pressed={dictating} disabled={!conversationId || sending || readingFiles || voiceMode} onClick={() => { if (speechRecognitionRef.current) speechRecognitionRef.current.stop(); else startSpeechCapture(false); }} title="Dictate using your browser speech service"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></svg><span>{dictating ? "Listening…" : "Dictate"}</span></button><div className="composer-options"><span>Response</span><GlassSelect aria-label="Response format" value={options.output||'text'} onChange={event=>setOptions(current=>({...current,output:event.target.value as 'text'|'image',aspect_ratio:'16:9'}))}><option value="text">Text</option><option value="image">Image</option></GlassSelect><button className="tools-toggle" aria-pressed={options.allow_tools!==false} onClick={()=>setOptions(current=>({...current,allow_tools:current.allow_tools===false}))}>{options.allow_tools===false?'Tools off':'Tools on'}</button><span className="composer-model">{options.routing==='manual'?(options.model || bot?.llmModel):'Auto · task specialists'}</span></div><button type="button" className="voice-mode-button" aria-label={voiceMode ? "Turn voice mode off" : "Turn voice mode on"} aria-pressed={voiceMode} disabled={!conversationId || loading || sending || (activeJobs.length > 0 && !voiceMode)} onClick={toggleVoiceMode} title="Talk with Cypher; replies will be spoken"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13v-1a9 9 0 0 1 18 0v1M3 13h4v7H5a2 2 0 0 1-2-2v-5Zm18 0h-4v7h2a2 2 0 0 0 2-2v-5Z"/></svg><span>{voiceMode ? (dictating ? "Listening" : "Voice on") : "Voice mode"}</span></button><button className="send-button" aria-label="Send message" disabled={!conversationId || sending || readingFiles || (!input.trim() && !attachments.length)} onClick={() => void send()}><svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div></div>
    {readingFiles?<p className="input-note" role="status">Reading files…</p>:null}
    {voiceError ? <p className="voice-status" data-state="error" role="alert">{voiceError}</p> : voiceStatus ? <p className="voice-status" data-state={dictating ? 'listening' : voiceMode ? 'active' : 'idle'} role="status">{voiceStatus}{voiceMode ? <span className="voice-provider-note">Browser speech services handle listening and playback.</span> : null}</p> : <p className="input-note">{options.output && options.output !== 'text' ? 'Media mode uses your text prompt. Choose Text to discuss attached files.' : 'Enter to send · Shift + Enter for a new line · Text drafts saved in this tab'}</p>}
    </>}
  </main>;
}
