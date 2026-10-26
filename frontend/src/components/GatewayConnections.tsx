'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ModelConnection } from './ModelConnections';
import { GatewayProviderLogo } from './GatewayProviderLogo';
import { connectionBeginPath, gatewayProviders, providerConnectionLabel, providerConsentUrl } from '../lib/gateway-connections.mjs';

export type GatewayConnection=ModelConnection&{account_connected?:boolean;can_connect?:boolean;connect_url?:string;verification_scope?:string;model_access_verified?:boolean;verification_supported?:boolean;access_kind?:'account'|'api_key'|'public'};
const Arrow=()=> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>;

export function GatewayConnections({items,canManage,workerReady,preview=false,onRefresh}:{items:GatewayConnection[];canManage:boolean;workerReady:boolean;preview?:boolean;onRefresh:()=>Promise<void>}){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('All providers'),[selected,setSelected]=useState(''),[apiKey,setApiKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const pending=useRef(false),controller=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if(selected){heading.current?.focus({preventScroll:true});heading.current?.closest('.gw-content')?.scrollTo({top:0});}},[selected]);
  const provider=gatewayProviders.find(p=>p.id===selected),item=items.find(p=>p.id===selected);
  const mayWrite=canManage&&!preview;
  const begin=item?connectionBeginPath(item):null;
  const choose=(id:string)=>{controller.current?.abort();pending.current=false;setBusy(false);setSelected(id);setApiKey('');setError('');setMessage('');};
  useEffect(()=>{
    if(!selected||preview||item?.state!=='checking')return;
    const timer=setInterval(()=>void onRefresh(),3000);return()=>clearInterval(timer);
  },[selected,item?.state,preview,onRefresh]);
  async function submit(action:'connect'|'api-key'|'verify',event?:FormEvent){
    event?.preventDefault();
    if(pending.current||!provider||!mayWrite||!item)return;
    if(action==='connect'&&!begin)return;
    if(action==='api-key'&&(!item.can_add_api_key||!apiKey.trim()))return;
    if(action!=='connect'&&!workerReady)return;
    pending.current=true;setBusy(true);setError('');setMessage('');
    controller.current?.abort();const request=new AbortController();controller.current=request;
    const key=apiKey.trim();setApiKey('');
    try{
      const response=await fetch(action==='connect'?begin!:`/api/runtime/model-connections/${provider.id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},signal:request.signal,...(action==='api-key'?{body:JSON.stringify({api_key:key})}:action==='connect'?{body:JSON.stringify({returnTo:'/gateway'})}:{body:JSON.stringify({target:provider.id==='meta'?'current_route':'provider_account'})})});
      const data=await response.json().catch(()=>({}));if(request.signal.aborted)return;
      if(!response.ok)throw new Error(response.status===401?'Sign in again to connect this account.':typeof data.detail==='string'?data.detail:'The connection could not start. Please try again.');
      if(action==='connect'){
        const destination=providerConsentUrl(provider.id,data.authorization_url);
        if(!destination)throw new Error('The provider sign-in address could not be confirmed. Nothing has been connected.');
        window.location.assign(destination);return;
      }
      if(!['pending','running'].includes(data.status))throw new Error('The connection check was not confirmed. Refresh its status before trying again.');
      setMessage('Checking in the cloud. You can leave this page; your status will update here.');await onRefresh();
    }catch(failure){if(!request.signal.aborted)setError(failure instanceof Error?failure.message:'The connection could not start. Please try again.');}
    finally{if(!request.signal.aborted){pending.current=false;setBusy(false);}}
  }
  return <section className="gc-connections" aria-label="Model provider connections">
    {provider?<>
      <button className="gc-back" onClick={()=>choose('')}><span aria-hidden="true">←</span> All providers</button>
      <section className="gc-detail" aria-labelledby="gc-detail-title">
        <header><GatewayProviderLogo logo={provider.logo} size={64}/><div><h2 ref={heading} tabIndex={-1} id="gc-detail-title">Connect {provider.name}</h2><p>{provider.company}</p></div><span className="gc-status" data-state={!preview&&item?.account_connected?'connected':'neutral'}>{providerConnectionLabel(item,preview)}</span></header>
        {preview?<div className="gc-notice"><strong>You’re exploring the local preview.</strong><p>Real connections are made in your signed-in cloud workspace. Preview actions never change an account.</p><a className="gc-primary" href="https://cypher-agent.vercel.app/login">Open cloud workspace <Arrow/></a></div>:!canManage?<div className="gc-notice"><strong>Owner access needed</strong><p>The workspace owner manages shared model accounts. Sign in with that account to make changes.</p><a className="gc-primary" href="/login?returnTo=%2Fgateway">Sign in <Arrow/></a></div>:null}
        {begin&&mayWrite?<div className="gc-consent"><h3>Sign in with {provider.name}</h3><p>You’ll go directly to {provider.company} to review access, then return here. Your password stays with the provider.</p><button className="gc-primary" disabled={busy} onClick={()=>void submit('connect')}>{busy?'Opening provider…':`Continue with ${provider.name}`}<Arrow/></button></div>:<div className="gc-consent"><h3>{item?.can_add_api_key?'Connect with an API key':'Account sign-in is not enabled on this release'}</h3><p>{item?.can_add_api_key?'Add your provider key below. It is encrypted in the cloud; your existing working connection stays active if verification fails.':provider.id==='meta'?'A Meta consumer login does not grant model API access. Connect a Llama-compatible API provider to use these models.':'A direct account connection needs the cloud sign-in connector. Opening the provider’s website alone will not connect your account.'}</p></div>}
        {(item?.can_add_api_key||preview&&provider.keyUrl)?<form className="gc-key-form" onSubmit={event=>void submit('api-key',event)}>
          <label htmlFor="gc-provider-key">{provider.name} API key</label><input id="gc-provider-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} disabled={!mayWrite||busy} placeholder="Paste your API key" onChange={event=>setApiKey(event.target.value)}/>
          <p>Verification sends a small model request and may use provider credits. API billing is separate from a chat subscription.</p>
          <div className="gc-detail-actions"><button className="gc-primary" disabled={!mayWrite||!workerReady||busy||!apiKey.trim()} type="submit">{busy?'Connecting…':'Connect API key'}<Arrow/></button>{provider.keyUrl&&<a className="gc-secondary" href={provider.keyUrl} target="_blank" rel="noopener noreferrer">Get an API key <Arrow/></a>}</div>
        </form>:null}
        {!preview&&item?<div className="gc-saved"><h3>Current access</h3><p>{item.message}</p>{item.state==='ready'&&item.account_connected!==true?<p>A successful route check does not prove that your subscription account is connected.</p>:null}{item.verification_supported===false?<p>Model verification is not available for this connection.</p>:item.state==='checking'?<p role="status">Checking provider access…</p>:<button className="gc-text-button" disabled={busy||!mayWrite||!workerReady} onClick={()=>void submit('verify')}>Check model access</button>}<small>A model check may use your provider quota.</small></div>:null}
        {mayWrite&&!workerReady?<p className="gc-alert" role="status">The cloud worker is offline. Retry when it is ready.</p>:null}
        {error?<p role="alert" className="gc-alert">{error}</p>:null}{message?<p className="gc-notice" role="status">{message}</p>:null}
      </section>
    </>:<>
      <div className="gc-catalog-toolbar"><label className="gc-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search providers" aria-label="Search providers"/></label><span>Bring your accounts. Keep your choice.</span></div>
      <div className="gc-filters" role="group" aria-label="Filter providers">{['All providers','Subscriptions','API providers','Connected'].map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value}</button>)}</div>
      <div className="gc-provider-grid">{gatewayProviders.filter(p=>(filter==='All providers'||p.category===filter||filter==='Connected'&&!preview&&items.some(i=>i.id===p.id&&i.account_connected===true))&&`${p.name} ${p.company}`.toLowerCase().includes(query.toLowerCase())).map(p=>{
        const current=items.find(i=>i.id===p.id),label=providerConnectionLabel(current,preview);
        const browser=!!connectionBeginPath(current),key=current?.can_add_api_key===true;
        const action=current?.account_connected&&!preview?'Manage':!preview&&browser?'Connect':!preview&&key?'Add API key':'View setup';
        const method=browser?'Browser sign-in':p.id==='openai'||p.id==='claude'?'Account sign-in unavailable':key?'API key':p.id==='meta'?'Via an API provider':'Setup options';
        return <article key={p.id} className="gc-provider"><div className="gc-provider-top"><GatewayProviderLogo logo={p.logo} size={48}/><span className="gc-status" data-state={!preview&&current?.account_connected?'connected':'neutral'}>{label}</span></div><h2>{p.name}</h2><p className="gc-company">{p.company}</p><p className="gc-provider-description">{p.description}</p><div className="gc-provider-bottom"><span>{method}{key&&!browser&&(p.id==='claude'||p.id==='openai')?' · API key available':''}</span><button className="gc-card-action" data-provider={p.id} onClick={()=>choose(p.id)} aria-label={`${action} for ${p.name}`}>{action}<Arrow/></button></div></article>;
      })}</div>
      {!gatewayProviders.some(p=>(filter==='All providers'||p.category===filter||filter==='Connected'&&!preview&&items.some(i=>i.id===p.id&&i.account_connected===true))&&`${p.name} ${p.company}`.toLowerCase().includes(query.toLowerCase()))?<div className="gc-empty"><h2>{filter==='Connected'?'No connected accounts yet':'No providers found'}</h2><p>{filter==='Connected'?'Your authorized accounts will appear here.':'Try a different provider name.'}</p><button className="gc-secondary" onClick={()=>{setQuery('');setFilter('All providers')}}>Browse all providers</button></div>:null}
      <div className="gc-help-line"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/></svg><p>Credentials stay encrypted. You choose which accounts to connect. Provider plans and limits apply.</p></div>
    </>}
  </section>;
}
