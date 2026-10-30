import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Blob,File} from 'node:buffer';
import {environment,renderer,load,find,textOf} from './support/component-harness.mjs';

const progressNotice='I’m still working on your request. I’ll let you know when it’s ready.';
function voiceChat({initialStatus='completed',holdPlayback=false,failNotice=false,pausedInitially=false,holdNoticeHeaders=false,holdBrowserSpeech=false,existingTrack}={}) {
  const env=environment(),view=renderer(env),spoken=[];
  let phase='idle',status=initialStatus,voiceMode=true,frame,amplitude=128,syncs=0;
  const playbacks=[],noticeHeaders=[],browserSpeech=[];if(failNotice)env.window.speechSynthesis={cancel(){}};let vadStarts=0;const makeTrack=enabled=>Object.assign(new EventTarget(),{enabled,readyState:'live',stop(){this.readyState='ended';}});let track=existingTrack||makeTrack(!pausedInitially);
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
  const makeStream=input=>({getAudioTracks:()=>[input]});let stream=makeStream(track);
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
    '../lib/voice-playback':{playVoiceResponse:async(response,audio,signal,onStarted)=>{
      onStarted();if(!holdPlayback)return;
      await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});playbacks.push({signal,finish(){signal.removeEventListener('abort',abort);resolve();}});});
    },speakWithBrowser:async(text,signal)=>{if(!failNotice)assert.fail('No fallback expected');if(!holdBrowserSpeech)throw Error('Progress speech unavailable');await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});browserSpeech.push({text,signal,finish:resolve});});}},
    '../lib/voice-activity':{VoiceSilenceTimer:class {constructor(){vadStarts++;}update(){return true;}}},
  };
  const {ChatPanel}=load('../src/components/ChatPanel.tsx',imports,{...env.globals,AudioContext,MediaRecorder,Blob,File,
    crypto:{randomUUID:()=> 'incoming-a'},performance:{now:()=>env.time.now},
    requestAnimationFrame:callback=>{frame=callback;return 1;},cancelAnimationFrame:()=>{frame=undefined;},
    fetch:async(url,options)=>{assert.equal(url,'/api/voice');const text=JSON.parse(options.body).text;spoken.push(text);if(holdNoticeHeaders&&text===progressNotice)return new Promise(resolve=>noticeHeaders.push({signal:options.signal,release:()=>resolve({ok:true})}));return failNotice&&text===progressNotice?{ok:false,json:async()=>({detail:'Progress speech unavailable'})}:{ok:true};},
  });
  view.mount(()=>ChatPanel({bot,room:null,bots:[bot],voiceMode,voiceStream:stream,onVoiceStop(){},onVoiceStream(){},onCreateBot(){},onCreateRoom(){},onOpenRecent(){},onQuickStart:async()=>{},onOpenLounge:async()=>{}}));
  return {env,view,spoken,get track(){return track;},playbacks,noticeHeaders,browserSpeech,get vadStarts(){return vadStarts;},startAnotherCapture(){amplitude=160;frame();amplitude=128;},get syncs(){return syncs;},
    async send(){await view.flush();amplitude=160;frame();await view.flush();amplitude=128;frame();await view.flush();await view.flush();},
    async refresh(nextPhase,nextStatus=status){phase=nextPhase;status=nextStatus;env.window.dispatchEvent(new Event('grokbot:refresh'));await view.flush();},
    setPhase(nextPhase){phase=nextPhase;},
    async stop(){voiceMode=false;track.stop();view.rerender();await view.flush();},
    async replaceStream(enabled=true){track=makeTrack(enabled);stream=makeStream(track);view.rerender();await view.flush();},
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


test('long voice work announces once, keeps input paused, then speaks the final answer and resumes',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();
 assert.equal(app.track.enabled,false);assert.match(textOf(app.view.tree),/Microphone paused/);
 app.env.time.advance(2999);await app.view.flush();assert.deepEqual(app.spoken,[]);
 app.env.time.advance(1);await app.view.flush();assert.deepEqual(app.spoken,[progressNotice]);
 assert.match(textOf(app.view.tree),/Progress update/);assert.equal(app.track.enabled,false);
 app.playbacks[0].finish();await app.view.flush();assert.match(textOf(app.view.tree),/Cypher is thinking/);assert.equal(app.track.enabled,false);
 app.env.time.advance(9000);await app.view.flush();assert.deepEqual(app.spoken,[progressNotice]);
 await app.refresh('reply','completed');assert.equal(app.playbacks.length,2);assert.equal(app.track.enabled,false);
 app.playbacks[1].finish();await app.view.flush();assert.equal(app.track.enabled,true);assert.match(textOf(app.view.tree),/Listening/);
 assert.deepEqual(app.spoken,[progressNotice,'A final answer after the sync caught up.']);app.view.unmount();
});
test('the final reply interrupts an in-flight progress notice without returning to listening early',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 const notice=app.playbacks[0];assert.ok(notice);await app.refresh('reply','completed');
 assert.equal(notice.signal.aborted,true);assert.equal(app.playbacks.length,2);assert.equal(app.track.enabled,false);
 app.playbacks[1].finish();await app.view.flush();assert.equal(app.track.enabled,true);
 app.env.time.advance(10000);await app.view.flush();assert.equal(app.spoken.length,2);app.view.unmount();
});
test('short work never announces a long-work notice',async()=>{
 const app=voiceChat();await app.send();await app.refresh('reply');app.env.time.advance(6000);await app.view.flush();
 assert.deepEqual(app.spoken,['A final answer after the sync caught up.']);assert.equal(app.track.enabled,true);app.view.unmount();
});
test('stopping before the notice deadline prevents the notice and leaves ended input stopped',async()=>{
 const app=voiceChat({initialStatus:'running'});await app.send();await app.stop();app.env.time.advance(6000);await app.view.flush();
 assert.deepEqual(app.spoken,[]);assert.equal(app.track.readyState,'ended');assert.equal(app.track.enabled,false);app.view.unmount();assert.equal(app.env.time.pending,0);
});
test('changing conversation during a notice cancels it and cannot speak a stale final reply',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 const notice=app.playbacks[0];assert.ok(notice);await app.switchConversation();assert.equal(notice.signal.aborted,true);
 assert.equal(app.track.enabled,false);assert.match(textOf(app.view.tree),/Restart voice/);await app.refresh('reply','completed');assert.deepEqual(app.spoken,[progressNotice]);assert.equal(app.track.enabled,false);app.view.unmount();
});
test('unmounting a notice aborts audio and its timer without late state updates',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 const notice=app.playbacks[0];assert.ok(notice);app.view.unmount();app.env.time.advance(6000);await app.view.flush();
 assert.equal(notice.signal.aborted,true);assert.equal(app.env.time.pending,0);assert.equal(app.view.updatesAfterUnmount,0);
});
test('a failed progress notice keeps work pending and does not prevent the final voice answer',async()=>{
 const app=voiceChat({initialStatus:'running',failNotice:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 assert.match(textOf(app.view.tree),/Cypher is thinking/);assert.equal(app.track.enabled,false);
 await app.refresh('reply','completed');assert.deepEqual(app.spoken,[progressNotice,'A final answer after the sync caught up.']);assert.equal(app.track.enabled,true);
 assert.doesNotMatch(textOf(app.view.tree),/Progress speech unavailable/);app.view.unmount();
});
test('voice monitoring never enables a track that was already disabled by its owner',async()=>{
 const app=voiceChat({pausedInitially:true});await app.view.flush();assert.equal(app.track.enabled,false);app.view.unmount();assert.equal(app.track.enabled,false);
});

test('a final reply supersedes delayed notice headers and late headers cannot start or clear final audio',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true,holdNoticeHeaders:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 assert.equal(app.noticeHeaders.length,1);assert.equal(app.playbacks.length,0);
 await app.refresh('reply','completed');assert.equal(app.noticeHeaders[0].signal.aborted,true);assert.equal(app.playbacks.length,1);
 app.noticeHeaders[0].release();await app.view.flush();assert.equal(app.playbacks.length,1);assert.match(textOf(app.view.tree),/Cypher is speaking/);assert.equal(app.track.enabled,false);
 app.playbacks[0].finish();await app.view.flush();assert.equal(app.track.enabled,true);app.view.unmount();
});
test('Stop while notice headers are pending prevents late playback and input resume',async()=>{
 const app=voiceChat({initialStatus:'running',holdNoticeHeaders:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 await app.stop();assert.equal(app.noticeHeaders[0].signal.aborted,true);app.noticeHeaders[0].release();await app.view.flush();
 assert.equal(app.playbacks.length,0);assert.equal(app.track.enabled,false);assert.equal(app.track.readyState,'ended');app.view.unmount();assert.equal(app.view.updatesAfterUnmount,0);
});
test('Stop during a playing notice aborts it and prevents a later final voice reply',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 await app.stop();assert.equal(app.playbacks[0].signal.aborted,true);await app.refresh('reply','completed');
 assert.deepEqual(app.spoken,[progressNotice]);assert.equal(app.track.enabled,false);app.view.unmount();assert.equal(app.env.time.pending,0);
});
test('terminal task failure aborts a playing notice and returns to listening with the task error',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 const notice=app.playbacks[0];await app.refresh('completed-without-message','failed');
 assert.equal(notice.signal.aborted,true);assert.match(textOf(app.view.tree),/could not return a spoken answer/);assert.equal(app.track.enabled,true);app.view.unmount();
});
test('input resumes with a fresh VAD for the next capture after quiet work and final playback',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();assert.equal(app.vadStarts,1);
 await app.refresh('reply','completed');app.playbacks[0].finish();await app.view.flush();assert.equal(app.track.enabled,true);
 app.startAnotherCapture();assert.equal(app.vadStarts,2);app.view.unmount();
});
test('a cancellation request stops a progress notice while input stays paused until cancellation settles',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 const notice=app.playbacks[0];await app.refresh('completed-without-message','cancel_requested');
 assert.equal(notice.signal.aborted,true);assert.match(textOf(app.view.tree),/Cypher is thinking/);assert.equal(app.track.enabled,false);
 await app.refresh('completed-without-message','cancelled');assert.equal(app.track.enabled,true);assert.match(textOf(app.view.tree),/could not return a spoken answer/);app.view.unmount();
});

test('the final answer supersedes a browser-fallback notice without a late input resume',async()=>{
 const app=voiceChat({initialStatus:'running',failNotice:true,holdBrowserSpeech:true,holdPlayback:true});await app.send();app.env.time.advance(3000);await app.view.flush();
 assert.equal(app.browserSpeech.length,1);assert.match(textOf(app.view.tree),/Progress update/);assert.equal(app.track.enabled,false);
 await app.refresh('reply','completed');assert.equal(app.browserSpeech[0].signal.aborted,true);assert.equal(app.playbacks.length,1);assert.equal(app.track.enabled,false);
 app.playbacks[0].finish();await app.view.flush();assert.equal(app.track.enabled,true);assert.doesNotMatch(textOf(app.view.tree),/spoken progress update could not be played/);app.view.unmount();
});

test('unmount during quiet work leaves its live input paused without late speech or state updates',async()=>{
 const app=voiceChat({initialStatus:'running'});await app.send();const old=app.track;assert.equal(old.enabled,false);
 app.view.unmount();app.env.time.advance(6000);await app.view.flush();assert.equal(old.enabled,false);assert.equal(old.readyState,'live');assert.deepEqual(app.spoken,[]);assert.equal(app.view.updatesAfterUnmount,0);
});
test('teardown does not mutate input that was already listening',async()=>{
 const app=voiceChat();await app.view.flush();assert.equal(app.track.enabled,true);app.view.unmount();assert.equal(app.track.enabled,true);assert.equal(app.track.readyState,'live');
});
test('stream replacement leaves the old input paused and allows only the fresh enabled stream to listen',async()=>{
 const app=voiceChat({initialStatus:'running',holdNoticeHeaders:true});await app.send();app.env.time.advance(3000);await app.view.flush();const old=app.track;
 await app.replaceStream();assert.equal(old.enabled,false);assert.equal(app.track.enabled,true);assert.equal(app.noticeHeaders[0].signal.aborted,true);
 app.noticeHeaders[0].release();await app.view.flush();assert.equal(old.enabled,false);assert.equal(app.track.enabled,true);assert.equal(app.playbacks.length,0);app.startAnotherCapture();assert.equal(app.vadStarts,2);assert.equal(old.enabled,false);app.view.unmount();
});
test('replacing input with an owner-disabled stream never silently enables it',async()=>{
 const app=voiceChat({initialStatus:'running'});await app.send();const old=app.track;await app.replaceStream(false);
 assert.equal(old.enabled,false);assert.equal(app.track.enabled,false);assert.match(textOf(app.view.tree),/Restart voice/);app.view.unmount();assert.equal(app.track.enabled,false);
});
test('keyed conversation remount with the same paused stream requires an explicit voice restart',async()=>{
 const first=voiceChat({initialStatus:'running'});await first.send();const track=first.track;first.view.unmount();assert.equal(track.enabled,false);
 const next=voiceChat({existingTrack:track});await next.view.flush();assert.equal(track.enabled,false);assert.match(textOf(next.view.tree),/Restart voice/);next.view.unmount();assert.equal(track.enabled,false);
});
test('teardown preserves ended input and active-session final answer resume still works',async()=>{
 const stopped=voiceChat();await stopped.view.flush();stopped.track.stop();assert.equal(stopped.track.enabled,true);stopped.view.unmount();assert.equal(stopped.track.enabled,true);assert.equal(stopped.track.readyState,'ended');
 const active=voiceChat({initialStatus:'running',holdPlayback:true});await active.send();await active.refresh('reply','completed');assert.equal(active.track.enabled,false);
 active.playbacks[0].finish();await active.view.flush();assert.equal(active.track.enabled,true);active.view.unmount();assert.equal(active.track.enabled,true);
});
test('a track that ends while work is pending is never presented as listening after the final answer',async()=>{
 const app=voiceChat({initialStatus:'running',holdPlayback:true});await app.send();app.track.stop();await app.refresh('reply','completed');
 app.playbacks[0].finish();await app.view.flush();assert.equal(app.track.enabled,false);assert.equal(app.track.readyState,'ended');assert.match(textOf(app.view.tree),/Restart voice/);app.view.unmount();
});
