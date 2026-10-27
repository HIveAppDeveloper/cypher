'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { dateFromApi } from '../lib/dates';
import { GatewayProviderLogo } from './GatewayProviderLogo';
import { GatewayDeployment } from './GatewayDeployment';
import { CANONICAL_APP_ORIGIN } from '../lib/canonical-app';
import { companionSetup } from '../lib/gateway-hosting';

type Host='local'|'aws'|'azure';
type Device={id:string;name:string;paired:boolean;last_seen_at?:string;scopes:string[]};
const hosts:{id:Host;name:string;label:string;description:string;logo?:string;portal?:string;guide?:string}[]=[
  {id:'local',name:'This computer',label:'Mac, Windows, or Linux',description:'Use a computer you already own. No extra cloud hosting bill.'},
  {id:'aws',name:'Amazon Web Services',label:'Existing EC2 instance',description:'Pair a Linux machine in your AWS account.',logo:'aws',portal:'https://console.aws.amazon.com/systems-manager/session-manager/sessions',guide:'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html'},
  {id:'azure',name:'Microsoft Azure',label:'Existing virtual machine',description:'Pair a Linux VM in your Azure subscription.',logo:'azure-color',portal:'https://portal.azure.com/#browse/Microsoft.Compute%2FVirtualMachines',guide:'https://learn.microsoft.com/en-us/azure/virtual-machines/linux-vm-connect'},
];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function GatewayHosting({preview=false,cloudReady=false,accountId}:{preview?:boolean;cloudReady?:boolean;accountId?:string}){
  const [mode,setMode]=useState('computer'),[selected,setSelected]=useState<Host|null>(null),[os,setOs]=useState('Mac / Linux'),[name,setName]=useState('My computer'),[devices,setDevices]=useState<Device[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[pair,setPair]=useState<{id:string;code:string;expires:number}|null>(null),[notice,setNotice]=useState(''),[revoke,setRevoke]=useState('');
  const alive=useRef(true),pending=useRef(false),generation=useRef(0),loadVersion=useRef(0),requests=useRef<Set<AbortController>>(new Set()),title=useRef<HTMLHeadingElement>(null);
  const host=hosts.find(h=>h.id===selected),setup=companionSetup(CANONICAL_APP_ORIGIN);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;++generation.current;requests.current.forEach(r=>r.abort());requests.current.clear();}},[]);
  async function read(path:string,options:RequestInit={}){
    const request=new AbortController();requests.current.add(request);
    try{const response=await fetch('/api/local-device/'+path,{...options,cache:'no-store',signal:request.signal,headers:{'Content-Type':'application/json'}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(response.status===401||response.status===403?'Sign in to your cloud workspace to manage computers.':'Could not reach your computers. Retry in a moment.');return data;}finally{requests.current.delete(request);}
  }
  const load=useCallback(async()=>{
    if(preview||mode!=='computer')return;
    const version=generation.current,readVersion=++loadVersion.current;
    try{const data=await read('devices');if(!Array.isArray(data))throw new Error('Computer status could not be read. Retry in a moment.');if(!alive.current||version!==generation.current||readVersion!==loadVersion.current)return;setDevices(data.filter(d=>d&&uuid.test(d.id)&&typeof d.name==='string'&&typeof d.paired==='boolean').map(d=>({...d,scopes:Array.isArray(d.scopes)?d.scopes:[]})));setLoaded(true);setError('');}
    catch(failure){if(alive.current&&version===generation.current&&readVersion===loadVersion.current){setDevices([]);setLoaded(true);setError(failure instanceof Error?failure.message:'Could not read computer status.');}}
  },[preview,accountId,mode]);
  useEffect(()=>{++generation.current;++loadVersion.current;requests.current.forEach(r=>r.abort());pending.current=false;setBusy(false);setError('');setNotice('');setDevices([]);setPair(null);setLoaded(false);void load();},[load]);
  useEffect(()=>{
    if(!pair)return;
    const refresh=()=>{if(Date.now()>=pair.expires){setPair(null);setNotice('Pairing code expired. Create a new connection to try again.');return;}void load();};
    const timer=setInterval(refresh,5000);return()=>clearInterval(timer);
  },[pair,load]);
  const paired=pair?devices.some(d=>d.id===pair.id&&d.paired):false;
  useEffect(()=>{if(paired){setPair(null);setNotice('Computer paired. Keep the companion running to stay available.');}},[paired]);
  useEffect(()=>{if(selected){title.current?.focus({preventScroll:true});title.current?.closest('.gw-content')?.scrollTo({top:0});}},[selected]);
  async function create(event:FormEvent){
    event.preventDefault();if(preview||!setup||pending.current||!name.trim())return;
    pending.current=true;setBusy(true);setError('');setNotice('');setPair(null);const version=generation.current;
    try{const data=await read('devices',{method:'POST',body:JSON.stringify({name:name.trim()})});if(!alive.current||version!==generation.current)return;
      const expires=dateFromApi(data.expires_at)?.getTime();
      if(!uuid.test(data.id)||typeof data.pairing_code!=='string'||!data.pairing_code.startsWith(data.id+'.')||data.pairing_code.length>150||!expires||expires<=Date.now())throw new Error('The pairing code was not confirmed. Refresh computers before creating another.');
      setPair({id:data.id,code:data.pairing_code,expires});await load();
    }catch(failure){if(alive.current&&version===generation.current)setError(failure instanceof Error?failure.message:'Could not create a connection.');}
    finally{if(alive.current&&version===generation.current){pending.current=false;setBusy(false);}}
  }
  async function disconnect(id:string){
    if(preview||pending.current||!uuid.test(id))return;pending.current=true;setBusy(true);setError('');
    try{await read('devices/'+id,{method:'DELETE'});if(!alive.current)return;if(pair?.id===id)setPair(null);setRevoke('');await load();}catch(failure){if(alive.current)setError(failure instanceof Error?failure.message:'Could not disconnect this computer.');}finally{if(alive.current){pending.current=false;setBusy(false);}}
  }
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('Copied.');}catch{setNotice('Clipboard is unavailable. Select the text and copy it.');}}
  const command=setup?(os==='Windows'&&selected==='local'?setup.windows:setup.unix):'';
  const select=(id:Host)=>{setSelected(id);setName(id==='aws'?'My AWS computer':id==='azure'?'My Azure computer':'My computer');setError('');setNotice('');setRevoke('');};
  return <section className="gc-hosting" aria-label="Hosting and computers">
    <div className="gc-cloud-summary"><span className="gc-host-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 18a5 5 0 1 1 .5-10A6 6 0 0 1 18 10a4 4 0 0 1 0 8H6Z"/></svg></span><div><h2>Your cloud workspace</h2><p>{preview?'Preview — live hosting status is not shown.':'Your app and saved history stay in the existing cloud workspace.'}</p></div><span className="gc-status" data-state={!preview&&cloudReady?'connected':'neutral'}>{preview?'Preview':cloudReady?'Cloud connected':'Status unavailable'}</span></div>
    <div className="gc-host-mode" role="group" aria-label="Choose hosting or computer connection"><button aria-pressed={mode==='computer'} disabled={!!pair||busy} onClick={()=>setMode('computer')}><strong>Connect a computer</strong><span>Add tools to your existing workspace</span></button><button aria-pressed={mode==='app'} disabled={!!pair||busy} onClick={()=>setMode('app')}><strong>Host the whole app</strong><span>Run a new installation on your own hardware</span></button></div>
    {mode==='app'?<GatewayDeployment/>:<>
    {!setup?<p className="gc-notice" role="status">Computer pairing requires HTTPS. This app is configured with an HTTP localhost address. Set up an HTTPS address for this installation before creating a pairing code.</p>:null}
    {host?<>
      <button className="gc-back" onClick={()=>{setSelected(null);setNotice('');}}><span aria-hidden="true">←</span> All hosting options</button>
      <section className="gc-detail" aria-labelledby="gc-host-title"><header>{host.logo?<GatewayProviderLogo logo={host.logo} size={56}/>:<span className="gc-host-icon"><svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/></svg></span>}<div><h2 ref={title} id="gc-host-title" tabIndex={-1}>Connect {host.id==='local'?'this computer':host.id==='aws'?'an AWS machine':'an Azure machine'}</h2><p>{host.label}</p></div></header>
      <p className="gc-connection-intro">Connect a computer for file and command tools. The Cypher app continues running in your cloud workspace. Each action asks for approval on the connected machine.</p>
      {host.portal?<div className="gc-host-start"><h3>Open your machine’s terminal</h3><p>{host.id==='aws'?'In AWS, start a Session Manager session with your existing EC2 instance.':'In Azure, open your virtual machine and choose Connect → SSH or Bastion.'}</p><a className="gc-secondary" href={host.portal} target="_blank" rel="noopener noreferrer">Open {host.id==='aws'?'AWS':'Azure'} console <span aria-hidden="true">↗</span></a><a className="gc-text-button" href={host.guide} target="_blank" rel="noopener noreferrer">Connection help</a></div>:<div className="gc-filters" role="group" aria-label="Computer operating system">{['Mac / Linux','Windows'].map(value=><button key={value} aria-pressed={os===value} onClick={()=>setOs(value)}>{value}</button>)}</div>}
      {setup?<div className="gc-command"><div><h3>Run the companion</h3><button className="gc-text-button" onClick={()=>void copy(command)}>Copy command</button></div><pre><code>{command}</code></pre><p>Requires Python 3.10+. Allows only the Cypher folder. Shell access is off. Keep this terminal open.</p><a className="gc-text-button" href={setup.downloadUrl} download="cypher_device.py">Download companion instead</a></div>:null}
      <form className="gc-key-form" onSubmit={event=>void create(event)}><label htmlFor="gc-device-name">Computer name</label><input id="gc-device-name" maxLength={80} required value={name} onChange={event=>setName(event.target.value)} disabled={!setup||busy||!!pair}/>{preview?<p>Sign in to the cloud workspace to create a real pairing code.</p>:null}<div className="gc-detail-actions">{preview?<a className="gc-primary" href="https://cypher-agent.vercel.app/login">Open cloud workspace <span aria-hidden="true">↗</span></a>:<button className="gc-primary" disabled={!setup||busy||!!pair||!name.trim()}>{!setup?'HTTPS required':busy?'Creating…':pair?'Waiting for this computer…':'Create pairing code'}</button>}</div></form>
      {pair?<div className="gc-pair" role="status"><h3>Paste this code into the companion</h3><p>Expires {new Date(pair.expires).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}. It is shown only here.</p><div><input aria-label="Pairing code" type="password" readOnly autoComplete="off" value={pair.code} onFocus={event=>event.target.select()}/><button className="gc-secondary" onClick={()=>void copy(pair.code)}>Copy code</button></div><button className="gc-text-button" disabled={busy} onClick={()=>void disconnect(pair.id)}>Cancel connection</button></div>:null}
      </section>
    </>:<>
      <div className="gc-section-title"><h2>Connect a computer</h2><p>Choose where it runs. Pair it once. Approve its access.</p></div>
      <div className="gc-host-grid">{hosts.map(h=><article className="gc-provider" key={h.id}>{h.logo?<GatewayProviderLogo logo={h.logo} size={48}/>:<span className="gc-host-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/></svg></span>}<h2>{h.name}</h2><p className="gc-company">{h.label}</p><p className="gc-provider-description">{h.description}</p><button className="gc-secondary" onClick={()=>select(h.id)}>Connect {h.id==='local'?'computer':h.id==='aws'?'AWS machine':'Azure machine'} <span aria-hidden="true">→</span></button></article>)}</div>
    </>}
    {error?<p className="gc-alert" role="alert">{error} <button className="gc-text-button" onClick={()=>void load()}>Retry</button></p>:null}{notice?<p className="gc-notice" role="status">{notice}</p>:null}
    <div className="gc-section-title gc-devices-heading"><div><h2>Connected computers</h2><p>Pairing grants access only to that computer’s approved tools.</p></div>{!preview?<button className="gc-text-button" onClick={()=>void load()}>Refresh</button>:null}</div>
    {devices.length?<div className="gc-device-list">{devices.map(d=><article key={d.id}><div><strong>{d.name}</strong><p>{d.paired?'Paired':'Awaiting pairing'}{d.last_seen_at&&dateFromApi(d.last_seen_at)?' · Last seen '+dateFromApi(d.last_seen_at)!.toLocaleString():''}</p><small>{d.scopes.length?d.scopes.join(', '):'No permissions granted yet'}</small></div>{revoke===d.id?<div className="gc-detail-actions"><button className="gc-secondary" disabled={busy} onClick={()=>void disconnect(d.id)}>Confirm disconnect</button><button className="gc-text-button" disabled={busy} onClick={()=>setRevoke('')}>Keep connected</button></div>:<button className="gc-text-button" disabled={busy} onClick={()=>setRevoke(d.id)}>Disconnect</button>}</article>)}</div>:<div className="gc-device-empty">{preview?'No real computers are shown in preview.':loaded?'No computers connected yet.':'Loading computers…'}</div>}
    <details className="gc-hosting-advanced"><summary>How is this different from hosting the app?</summary><p>A paired computer adds tools to this workspace. To run the frontend, API, and worker on your hardware, choose Host the whole app above. Your existing cloud data stays in place.</p><p>EC2 and Azure VMs can incur hosting charges while running. A local computer needs to stay on.</p></details>
    </>}
  </section>;
}
