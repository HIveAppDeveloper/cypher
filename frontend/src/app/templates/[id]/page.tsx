'use client';
import { useEffect,useState } from 'react';
import { request } from '../../../lib/api';
interface Template {format:string;bot:{name:string;role:string;description:string;system_prompt:string;llm_model:string};notice:string}
export default function TemplatePage({params}:{params:{id:string}}){
 const [template,setTemplate]=useState<Template|null>(null),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;request('/workspace/templates/shared/'+encodeURIComponent(params.id)).then(data=>{if(active)setTemplate(data);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[params.id]);
 async function install(){if(!template)return;setBusy(true);setError('');try{await request('/workspace/templates/import',{method:'POST',body:JSON.stringify(template)});setStatus('Agent imported. Open your workspace and connect its required accounts in Plugins.');}catch(e){setError(e instanceof Error?e.message:'Sign in to import this agent.');}finally{setBusy(false);}}
 return <main className="login-page"><section className="login-card"><h1>{template?.bot.name||'Agent template'}</h1>{error?<p role="alert">{error}</p>:null}{!template&&!error?<p>Loading template…</p>:null}{template?<><p>{template.bot.description||template.bot.role}</p><p>Model: {template.bot.llm_model}</p><details><summary>Review agent instructions</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{template.bot.system_prompt}</pre></details><p>{template.notice}</p><p>Import only templates whose instructions you have reviewed. Your connected account permissions apply when you run the agent.</p><button disabled={busy} onClick={()=>void install()}>{busy?'Importing…':'Import into my workspace'}</button>{status?<p role="status">{status}</p>:null}</>:null}<p><a href="/login">Sign in</a> · <a href="/">Open workspace</a></p></section></main>;
}
