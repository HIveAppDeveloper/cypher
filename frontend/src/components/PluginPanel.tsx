import { useEffect, useRef, useState, type FormEvent } from 'react';
import { approveConnection, enrollDevice } from '../lib/device';
import { api } from '../lib/api';
export interface PluginConnection { id:string;name:string;url:string;enabled:boolean;authenticated:boolean;verification?:{status:string;checked_at?:string;detail?:{tool?:string;latency_ms?:number;message?:string}};tools:{name:string;description:string;enabled?:boolean}[]; }
export interface CatalogEntry { id:string;name:string;url:string;description:string;category:string;domains:string[];icon?:string;source?:string;auth?:string;auth_header?:string;setup_note?:string; }
type View='browse'|'connected'|'custom'|'settings';
const AUTH_POLL_MS=2000;
function Logo({item}:{item:Pick<CatalogEntry,'name'|'icon'>}){
  const [failed,setFailed]=useState(false);
  return <span className="connector-logo">{item.icon && !failed?<img src={item.icon} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<span>{item.name.slice(0,2).toUpperCase()}</span>}</span>;
}
export function PluginPanel({onClose}:{onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const popup=useRef<Window|null>(null);
  const [view,setView]=useState<View>('browse');
  const [catalog,setCatalog]=useState<CatalogEntry[]>([]);
  const [plugins,setPlugins]=useState<PluginConnection[]>([]);
  const [loading,setLoading]=useState(true);
  const [website,setWebsite]=useState('');
  const [search,setSearch]=useState('');
  const [visibleCount,setVisibleCount]=useState(60);
  const [category,setCategory]=useState('All');
  useEffect(()=>setVisibleCount(60),[search,category]);
  const [url,setUrl]=useState('');const [name,setName]=useState('');const [token,setToken]=useState('');const [authHeader,setAuthHeader]=useState('Authorization');
  const [busy,setBusy]=useState(false);const [flow,setFlow]=useState('');
  const [notice,setNotice]=useState('');const [error,setError]=useState('');
  const [device,setDevice]=useState(false);
  const [accountState,setAccountState]=useState<Record<string,{configured:boolean;detail:string}>>({});
  const [accountUrl,setAccountUrl]=useState('');const [accountEmail,setAccountEmail]=useState('');
  const [variables,setVariables]=useState<{project:string;name:string;target:string;state:string}[]>([]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;dialog.current?.showModal();let active=true;
    Promise.all([api.getPluginCatalog(),api.getPlugins()]).then(([items,connections])=>{if(active){setCatalog(items);setPlugins(connections);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    api.deviceStatus().then(s=>{if(active)setDevice(s.enrolled);}).catch(()=>{});
    api.accountStatus().then(s=>{if(active)setAccountState(s);}).catch(()=>{});
    fetch('/api/connections').then(r=>r.json()).then(data=>{if(active)setVariables(data.variables||[]);}).catch(()=>{});
    const result=new URLSearchParams(window.location.search).get('plugins');
    if(result){setView('connected');if(result==='connected')setNotice('Connected. Your team can now use this service.');else setError(result==='cancelled'?'Sign-in was cancelled. Nothing was connected.':'Sign-in could not be completed. Try connecting again.');}
    return()=>{active=false;dialog.current?.close();popup.current?.close();previous?.focus();};
  },[]);
  useEffect(()=>{
    if(!flow)return;let active=true;const started=Date.now();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{
        const state=await api.pluginAuthStatus(flow);if(!active)return;
        if(state.status==='connected'){
          const connections=await api.getPlugins();if(!active)return;
          setPlugins(connections);setView('connected');setNotice(`${state.name} connected. Your team can use its tools.`);setFlow('');setBusy(false);popup.current?.close();return;
        }
        if(['failed','cancelled','expired'].includes(state.status)||Date.now()-started>600000){setError('Sign-in did not finish. Reconnect the service to try again.');setFlow('');setBusy(false);popup.current?.close();return;}
      }catch(e){if(active){setError(e instanceof Error?e.message:'Could not check sign-in.');setFlow('');setBusy(false);}return;}
      if(active)timer=setTimeout(poll,AUTH_POLL_MS);
    }
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[flow]);
  async function cancelSignIn(){try{await api.cancelPluginAuth(flow);popup.current?.close();setFlow('');setBusy(false);setNotice('Sign-in cancelled. You can choose another service or try again.');setError('');}catch(e){setError(e instanceof Error?e.message:'Could not cancel sign-in.');}}
  function chooseView(next:View){setView(next);setError('');if(!flow)setNotice('');}
  function preparePopup(){
    const opened=window.open('about:blank','grokbot-service-login','popup,width=620,height=760');
    if(opened){opened.opener=null;opened.document.title='Connect a service';const p=opened.document.createElement('p');p.textContent='Finding the secure sign-in page…';p.style.cssText='font:16px system-ui;padding:32px;color:#45434c';opened.document.body.appendChild(p);}
    popup.current=opened;
  }
  async function begin(item:CatalogEntry,reconnect=false){
    const existing=plugins.find(plugin=>plugin.url===item.url);
    if(existing && !reconnect){setBusy(false);setView('connected');setNotice(`${existing.name} is already connected.`);popup.current?.close();return;}
    if(item.setup_note){popup.current?.close();setBusy(false);setNotice(item.setup_note+' Source: '+(item.source||item.url));return;}
    if(item.auth==='api_key'){popup.current?.close();setView('custom');setUrl(item.url);setName(item.name);setAuthHeader(item.auth_header||'Authorization');setNotice(`${item.name} uses an API key. Get it from the service, then paste it below.`);setBusy(false);return;}
    setNotice(`Checking ${item.name}…`);
    const approval_id=await approveConnection('connect_plugin:'+item.url);
    const result=await api.authorizePlugin({name:item.name.slice(0,80),url:item.url,approval_id,reconnect});
    if(result.status==='connected'){
      setPlugins(await api.getPlugins());setView('connected');setNotice(`${result.name} connected. Your team can now use it.`);popup.current?.close();setBusy(false);
    }else if(result.authorization_url && result.flow_id){
      setFlow(result.flow_id);setNotice(`Finish signing in to ${result.name} in the new window. Review its permissions and press Allow.`);
      if(popup.current)popup.current.location.replace(result.authorization_url);else window.location.assign(result.authorization_url);
    }else throw new Error('This service did not provide a sign-in page. Try its advanced setup.');
  }
  async function connectItem(item:CatalogEntry,reconnect=false){setBusy(true);setError('');preparePopup();try{await begin(item,reconnect);}catch(e){popup.current?.close();setBusy(false);setNotice('');setError(e instanceof Error?e.message:'Connection failed.');}}
  async function connectWebsite(event:FormEvent){event.preventDefault();setBusy(true);setError('');preparePopup();try{const item=await api.resolvePlugin(website.trim());await begin(item);}catch(e){popup.current?.close();setBusy(false);setNotice('');setError(e instanceof Error?e.message:'Could not find a connector for this website.');}}
  async function connectCustom(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const parsed=new URL(url.trim());
      if(parsed.protocol!=='https:')throw new Error('Use the HTTPS server address supplied by the company.');
      if(parsed.hostname==='vercel.com')throw new Error('This is a Vercel dashboard URL. Open Browse and enter vercel.com; we will find the right connector for you.');
      const item={id:'custom',name:name.trim()||parsed.hostname,url:url.trim(),description:'',category:'Custom',domains:[parsed.hostname]};
      if(token.trim()){
        const approval_id=await approveConnection('connect_plugin:'+item.url);const connection=await api.connectPlugin({name:item.name,url:item.url,token:token.trim(),auth_header:authHeader,approval_id});setPlugins(current=>[...current,connection]);setView('connected');setToken('');setNotice(`${connection.name} connected.`);setBusy(false);
      }else{preparePopup();await begin(item);}
    }catch(e){popup.current?.close();setBusy(false);setError(e instanceof Error?e.message:'Connection failed.');}
  }
  async function connectionAction(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();setPlugins(await api.getPlugins());}catch(e){setError(e instanceof Error?e.message:'Could not update this connection.');}finally{setBusy(false);}}
  async function enableDevice(){setBusy(true);setError('');try{await enrollDevice();setDevice(true);setNotice('Device approval enabled.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function setupAccount(){setBusy(true);setError('');try{const approval_id=await approveConnection('setup_account:'+accountUrl.trim());await api.setupPluginAccount({name:'New service',signup_url:accountUrl.trim(),email:accountEmail.trim(),approval_id});setNotice('Account setup is queued in Your team. Creating an account does not automatically connect its tools.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const query=search.trim().toLowerCase();
  const filtered=catalog.filter(item=>(category==='All'||item.category===category)&&[item.name,item.description,...item.domains].join(' ').toLowerCase().includes(query));
  const categories=['All',...Array.from(new Set(catalog.map(item=>item.category)))];
  return <dialog ref={dialog} className="connectors-dialog" aria-labelledby="plugins-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="connectors-header"><div><h2 id="plugins-title">Plugins</h2><p>Your team, connected to your tools.</p></div><button className="connector-close" aria-label="Close plugins" onClick={onClose}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <nav className="connector-tabs" aria-label="Plugin pages">{([['browse','Browse'],['connected',`Connected${plugins.length?' · '+plugins.length:''}`],['custom','Advanced'],['settings','Settings']] as const).map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>chooseView(id)}>{label}</button>)}</nav>
    <div className="connectors-body">
      {notice?<div className="connector-notice" role="status">{notice}{flow?<div className="connector-login-actions"><button onClick={()=>{popup.current?.focus();}}>Open sign-in window</button><button onClick={()=>void cancelSignIn()}>Cancel sign-in</button></div>:null}</div>:null}
      {error?<div className="connector-error" role="alert">{error}</div>:null}
      {view==='browse'?<>
        <form className="website-connect" onSubmit={event=>void connectWebsite(event)}><label htmlFor="company-website">Connect a company website</label><div><input id="company-website" value={website} onChange={event=>setWebsite(event.target.value)} placeholder="vercel.com, notion.so, linear.app…" required maxLength={1000} autoComplete="url"/><button className="btn-primary" disabled={busy||!website.trim()}>{busy?'Connecting…':'Connect'}</button></div><p>Paste a website. We find its published connector and open sign-in when supported.</p></form>
        <div className="catalog-heading"><h3>Explore plugins <span>{catalog.length}</span></h3><input type="search" aria-label="Search plugins" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search tools or companies"/></div>
        <div className="connector-categories" aria-label="Plugin categories">{categories.map(item=><button key={item} aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</button>)}</div>
        {loading?<p className="connector-empty" role="status">Loading published connectors…</p>:<div className="connector-catalog">{filtered.slice(0,visibleCount).map(item=>{
          const connected=plugins.some(plugin=>plugin.url===item.url);
          return <article className="connector-entry" key={item.id}><div className="connector-entry-title"><Logo item={item}/><div><h4>{item.name}</h4><span>{item.category}</span></div></div><p>{item.description}</p><div className="connector-entry-footer"><a href={item.source} target="_blank" rel="noreferrer">Source</a><button disabled={busy} className="connector-connect" aria-label={`${connected?'View':'Connect'} ${item.name}`} onClick={()=>void connectItem(item)}>{connected?'Connected':'Connect'}<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button></div></article>;
        })}</div>}
        {!loading && !filtered.length?<p className="connector-empty">No matches. Try another name or category.</p>:null}
        {filtered.length>visibleCount?<button className="btn-secondary" onClick={()=>setVisibleCount(n=>n+60)}>Show more plugins ({filtered.length-visibleCount} remaining)</button>:null}<p className="catalog-note">Published endpoints from the MCP registry and provider documentation. Listings are not execution tests. Connect your account, then use Test tools to check a supported read-only operation. Provider fees and account restrictions may apply.</p>
      </>:null}
      {view==='connected'?<>{!plugins.length?<div className="connector-empty"><h3>No plugins connected yet</h3><p>Choose a service or paste its website to get started.</p><button className="btn-primary" onClick={()=>chooseView('browse')}>Browse plugins</button></div>:plugins.map(plugin=><section className="connected-service" key={plugin.id}><div className="connected-service-header"><Logo item={{name:plugin.name,icon:catalog.find(item=>item.url===plugin.url)?.icon}}/><div><h3>{plugin.name}</h3><p>{plugin.tools.length} tools · {plugin.enabled?'Enabled':'Paused'} · {plugin.verification?.status==='passed'?'Tool test passed':plugin.verification?.status==='failed'?'Tool test failed':'Execution not tested'}</p></div><button className="btn-secondary" role="switch" aria-checked={plugin.enabled} aria-label={`Enable ${plugin.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.togglePlugin(plugin.id,!plugin.enabled))}>{plugin.enabled?'Pause':'Enable'}</button></div><details><summary>Manage tools</summary>{plugin.tools.map(tool=><div className="connected-tool" key={tool.name}><div><strong>{tool.name}</strong><p>{tool.description}</p></div><button className="btn-secondary" role="switch" aria-checked={tool.enabled!==false} aria-label={`Enable ${tool.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.setPluginTool(plugin.id,tool.name,tool.enabled===false))}>{tool.enabled===false?'Enable':'Pause'}</button></div>)}</details><div className="connected-service-actions"><button disabled={busy} onClick={()=>void connectionAction(async()=>{const result=await api.testPlugin(plugin.id);setNotice(`${plugin.name}: ${result.message}${result.latency_ms!==undefined?` (${(result.latency_ms/1000).toFixed(1)}s)`:""}`);if(result.status==="failed")throw new Error(result.message);})}>Test tools</button><button disabled={busy} onClick={()=>void connectItem(catalog.find(item=>item.url===plugin.url)||{id:plugin.id,name:plugin.name,url:plugin.url,description:'',category:'Custom',domains:[]},true)}>Reconnect</button><button disabled={busy} onClick={()=>void connectionAction(()=>api.refreshPlugin(plugin.id))}>Refresh tools</button><button disabled={busy} onClick={()=>void connectionAction(()=>api.disconnectPlugin(plugin.id))}>Disconnect</button></div></section>)}</>:null}
      {view==='custom'?<form className="connector-custom" onSubmit={event=>void connectCustom(event)}><h3>Add a custom server</h3><p>For a service that supplies its own MCP address. For a company website, use Browse.</p><label htmlFor="plugin-url">MCP server address</label><input id="plugin-url" type="url" value={url} onChange={event=>setUrl(event.target.value)} required placeholder="https://service.com/mcp"/><label htmlFor="plugin-name">Name <span>optional</span></label><input id="plugin-name" value={name} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="We can use the server name"/><label htmlFor="plugin-token">API key or bearer token <span>optional</span></label><input id="plugin-token" type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} placeholder="Leave blank to try secure sign-in"/><label htmlFor="plugin-auth-header">API key header</label><input id="plugin-auth-header" value={authHeader} onChange={event=>setAuthHeader(event.target.value)} placeholder="Authorization or X-API-Key"/><p className="field-help">Keys stay encrypted on the server. A connected service’s tools can read or change data according to the permissions you grant.</p><button className="btn-primary" disabled={busy}>{busy?'Connecting…':'Connect server'}</button></form>:null}
      {view==='settings'?<div className="connector-settings"><h3>Connection settings</h3><section><h4>Device approval</h4><p>{device?'New connections require your registered passkey.':'Confirm new connections with a device passkey, Touch ID, Face ID, or Windows Hello.'}</p>{!device?<button className="btn-secondary" disabled={busy} onClick={()=>void enableDevice()}>Enable device approval</button>:null}</section><section><h4>Email connections</h4>{Object.entries(accountState).map(([service,state])=><p key={service}><strong>{service==='gmail'?'Gmail':'Resend'} · {state.configured?'Configured':'Not connected'}</strong><br/>{state.detail}</p>)}</section><details><summary>Account signup assistance</summary><label htmlFor="account-signup">Signup page</label><input id="account-signup" type="url" value={accountUrl} onChange={event=>setAccountUrl(event.target.value)} placeholder="https://service.com/signup"/><label htmlFor="account-email">Account email</label><input id="account-email" type="email" value={accountEmail} onChange={event=>setAccountEmail(event.target.value)} placeholder="Your email"/><button disabled={busy||!accountUrl||!accountEmail} className="btn-secondary" onClick={()=>void setupAccount()}>Start account setup</button></details><details><summary>Server configuration</summary><div className="variable-inventory">{variables.map(variable=><div key={variable.target}><span><strong>{variable.name}</strong><small>{variable.project}</small></span><span>{variable.state==='configured'?'Configured':'Needs link'}</span></div>)}</div></details></div>:null}
    </div>
  </dialog>;
}
