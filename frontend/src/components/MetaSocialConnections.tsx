'use client';
import {useEffect,useRef,useState} from 'react';
import CypherMark from './cipher/CypherMark';
import {approveConnection} from '../lib/device';

type Saved={id:string;name:string;url:string;enabled:boolean;authenticated:boolean;connection_id?:string|null};
type Service={id:string;name:string;available:boolean;account_count:number|null;status:string;data_access_verified:false};
type Authorization={service:string;authorization_url:string;notes:string};
const names:Record<string,string>={facebook_organic:'Facebook Pages',instagram:'Instagram'};
const hosts=['onboard.windsor.ai','api.windsor.ai','mcp.windsor.ai','www.facebook.com','facebook.com','business.facebook.com','www.instagram.com','instagram.com','api.instagram.com'];
function providerUrl(value:unknown,allowed=hosts){
  try {const url=new URL(typeof value==='string'?value:'');return url.protocol==='https:'&&allowed.includes(url.hostname)&&!url.username&&!url.password&&(!url.port||url.port==='443')?url.href:null;}catch{return null;}
}
function isWindsor(item:Saved){try{const url=new URL(item.url);return url.protocol==='https:'&&url.hostname==='mcp.windsor.ai'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&!url.search&&!url.hash;}catch{return false;}}

export function MetaSocialConnections({result=''}:{result?:string}={}){
  const [connections,setConnections]=useState<Saved[]>([]),[selected,setSelected]=useState('');
  const [services,setServices]=useState<Service[]|null>(null),[authorization,setAuthorization]=useState<Authorization|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const mounted=useRef(false),pending=useRef(false),sequence=useRef(0),request=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;request.current?.abort();};},[]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();setLoading(true);setServices(null);setAuthorization(null);
    fetch('/api/plugins',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(async response=>{
      if(!response.ok)throw Error('Your saved connections could not load. Sign in again or retry.');
      const data=await response.json();if(!Array.isArray(data))throw Error('Your saved connections could not load.');
      if(!active)return;const saved=data.filter(isWindsor);setConnections(saved);setSelected(current=>saved.some(item=>item.id===current)?current:saved.length===1?saved[0].id:'');setError('');
    }).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Your saved connections could not load.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[attempt]);
  const connection=connections.find(item=>item.id===selected);
  function choose(value:string){sequence.current++;request.current?.abort();pending.current=false;setSelected(value);setServices(null);setAuthorization(null);setBusy('');setError('');}
  async function run(action:'inspect'|'authorize'|'windsor',service?:string){
    if(pending.current||action!=='windsor'&&(!connection?.enabled||!connection.authenticated))return;
    const current=++sequence.current;pending.current=true;setBusy(service||action);setError('');setAuthorization(null);
    const controller=new AbortController();request.current=controller;
    try{
      let response:Response;
      const options={method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])};
      if(action==='windsor'){
        if(connection&&!connection.connection_id&&connections.filter(item=>item.url===connection.url).length>1)throw Error('Several saved connections use this address. Reconnect the intended account from My apps.');
        const url=connection?.url||'https://mcp.windsor.ai/';const approval_id=await approveConnection('connect_plugin:'+url);
        if(!mounted.current||current!==sequence.current)return;
        response=await fetch('/api/plugins/authorize',{...options,referrer:window.location.origin+'/connect/meta',body:JSON.stringify({name:'Windsor.ai',url,approval_id,reconnect:!!connection,...(connection?.connection_id?{connection_id:connection.connection_id}:{})})});
      }else response=await fetch(`/api/plugins/${encodeURIComponent(selected)}/meta/${action}`,{...options,body:JSON.stringify(action==='authorize'?{service}:{})});
      const data=await response.json();
      if(!mounted.current||current!==sequence.current)return;
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'The connection request could not finish.');
      if(action==='windsor'){
        if(data.status==='connected'){setAttempt(value=>value+1);return;}
        const url=providerUrl(data.authorization_url,['onboard.windsor.ai','api.windsor.ai','mcp.windsor.ai']);
        if(!url)throw Error('Windsor did not return a supported sign-in address.');
        window.location.assign(url);return;
      }
      if(action==='inspect'){
        if(!Array.isArray(data.services)||data.services.length!==2||new Set(data.services.map((item:Service)=>item.id)).size!==2||data.services.some((item:Service)=>!Object.hasOwn(names,item.id)||item.data_access_verified!==false||typeof item.available!=='boolean'||item.account_count!==null&&(!Number.isInteger(item.account_count)||item.account_count<0)))throw Error('Meta account status could not be confirmed.');
        setServices(data.services);
      }else{
        const url=providerUrl(data.authorization_url);
        if(!url||data.service!==service||typeof data.notes!=='string'||data.data_access_verified!==false)throw Error('The provider authorization address could not be confirmed.');
        setAuthorization({service:service!,authorization_url:url,notes:data.notes});
      }
    }catch(failure){if(mounted.current&&current===sequence.current)setError(failure instanceof Error&&failure.name!=='AbortError'?failure.message:'The request stopped. Your existing permissions are unchanged.');}
    finally{if(current===sequence.current){pending.current=false;if(mounted.current)setBusy('');}}
  }
  return <main className="google-permissions-page"><a className="google-permissions-brand" href="/" aria-label="Cypher home"><CypherMark decorative/><span>Cypher</span></a><section className="google-permissions-content" aria-labelledby="meta-permissions-title">
    <h1 id="meta-permissions-title">Connect Facebook and Instagram</h1>
    <p className="google-permissions-intro">Choose which Pages and Instagram accounts Cypher can use through Windsor. Your password stays with the provider.</p>
    <p>Use the same Windsor account you connect to Cypher. Windsor’s account and plan limits apply. <a href="https://windsor.ai/privacy-policy/" target="_blank" rel="noopener noreferrer">Windsor privacy</a></p>
    {result==='cancelled'||result==='failed'?<p className="google-permissions-notice" role="status">Windsor sign-in was not completed. Your existing connections are unchanged.</p>:null}
    {loading?<p role="status">Loading your saved connections…</p>:null}
    {!loading&&(!connections.length||connection&&!connection.authenticated)?<section className="google-hosted-connection"><h2>Connect Windsor first</h2><p>Windsor manages the Facebook and Instagram permissions for this connection.</p><button type="button" className="btn-primary" disabled={!!busy} onClick={()=>void run('windsor')}>{busy==='windsor'?'Opening Windsor…':'Continue with Windsor'}</button></section>:null}
    {!loading&&connections.length>1?<label>Saved Windsor connection<select value={selected} disabled={!!busy} onChange={event=>choose(event.target.value)}><option value="">Choose a connection</option>{connections.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
    {!loading&&connection?.authenticated?<>
      {!connection.enabled?<p role="status">Enable this Windsor connection in My apps to manage permissions.</p>:null}
      <div className="google-permissions-actions"><button type="button" className="btn-secondary" disabled={!!busy||!connection.enabled} onClick={()=>void run('inspect')}>{busy==='inspect'?'Checking accounts…':'Check connected accounts'}</button><button type="button" className="btn-secondary" disabled={!!busy} onClick={()=>void run('windsor')}>{busy==='windsor'?'Opening Windsor…':'Reconnect Windsor'}</button></div>
      <div className="google-permissions-services">{Object.entries(names).map(([id,name])=>{
        const status=services?.find(item=>item.id===id);
        return <section key={id} className="google-permission-row"><div><h2>{name}</h2><p>{status?.status==='accounts_listed'?`${status.account_count} account${status.account_count===1?'':'s'} listed. Data access has not been tested.`:status?.status==='not_connected'?'No account selected yet.':status&&!status.available?'This connector is not available in the current catalog.':'Check accounts to see your current selections.'}</p><button type="button" className="btn-secondary" disabled={!!busy||!connection.enabled||status?.available===false} onClick={()=>void run('authorize',id)}>{busy===id?'Preparing…':status?.account_count?'Add or reconnect':`Connect ${name}`}</button></div></section>;
      })}</div>
    </>:null}
    {authorization?<section className="google-hosted-connection" aria-labelledby="meta-allow-title"><h2 id="meta-allow-title">Allow {names[authorization.service]} access</h2>{authorization.notes?<p style={{whiteSpace:'pre-wrap'}}>{authorization.notes}</p>:null}<p>Choose your accounts on the provider’s permission screen. Return here afterwards and check connected accounts.</p><a className="btn-primary" href={authorization.authorization_url} target="_blank" rel="noopener noreferrer">Continue to provider</a></section>:null}
    {error?<div className="google-permissions-error" role="alert"><p>{error}</p>{!busy?<button type="button" className="btn-secondary" onClick={()=>setAttempt(value=>value+1)}>Reload saved connections</button>:null}</div>:null}
    <p className="google-permissions-help">Listed accounts do not prove a successful data read. These permissions are separate from Meta model access. Connecting does not publish posts or change campaigns.</p>
    <div className="google-permissions-actions"><a href="/">Continue to workspace</a></div>
  </section></main>;
}
