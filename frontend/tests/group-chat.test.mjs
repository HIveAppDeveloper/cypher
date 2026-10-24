import test from 'node:test';
import assert from 'node:assert/strict';
import { load, renderer, environment, find, textOf } from './support/component-harness.mjs';
const stubs=Object.fromEntries(['./LoadingState','../lib/presets','./ContextPanel','./WorkPanel','./GlassSelect','../lib/types','../lib/api','./BotAvatar','./MessageBubble','./QuickStart','./RunControls','../lib/modelPolicy','../lib/attachments','./cipher/CypherMark'].map(name=>[name,{}]));
stubs['./cipher/CypherMark']={__esModule:true,default:'cypher-mark'};
const {messageTime,sameMessageGroup}=load('../src/components/ChatPanel.tsx',{...stubs,react:{}});
const msg=(createdAt,senderBotId='one',senderType='bot')=>({createdAt,senderBotId,senderType});
test('grouping treats naive backend timestamps as UTC and keeps explicit offsets',()=>{
 assert.equal(messageTime('2026-10-24T16:00:00').toISOString(),'2026-10-24T16:00:00.000Z');
 assert.equal(messageTime('2026-10-24T12:00:00-04:00').toISOString(),'2026-10-24T16:00:00.000Z');
 assert.equal(sameMessageGroup(msg('2026-10-24T16:00:00'),msg('2026-10-24T16:01:00Z')),true);
});
test('different senders, long gaps, reversed times and calendar days start fresh groups',()=>{
 const first=msg('2026-10-24T16:00:00Z');
 for(const next of [msg('2026-10-24T16:00:30Z','two'),msg('2026-10-24T16:00:30Z','one','user'),msg('2026-10-24T16:05:00Z'),msg('2026-10-24T15:59:00Z')])assert.equal(sameMessageGroup(first,next),false);
 assert.equal(sameMessageGroup(first,undefined),false);
 const late=new Date(2026,9,24,23,59).toISOString(),early=new Date(2026,9,25,0,0).toISOString();
 assert.equal(sameMessageGroup(msg(late),msg(early)),false);
});
test('Google status failure offers an explicit reload and recovers without starting consent',async()=>{
 const env=environment();const view=renderer(env);let requests=0;
 const {GoogleConnections}=load('../src/components/GoogleConnections.tsx',{react:view.react,'./cipher/CypherMark':{__esModule:true,default:'mark'},'../lib/device':{approveConnection:async()=>{throw Error('Unexpected consent');}}},{...env.globals,AbortController,React:view.react.default,fetch:async()=>{requests++;if(requests===1)throw Error('Offline');return {ok:true,json:async()=>({configured:true,connected:false,services:[],offline_access:false,tool_count:0,failures:{},choices:[]})};}});
 view.mount(()=>GoogleConnections({}));await view.flush();assert.match(textOf(view.tree),/Offline/);
 const retry=find(view.tree,node=>node.type==='button'&&textOf(node)==='Reload connections');assert.ok(retry);retry.props.onClick();await view.flush();await view.flush();
 assert.equal(requests,2);assert.doesNotMatch(textOf(view.tree),/Offline/);assert.ok(find(view.tree,node=>node.type==='button'&&textOf(node)==='Continue to Google'&&!node.props.disabled));view.unmount();
});

test('a stalled Google status check times out into the retry state',async()=>{
 const env=environment(),view=renderer(env);
 const {GoogleConnections}=load('../src/components/GoogleConnections.tsx',{react:view.react,'./cipher/CypherMark':{__esModule:true,default:'mark'},'../lib/device':{}},{...env.globals,AbortController,React:view.react.default,fetch:async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))});
 view.mount(()=>GoogleConnections({}));await view.flush();assert.match(textOf(view.tree),/Loading Google connections/);env.time.advance(15000);await view.flush();assert.match(textOf(view.tree),/timed out/);assert.ok(find(view.tree,node=>node.type==='button'&&textOf(node)==='Reload connections'));view.unmount();
});
test('hosted Google connection uses the existing protected plugin flow and validates its redirect',async()=>{
 const env=environment(),view=renderer(env);const requests=[],navigated=[];env.window.location={origin:'https://app.example',assign:url=>navigated.push(url)};
 const {GoogleConnections}=load('../src/components/GoogleConnections.tsx',{react:view.react,'./cipher/CypherMark':{__esModule:true,default:'mark'},'../lib/device':{approveConnection:async purpose=>{assert.equal(purpose,'connect_plugin:https://mcp.pipedream.net/v2');return 'approval-fixture';}}},{...env.globals,AbortController,URL,React:view.react.default,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url==='/api/google/status'?{configured:true,connected:false,services:[],offline_access:false,tool_count:0,failures:{},choices:[]}:{status:'awaiting_login',authorization_url:'https://mcp.pipedream.com/authorize?state=fixture'}};}});
 view.mount(()=>GoogleConnections({}));await view.flush();find(view.tree,node=>node.type==='button'&&textOf(node)==='Continue with Pipedream').props.onClick();await view.flush();await view.flush();
 assert.equal(requests[1].url,'/api/plugins/authorize');assert.equal(requests[1].options.referrer,'https://app.example/?workspace=1');assert.equal(JSON.parse(requests[1].options.body).url,'https://mcp.pipedream.net/v2');assert.deepEqual(navigated,['https://mcp.pipedream.com/authorize?state=fixture']);view.unmount();
});
