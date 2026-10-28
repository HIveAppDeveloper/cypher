import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Blob,File} from 'node:buffer';
import {environment,renderer,load,find,textOf} from './support/component-harness.mjs';

function voiceChat() {
  const env=environment(),view=renderer(env),spoken=[];
  let phase='idle',status='completed',voiceMode=true,frame,amplitude=128,syncs=0;
  const element=env.element;
  env.element=props=>element({style:{setProperty(){}},pause(){},load(){},removeAttribute(){},...props});
  class AudioContext {
    createAnalyser(){return {fftSize:512,frequencyBinCount:256,getByteTimeDomainData(data){data.fill(amplitude);},connect(){},disconnect(){}};}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createMediaElementSource(){return {connect(){}};}
    async resume(){} async close(){}
  }
  class MediaRecorder {
    static isTypeSupported(){return true;}
    constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(1024)])});this.onstop?.();}
  }
  env.window.MediaRecorder=MediaRecorder;
  let bot={id:'agent-a',name:'Researcher',llmProvider:'openai',llmModel:'fixture'};
  const stream={getAudioTracks:()=>[]};
  const reply={id:'reply-a',taskId:'task-a',senderType:'bot',senderBotId:bot.id,messageType:'text',
    content:'A final answer after the sync caught up.',createdAt:'1970-01-01T00:00:01Z'};
  const api={
    conversationForBot:async selected=> selected.id==='agent-a'?'conversation-a':'conversation-b',
    sendMessage:async()=>{phase='completed-without-message';return {task_id:'task-a'};},
    syncConversation:async()=>{syncs++;const foreign={...reply,id:'other-reply',taskId:'other-task',content:'Never speak another task.',createdAt:'1970-01-01T00:00:00.500Z'};return {messages:phase==='reply'?[reply]:phase==='legacy-reply'?[{...reply,taskId:undefined}]:phase==='wrong-task'?[foreign]:phase==='page'?[...Array.from({length:49},(_,index)=>({...reply,id:'internal-'+index,internal:true,content:'Synthetic activity',createdAt:new Date(100+index).toISOString()})),foreign]:[],tasks:phase==='idle'?[]:[{id:'task-a',status,title:'Voice task',created_at:'1970-01-01T00:00:00Z'}]};},
  };
  const imports={react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./PendingReplySkeleton':{PendingReplySkeleton:'pending-skeleton'},
    '../lib/presets':{MODEL_CHOICES:[]},'./ContextPanel':{ContextPanel:'context-panel'},'./WorkPanel':{WorkPanel:'work-panel'},'./GlassSelect':{GlassSelect:'select'},
    '../lib/types':{MessageType:{TEXT:'text'}},'../lib/api':{api,ApiError:class extends Error{}},'./BotAvatar':{BotAvatar:'avatar'},'./MessageBubble':{MessageBubble:'message-bubble'},
    './AgentConversationActivity':{AgentConversationActivity:'agent-activity',conversationMessages:messages=>messages,isAgentActivityMessage:()=>false},
    './QuickStart':{QuickStart:'quick-start'},'./RunControls':{RunControls:'run-controls',DEFAULT_OPTIONS:{}},'../lib/modelPolicy':{modelPolicy:value=>value},
    '../lib/attachments':{readAttachment:async file=>({name:file.name,mime:'audio/webm',data:'synthetic-audio-only'})},
    './cipher/BinaryLens':{__esModule:true,default:'binary-lens'},'./cipher/CypherMark':{__esModule:true,default:'cypher-mark'},
    '../lib/voice-playback':{playVoiceResponse:async(response,audio,signal,onStarted)=>onStarted(),speakWithBrowser:async()=>assert.fail('No fallback expected')},
    '../lib/voice-activity':{VoiceSilenceTimer:class {update(){return true;}}},
  };
  const {ChatPanel}=load('../src/components/ChatPanel.tsx',imports,{...env.globals,AudioContext,MediaRecorder,Blob,File,
    crypto:{randomUUID:()=> 'incoming-a'},performance:{now:()=>env.time.now},
    requestAnimationFrame:callback=>{frame=callback;return 1;},cancelAnimationFrame:()=>{frame=undefined;},
    fetch:async(url,options)=>{assert.equal(url,'/api/voice');spoken.push(JSON.parse(options.body).text);return {ok:true};},
  });
  view.mount(()=>ChatPanel({bot,room:null,bots:[bot],voiceMode,voiceStream:stream,onVoiceStop(){},onVoiceStream(){},onCreateBot(){},onCreateRoom(){},onOpenRecent(){},onQuickStart:async()=>{},onOpenLounge:async()=>{}}));
  return {env,view,spoken,get syncs(){return syncs;},
    async send(){await view.flush();amplitude=160;frame();await view.flush();amplitude=128;frame();await view.flush();await view.flush();},
    async refresh(nextPhase,nextStatus=status){phase=nextPhase;status=nextStatus;env.window.dispatchEvent(new Event('grokbot:refresh'));await view.flush();},
    setPhase(nextPhase){phase=nextPhase;},
    async stop(){voiceMode=false;view.rerender();await view.flush();},
    async switchConversation(){phase='idle';bot={...bot,id:'agent-b',name:'Writer'};view.rerender();await view.flush();},
  };
}

test('a completed sync without the final message waits and speaks the later reply exactly once',async()=>{
  const app=voiceChat();await app.send();
  assert.equal(app.spoken.length,0);
  assert.doesNotMatch(textOf(app.view.tree),/could not return a spoken answer/,'the transient completed/no-message snapshot must not discard the pending voice turn');
  app.setPhase('page');app.env.time.advance(1500);await app.view.flush();
  assert.equal(app.spoken.length,0,'a full incremental activity page is not the exact task final reply');
  app.setPhase('reply');app.env.time.advance(1500);await app.view.flush();
  assert.deepEqual(app.spoken,['A final answer after the sync caught up.']);
  await app.refresh('reply');
  assert.equal(app.spoken.length,1,'repeated syncs cannot replay the spoken reply');
  app.view.unmount();
});

test('a later message from a different task cannot satisfy the pending voice turn',async()=>{
  const app=voiceChat();await app.send();await app.refresh('wrong-task');
  assert.equal(app.spoken.length,0);
  assert.doesNotMatch(textOf(app.view.tree),/could not return a spoken answer/);
  await app.refresh('reply');
  assert.deepEqual(app.spoken,['A final answer after the sync caught up.']);
  app.view.unmount();
});

test('legacy replies without a task ID stay unspoken and finish at the same bounded deadline',async()=>{
  const app=voiceChat();await app.send();await app.refresh('legacy-reply');
  assert.equal(app.spoken.length,0);
  assert.doesNotMatch(textOf(app.view.tree),/could not return a spoken answer/);
  app.env.time.advance(15000);await app.view.flush();
  assert.equal(app.spoken.length,0);
  assert.match(textOf(app.view.tree),/could not return a spoken answer/);
  app.view.unmount();
});

test('changing conversation cancels the prior pending turn and its completion deadline',async()=>{
  const app=voiceChat();await app.send();await app.switchConversation();
  await app.refresh('reply');app.env.time.advance(20000);await app.view.flush();
  assert.equal(app.spoken.length,0);
  assert.doesNotMatch(textOf(app.view.tree),/could not return a spoken answer/);
  app.view.unmount();
  assert.equal(app.env.time.pending,0);
  assert.equal(app.view.updatesAfterUnmount,0);
});

test('unmounting during the consistency wait cancels the deadline without state updates',async()=>{
  const app=voiceChat();await app.send();app.view.unmount();app.env.time.advance(20000);await app.view.flush();
  assert.equal(app.spoken.length,0);
  assert.equal(app.env.time.pending,0);
  assert.equal(app.view.updatesAfterUnmount,0);
});

test('incremental sync preserves the server task ID used to identify the voice reply',async()=>{
  const {api}=load('../src/lib/api.ts',{'./conversations':{}},{process:{env:{}},AbortSignal,
    fetch:async()=>({ok:true,json:async()=>({messages:[{id:'reply-a',conversation_id:'conversation-a',sender_type:'bot',message_type:'text',content:'Exact task reply',created_at:'2026-10-27T12:00:00Z',metadata_json:{task_id:'task-a'}}],tasks:[]})})});
  const snapshot=await api.syncConversation('conversation-a');
  assert.equal(snapshot.messages[0].taskId,'task-a');
});

test('completed-without-reply recovery is bounded and returns to listening with an honest error',async()=>{
  const app=voiceChat();await app.send();
  assert.doesNotMatch(textOf(app.view.tree),/could not return a spoken answer/);
  for(let poll=0;poll<10;poll++){
    app.env.time.advance(1500);await app.view.flush();
    if(poll<9)assert.doesNotMatch(textOf(app.view.tree),/could not return a spoken answer/);
  }
  assert.equal(app.spoken.length,0);
  assert.match(textOf(app.view.tree),/could not return a spoken answer/);
  assert.match(textOf(app.view.tree),/Listening/);
  app.view.unmount();
});

test('stopping voice during the consistency wait prevents late audio and clears its timer',async()=>{
  const app=voiceChat();await app.send();await app.stop();await app.refresh('reply');
  app.env.time.advance(20000);await app.view.flush();
  assert.equal(app.spoken.length,0);
  app.view.unmount();
  assert.equal(app.env.time.pending,0);
  assert.equal(app.view.updatesAfterUnmount,0);
});

for(const status of ['failed','cancelled','interrupted'])test(`${status} without a reply does not wait for a completed-message race`,async()=>{
  const app=voiceChat();await app.send();await app.refresh('completed-without-message',status);
  assert.match(textOf(app.view.tree),/could not return a spoken answer/);
  await app.refresh('reply');assert.equal(app.spoken.length,0);
  app.view.unmount();
});
