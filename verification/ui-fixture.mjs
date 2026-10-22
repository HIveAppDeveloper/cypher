// Synthetic API only. No models, credentials, storage, or external services.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const repo=resolve(import.meta.dirname,'..');
const bots=['Coordinator','Researcher','Builder','Writer'].map((name,i)=>({id:`synthetic-${i}`,name,role:name,description:'Synthetic UI fixture',status:'idle',llm_provider:'openai',llm_model:'gpt-6.1-sol',tools_enabled:['browser'],system_prompt:'Synthetic fixture'}));
let scenario='home',posts=[],failNext=false,jobs=[],messages=[];
const rooms=bots.map(b=>({id:`chat-${b.id}`,title:`Bot ${b.id}`,is_group:false,bot_ids:[b.id]}));
const json=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||'{}');}catch{}
 const url=new URL(req.url,'http://127.0.0.1');const path=url.pathname.replace(/^\/api/,'');
 if(path==='/__ui/state')return json(res,{scenario,posts,jobs,messages});
 if(path==='/__ui/scenario') {scenario=body.mode||'home';failNext=!!body.failNext;jobs=[];messages=[];return json(res,{ok:true});}
 if(path==='/bots'&&req.method==='GET')return json(res,bots);
 if(path==='/bots'&&req.method==='POST'){posts.push({path,body});await new Promise(r=>setTimeout(r,800));const b={...body,name:body.name||body.role,id:`created-${body.client_request_id}`,status:'idle'};bots.push(b);rooms.push({id:`chat-${b.id}`,title:`Bot ${b.id}`,is_group:false,bot_ids:[b.id]});return json(res,b);}
 if(path==='/conversations')return json(res,rooms);
 if(path.startsWith('/conversations/')&&path.endsWith('/sync')) {if(scenario==='loading')await new Promise(r=>setTimeout(r,2200));if(scenario==='sync-error')return json(res,{detail:'Synthetic offline fixture'},503); const id=path.split('/')[2]; const sample=scenario==='conversation'?[{id:'sample-1',conversation_id:id,sender_type:'bot',sender_bot_id:'synthetic-0',content:'I can help with that. I’ll start with the outcome, check the available sources, and bring you a clear next step.\n\nThis is a **synthetic UI fixture**, with no model call.',message_type:'text',created_at:'2026-10-22T01:00:00Z'},{id:'sample-2',conversation_id:id,sender_type:'user',content:'Give me a concise plan with sources I can open.',message_type:'text',created_at:'2026-10-22T00:59:00Z'}]:[];return json(res,{messages:[...messages,...sample].reverse(),tasks:jobs});}
 if(path.endsWith('/messages')&&req.method==='POST'){posts.push({path,body});await new Promise(r=>setTimeout(r,600));if(failNext){failNext=false;return json(res,{detail:'Synthetic connection interrupted. Retry your saved message.'},502);}const id=path.split('/')[2];messages.push({id:body.client_message_id,conversation_id:id,sender_type:'user',content:body.content,message_type:'text',metadata_json:{attachments:body.attachments||[]},created_at:new Date().toISOString()});jobs=[{id:'synthetic-job',title:body.content,status:'running',created_at:new Date().toISOString()}];return json(res,{task_id:'synthetic-job'});}
 if(path.endsWith('/cancel')){posts.push({path,body});jobs=jobs.map(j=>({...j,status:'cancelled'}));return json(res,{ok:true});}
 if(path.endsWith('/steer')){posts.push({path,body});return json(res,{status:'accepted'});}
 if(path.endsWith('/tasks'))return json(res,jobs);
 if(path==='/workspace/settings')return json(res,{});
 if(path==='/plugins/catalog'||path==='/plugins/available-connections'||path==='/plugins')return json(res,[]);
 if(path==='/plugins/catalog/sync')return json(res,null);
 if(path==='/computer/approvals/pending')return json(res,[]);
 if(path.endsWith('/context'))return json(res,[]);
 return json(res,{});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const apiPort=server.address().port;
// Allowlist environment: do not inherit any account credentials. Loopback egress guard
// covers Next's proxy; source app code and production security config are unchanged.
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',BACKEND_INTERNAL_URL:`http://127.0.0.1:${apiPort}`,NODE_OPTIONS:`--require=${repo}/verification/creation-loopback-only.cjs`};
const child=spawn(process.execPath,[`${repo}/frontend/node_modules/next/dist/bin/next`,'start','-H','127.0.0.1','-p','4317'],{cwd:`${repo}/frontend`,env,stdio:['ignore','inherit','inherit']});
console.log(JSON.stringify({frontend:'http://127.0.0.1:4317',api:`http://127.0.0.1:${apiPort}`,synthetic:true}));
function stop(){child.kill('SIGTERM');server.close();}process.on('SIGTERM',stop);process.on('SIGINT',stop);
