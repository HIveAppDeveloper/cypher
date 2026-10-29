import { LoadingState } from './LoadingState';
import { pluginStatus, isAccountPlugin } from '../lib/plugin-status';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { approveConnection, enrollDevice } from '../lib/device';
import { api } from '../lib/api';
import { PLUGIN_SIGN_IN_KEY, PLUGIN_SIGN_IN_TTL, readPluginSignIn, type PluginSignIn } from '../lib/pluginAuthorization';
import { CANONICAL_APP_ORIGIN, isOffCanonicalHost } from '../lib/canonical-app';
import CypherMark from './cipher/CypherMark';
import BinaryLens from './cipher/BinaryLens';
import { McpDirectory } from './McpDirectory';
export interface PluginConnection { provider?:string; connection_id?:string; id:string;name:string;url:string;enabled:boolean;authenticated:boolean;verification?:{status:string;checked_at?:string;detail?:{tool?:string;latency_ms?:number;message?:string}};tools:{name:string;description:string;enabled?:boolean}[]; }
export interface CatalogEntry { id:string;name:string;url:string;description:string;category:string;domains:string[];icon?:string;source?:string;auth?:string;auth_header?:string;setup_note?:string;connection_id?:string;transport?:string;oauth_client_configured?:boolean; }
export interface AvailableConnection {id:string;name:string;url:string;domains:string[];reuse_available:boolean;method:string;}
export interface PluginSync {id:string;status:string;checked:number;total:number;counts:Record<string,number>;results:Record<string,{status:string;message:string;tool_count?:number;credential_source?:string}>;}
type View='browse'|'connected'|'custom'|'settings';
const AUTH_POLL_MS=2000;
const CONNECTION_LOAD_ERROR='Some connections could not load. Retry to refresh the catalog and your connected services.';
const LOVABLE_MCP_URL='https://mcp.lovable.dev';
const LOVABLE_SOURCE='https://docs.lovable.dev/integrations/lovable-mcp-server';
const CANVA_MCP_URL='https://api.canva.com/connect/v1/mcp';
const CANVA_READ_SCOPE='design:meta:read design:content:read';
const CANVA_UNAVAILABLE='Canva connections aren’t available yet. You can keep connecting other apps.';
function normalizeHost(value:string){
  try{return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())?value.trim():`https://${value.trim()}`).hostname.toLocaleLowerCase().replace(/^www\./,'');}
  catch{return '';}
}
function displayAddress(value:string){
  try{const url=new URL(value);return url.origin+url.pathname.replace(/\/$/,'');}catch{return value;}
}
function sameEndpoint(left:string,right:string){
  // URL serialization equates an HTTPS origin with its root slash, while
  // retaining paths and query strings that may identify different connections.
  try{return new URL(left).href===new URL(right).href;}catch{return left===right;}
}
function isWebsiteQuery(value:string){
  const candidate=value.trim();
  return !/\s/.test(candidate)&&/^(https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?$/i.test(candidate)&&Boolean(normalizeHost(candidate));
}
function exactCatalogMatch(value:string,items:CatalogEntry[]){
  const query=value.trim().toLocaleLowerCase();
  const host=normalizeHost(value);
  return items.find(item=>item.name.trim().toLocaleLowerCase()===query||Boolean(host&&(
    item.domains.some(domain=>normalizeHost(domain)===host)||normalizeHost(item.url)===host
  )))||null;
}
function Logo({item}:{item:Pick<CatalogEntry,'name'|'icon'> & {provider?:string}}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[item.icon]);
  return <span className="connector-logo" data-brand={item.name==='Canva'?'canva':undefined} aria-hidden="true">{item.provider==='google'?<GoogleMark/>:item.icon && !failed?<img src={item.icon} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<svg className="app-fallback-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>}</span>;
}
function GoogleMark(){
  return <svg className="google-brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.78-.07-1.53-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v2.78h3.88c2.27-2.09 3.56-5.17 3.56-8.42z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.92l-3.88-2.78c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v2.87A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.27 14.49a7.2 7.2 0 0 1 0-4.98V6.64H1.26a12 12 0 0 0 0 10.72l4.01-2.87z"/><path fill="#EA4335" d="M12 4.55c1.76 0 3.34.61 4.59 1.81l3.43-3.43A11.45 11.45 0 0 0 12 0 12 12 0 0 0 1.26 6.64l4.01 2.87C6.22 6.66 8.87 4.55 12 4.55z"/></svg>;
}
function LovableMark({active=false}:{active?:boolean}){
  return <span className="lovable-cypher-mark" data-active={active} aria-hidden="true">
    {active?<BinaryLens className="lovable-binary-lens" active label="Cypher connecting"/>:<CypherMark className="lovable-real-mark" decorative/>}
  </span>;
}
export function PluginPanel({onClose,onExploreConnection,onManageSkills,embedded=false}:{onClose:()=>void;onExploreConnection?:(name:string)=>void;onManageSkills?:()=>void;embedded?:boolean}){
  const dialog=useRef<HTMLDialogElement>(null);
  const popup=useRef<Window|null>(null);
  const body=useRef<HTMLDivElement>(null);
  const [view,setView]=useState<View>('browse');
  const [catalog,setCatalog]=useState<CatalogEntry[]>([]);
  const [plugins,setPlugins]=useState<PluginConnection[]>([]);
  const [catalogLoaded,setCatalogLoaded]=useState(false);
  const [connectionsLoaded,setConnectionsLoaded]=useState(false);
  const [catalogLoadFailed,setCatalogLoadFailed]=useState(false);
  const [connectionsLoadFailed,setConnectionsLoadFailed]=useState(false);
  const [available,setAvailable]=useState<AvailableConnection[]>([]);
  const [sync,setSync]=useState<PluginSync|null>(null);
  const syncing=sync?.status==='pending'||sync?.status==='running';
  const [loading,setLoading]=useState(true);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [publicTools,setPublicTools]=useState(false);
  const [registration,setRegistration]=useState<{item:CatalogEntry;callback:string;reconnect:boolean}|null>(null);
  const [clientId,setClientId]=useState('');const [clientSecret,setClientSecret]=useState('');const [clientScope,setClientScope]=useState('');
  const [registryItems,setRegistryItems]=useState<CatalogEntry[]>([]);
  const [registryCursor,setRegistryCursor]=useState<string|null>(null);
  const [registryLoading,setRegistryLoading]=useState(false);
  const [registryLoadingMore,setRegistryLoadingMore]=useState(false);
  const [registryError,setRegistryError]=useState('');
  const [registryRetry,setRegistryRetry]=useState(0);
  const registryQueryRef=useRef('');
  const [activeCategory,setActiveCategory]=useState('All');
  const [visibleCount,setVisibleCount]=useState(12);
  const [directoryOpen,setDirectoryOpen]=useState(false);
  const [moreResultsOpen,setMoreResultsOpen]=useState(false);
  const [manualOpen,setManualOpen]=useState(false);
  useEffect(()=>setVisibleCount(12),[search,activeCategory]);
  const [url,setUrl]=useState('');const [name,setName]=useState('');const [token,setToken]=useState('');const [authHeader,setAuthHeader]=useState('Authorization');
  const [busy,setBusy]=useState(false);const [flow,setFlow]=useState<PluginSignIn|null>(null);
  const [connectingName,setConnectingName]=useState('');
  const [flowError,setFlowError]=useState('');const [checkingSignIn,setCheckingSignIn]=useState(false);
  const [cancellingSignIn,setCancellingSignIn]=useState(false);
  const checkSignIn=useRef<()=>Promise<void>>(async()=>{});
  const connecting=useRef(false);
  const testing=useRef(false);
  const mounted=useRef(false);
  const [testingId,setTestingId]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [notice,setNotice]=useState('');const [error,setError]=useState('');
  const [refreshableError,setRefreshableError]=useState(false);
  const [disconnected,setDisconnected]=useState(false);
  useEffect(()=>{
    let active=true, pending=false;
    let timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const check=async()=>{
      if(!active||pending||document.hidden)return;
      pending=true;clearTimeout(timer);
      try{const response=await fetch('/api/runtime',{cache:'no-store',signal:controller.signal});const health=await response.json();if(active)setDisconnected(!response.ok||health.connected===false);}
      catch{if(active)setDisconnected(true);}
      finally{pending=false;if(active)timer=setTimeout(()=>void check(),30000);}
    };
    const resume=()=>void check();
    const offline=()=>setDisconnected(true);
    void check();
    window.addEventListener('online',resume);window.addEventListener('offline',offline);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return()=>{active=false;controller.abort();clearTimeout(timer);window.removeEventListener('online',resume);window.removeEventListener('offline',offline);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[]);
  const [device,setDevice]=useState(false);
  const [accountState,setAccountState]=useState<Record<string,{configured:boolean;detail:string}>>({});
  const [accountUrl,setAccountUrl]=useState('');const [accountEmail,setAccountEmail]=useState('');
  const [variables,setVariables]=useState<{project:string;name:string;target:string;state:string}[]>([]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;if(!embedded)dialog.current?.showModal();let active=true;
    const items=api.getPluginCatalog().then(value=>{if(active){setCatalog(value);setCatalogLoaded(true);setCatalogLoadFailed(false);}}).catch(()=>{if(active){setCatalogLoadFailed(true);setError(CONNECTION_LOAD_ERROR);setRefreshableError(true);}}).finally(()=>{if(active)setCatalogLoading(false);});
    const connections=api.getPlugins().then(value=>{if(active){setPlugins(value);setConnectionsLoaded(true);setConnectionsLoadFailed(false);}}).catch(()=>{if(active){setConnectionsLoadFailed(true);setError(CONNECTION_LOAD_ERROR);setRefreshableError(true);}});
    void Promise.all([items,connections]).then(()=>{if(active)setLoading(false);});
    api.deviceStatus().then(s=>{if(active)setDevice(s.enrolled);}).catch(()=>{});
    api.getAvailableConnections().then(s=>{if(active)setAvailable(s);}).catch(()=>{});
    api.pluginSyncStatus().then(s=>{if(active)setSync(s);}).catch(()=>{});
    api.accountStatus().then(s=>{if(active)setAccountState(s);}).catch(()=>{});
    fetch('/api/connections').then(r=>r.json()).then(data=>{if(active)setVariables(data.variables||[]);}).catch(()=>{});
    const params=new URLSearchParams(window.location.search);const result=params.get('plugins');
    const connectTarget=params.get('connect');
    if(connectTarget){
      if(connectTarget==='custom'){setView('custom');const server=params.get('server');if(server)setUrl(server);setNotice('Your MCP address is ready. Choose Connect server to start secure sign-in.');}
      else if(connectTarget==='search'){const requested=params.get('q')||'';setSearch(requested);setNotice('Your service search is ready on Cypher’s main address. Choose Find connector to continue.');}
      else {setSearch(connectTarget);if(params.get('reconnect')==='1')setView('connected');setNotice(`Continue with ${connectTarget} from Cypher’s main address. Choose Connect ${connectTarget} to start again.`);}
      const clean=new URL(window.location.href);clean.searchParams.delete('connect');clean.searchParams.delete('server');clean.searchParams.delete('reconnect');clean.searchParams.delete('q');window.history.replaceState(window.history.state,'',clean.pathname+clean.search+clean.hash);
    }
    let saved:PluginSignIn|null=null;
    try{saved=readPluginSignIn(sessionStorage);}catch{}
    if(result&&['connected','cancelled','failed'].includes(result)){
      if(!params.get('plugin_flow')||params.get('plugin_flow')===saved?.id){try{sessionStorage.removeItem(PLUGIN_SIGN_IN_KEY);}catch{}saved=null;}
      setView('connected');if(result==='connected')setNotice('Your app is connected. You can manage its access below.');else setError(result==='cancelled'?'Access was not allowed. Choose Connect to try again.':'Sign-in could not be verified. Choose Connect to try again.');
      const clean=new URL(window.location.href);clean.searchParams.delete('plugins');clean.searchParams.delete('plugin_flow');window.history.replaceState(window.history.state,'',clean.pathname+clean.search+clean.hash);
    }
    if(saved){setFlow(saved);setBusy(true);setNotice('Finish signing in and allow access on the provider’s page. Your progress is saved in this tab.');}
    return()=>{active=false;dialog.current?.close();previous?.focus();};
  },[]);
  useEffect(()=>{
    const term=search.trim();
    registryQueryRef.current=view==='browse'&&moreResultsOpen&&term.length>=2?term:'';
    setRegistryLoadingMore(false);
    if(view!=='browse'||!moreResultsOpen||term.length<2){setRegistryItems([]);setRegistryCursor(null);setRegistryError('');setRegistryLoading(false);return;}
    let active=true;
    setRegistryItems([]);setRegistryCursor(null);setRegistryError('');setRegistryLoading(false);
    const timer=setTimeout(async()=>{
      setRegistryLoading(true);setRegistryError('');
      try{const page=await api.searchMcpRegistry(term);if(active){setRegistryItems(page.items);setRegistryCursor(page.next_cursor);}}
      catch(e){if(active){setRegistryItems([]);setRegistryCursor(null);setRegistryError(e instanceof Error?e.message:'MCP Registry search failed.');}}
      finally{if(active)setRegistryLoading(false);}
    },300);
    return()=>{active=false;clearTimeout(timer);};
  },[view,search,registryRetry,moreResultsOpen]);
  useEffect(()=>{ if(error || notice) body.current?.scrollTo({top:0}); },[error,notice]);
  async function retryLoad(){setLoading(true);setCatalogLoading(true);setError('');setRefreshableError(false);const [items,connections,status]=await Promise.allSettled([api.getPluginCatalog(),api.getPlugins(),api.pluginSyncStatus()]);if(items.status==='fulfilled'){setCatalog(items.value);setCatalogLoaded(true);setCatalogLoadFailed(false);}else setCatalogLoadFailed(true);if(connections.status==='fulfilled'){setPlugins(connections.value);setConnectionsLoaded(true);setConnectionsLoadFailed(false);}else setConnectionsLoadFailed(true);if(status.status==='fulfilled')setSync(status.value);if(items.status==='rejected'||connections.status==='rejected'||status.status==='rejected'){setError('The connection service is unavailable. Try again shortly.');setRefreshableError(true);}setLoading(false);setCatalogLoading(false);}  async function loadMoreRegistry(){if(!registryCursor||registryLoadingMore)return;const term=search.trim();const cursor=registryCursor;setRegistryLoadingMore(true);setRegistryError('');try{const page=await api.searchMcpRegistry(term,cursor);if(registryQueryRef.current!==term)return;setRegistryItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.items.filter(item=>!seen.has(item.id))];});setRegistryCursor(page.next_cursor);}catch(e){if(registryQueryRef.current===term)setRegistryError(e instanceof Error?e.message:'Could not load more MCP servers.');}finally{if(registryQueryRef.current===term)setRegistryLoadingMore(false);}}  useEffect(()=>{
    if(!syncing)return;let active=true;let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const [job,connections]=await Promise.all([api.pluginSyncStatus(),api.getPlugins()]);if(!active)return;setSync(job);setPlugins(connections);}
      catch{if(active){setError('Could not refresh catalog progress. The cloud job keeps running; refresh connections to check again.');setRefreshableError(true);}}
      if(active)timer=setTimeout(poll,5000);
    }
    timer=setTimeout(poll,3000);return()=>{active=false;clearTimeout(timer);};
  },[syncing]);
  async function syncAll(){setBusy(true);setError('');setRefreshableError(false);try{const approval=await approveConnection('connect_plugin:catalog');setSync(await api.syncPlugins(approval));}catch(e){setError(e instanceof Error?e.message:'Could not start catalog sync.');}finally{setBusy(false);}}
  useEffect(()=>{
    if(!flow)return;let active=true;let pending=false;let failures=0;let timer:ReturnType<typeof setTimeout>;
    function finish(message:string,failed=false){clearSignIn();setBusy(false);popup.current?.close();if(failed)setError(message);else setNotice(message);}
    async function poll(){
      if(!active||pending)return;clearTimeout(timer);pending=true;setCheckingSignIn(true);
      try{
        if(Date.now()-flow!.startedAt>=PLUGIN_SIGN_IN_TTL){finish('This sign-in link expired. Choose Connect to start again.',true);return;}
        const state=await api.pluginAuthStatus(flow!.id);if(!active)return;
        if(state.status==='connected'){
          clearSignIn();popup.current?.close();
          await verifyConnection(state.plugin_id,state.name,true);return;
        }
        if(['failed','cancelled','expired'].includes(state.status)){finish(state.status==='cancelled'?'Access was not allowed. Choose Connect to try again.':state.status==='expired'?'This sign-in link expired. Choose Connect to start again.':'The provider returned, but its tools could not be verified. Choose Connect to try again.',true);return;}
        failures=0;setFlowError('');
      }catch{if(active){failures++;setFlowError('Could not check the connection yet. We’ll retry automatically; you can continue on the provider’s page.');}}
      finally{pending=false;if(active)setCheckingSignIn(false);}
      if(active)timer=setTimeout(poll,Math.min(15000,AUTH_POLL_MS*2**failures));
    }
    const resume=()=>{if(!document.hidden)void poll();};checkSignIn.current=poll;
    window.addEventListener('focus',resume);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
    void poll();return()=>{active=false;clearTimeout(timer);checkSignIn.current=async()=>{};window.removeEventListener('focus',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
  },[flow]);
  function clearSignIn(){try{sessionStorage.removeItem(PLUGIN_SIGN_IN_KEY);}catch{}setFlow(null);setFlowError('');setCheckingSignIn(false);setNotice('');setRefreshableError(false);}
  async function cancelSignIn(){if(!flow||cancellingSignIn)return;setCancellingSignIn(true);try{await api.cancelPluginAuth(flow.id);popup.current?.close();clearSignIn();setBusy(false);setNotice('Sign-in cancelled. You can choose another service or try again.');setError('');}catch(e){setError(e instanceof Error?e.message:'Could not cancel sign-in.');setRefreshableError(false);}finally{setCancellingSignIn(false);}}
  function chooseView(next:View){setView(next);setError('');setRefreshableError(false);if(!flow)setNotice('');}
  function preparePopup(provider='service'){
    const opened=window.open('about:blank','grokbot-service-login','popup,width=620,height=760');
    if(opened){
      opened.opener=null;opened.document.title=`Connect ${provider}`;
      const doc=opened.document;let brandedSplash=false;
      try{
        if(doc.body?.style&&doc.head?.append&&doc.body.appendChild){
          const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';
          const style=doc.createElement('style');style.textContent='@keyframes cypher-breathe{50%{opacity:.64}}@media(prefers-reduced-motion:reduce){.lens{animation:none!important}}';doc.head.append(viewport,style);
          doc.body.style.cssText='margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f8fa;color:#24242b;font:14px system-ui,-apple-system,sans-serif';
          const stage=doc.createElement('main');stage.style.cssText='display:grid;justify-items:center;gap:18px;padding:32px;text-align:center';
          const emblem=doc.createElement('div');emblem.style.cssText='width:184px;height:78px;position:relative';
          const lens=doc.createElement('canvas');lens.className='lens';lens.width=368;lens.height=156;lens.style.cssText='display:block;width:184px;height:78px;color:#24242b;animation:cypher-breathe 1.8s ease-in-out infinite';
          const motionAllowed=document.documentElement.dataset.motion!=='false'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if(!motionAllowed)lens.style.animation='none';
          const ctx=lens.getContext?.('2d');
          if(ctx){
            const cols=41,rows=17,w=184,h=78,dpr=2;ctx.setTransform(dpr,0,0,dpr,0,0);
            const digits=Array.from({length:cols*rows},()=>Math.random()<.5?'0':'1');
            const draw=(time:number)=>{
              try{if(opened.closed||opened.location.href!=='about:blank')return;}catch{return;}
              ctx.clearRect(0,0,w,h);ctx.fillStyle='#24242b';ctx.textAlign='center';ctx.textBaseline='middle';
              const cw=w/cols,rh=h/rows,max=Math.min(cw*1.05,rh*1.25),sweep=((time/1400)%1.6)-.3;
              for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
                const dx=(c+.5)/cols*2-1,dy=(r+.5)/rows*2-1,d=.55*Math.hypot(dx,dy*1.05)+.45*(Math.abs(dx)*.92+Math.abs(dy));
                const shape=Math.max(0,1-d*1.08);if(shape<=.02)continue;
                const pulse=Math.exp(-((((c+.5)/cols)-sweep)**2)/.012),size=Math.max(1.2,max*Math.pow(shape,.75)*(1+pulse*.55));
                ctx.globalAlpha=Math.min(1,.25+shape*1.1);ctx.font=`${size.toFixed(1)}px system-ui,sans-serif`;
                if(Math.random()<.004){const index=r*cols+c;digits[index]=digits[index]==='0'?'1':'0';}
                ctx.fillText(digits[r*cols+c],(c+.5)*cw,(r+.5)*rh);
              }
              ctx.globalAlpha=1;
              if(motionAllowed&&!doc.hidden&&!document.hidden)requestAnimationFrame(draw);
            };
            requestAnimationFrame(draw);
          }
          const title=doc.createElement('strong');title.textContent=`Opening ${provider}`;title.style.cssText='font-size:16px;font-weight:600';
          const detail=doc.createElement('p');detail.textContent='Finding the secure sign-in page…';detail.style.cssText='margin:-12px 0 0;color:#686572;line-height:1.5';
          if([stage,emblem,lens].every(element=>typeof element.appendChild==='function')){emblem.appendChild(lens);stage.appendChild(emblem);stage.appendChild(title);stage.appendChild(detail);doc.body.appendChild(stage);brandedSplash=true;}
        }
      }catch{/* Keep provider consent available if the browser isolates the splash document. */}
      if(!brandedSplash){const message=doc.createElement('p');message.textContent='Finding the secure sign-in page…';if(message.style)message.style.cssText='font:16px system-ui;padding:32px;color:#45434c';doc.body?.appendChild?.(message);}
    }
    popup.current=opened;
  }
  async function begin(item:CatalogEntry,reconnect=false,oauth_client?:{client_id:string;client_secret?:string;scope?:string}){
    const existing=plugins.find(plugin=>sameEndpoint(plugin.url,item.url) && (!item.connection_id||plugin.connection_id===item.connection_id));
    if(existing && !reconnect){setBusy(false);setView('connected');setSearch(existing.name);setNotice(`${existing.name} is already in your workspace. ${existing.enabled?'Its enabled tools are available to agents.':'Enable it below to let agents use its tools.'}`);popup.current?.close();return;}
    if(item.setup_note){popup.current?.close();setBusy(false);setNotice(item.setup_note+' Source: '+(item.source||item.url));return;}
    if(item.auth==='api_key'){popup.current?.close();setView('custom');setUrl(item.url);setName(item.name);setAuthHeader(item.auth_header||'Authorization');setNotice(`${item.name} uses an API key. Get it from the service, then paste it below.`);setBusy(false);return;}
    setNotice(item.name.toLocaleLowerCase()==='lovable'?'':`Checking ${item.name}…`);
    const approval_id=await approveConnection('connect_plugin:'+item.url);
    const result=await api.authorizePlugin({name:item.name.slice(0,80),url:item.url,approval_id,reconnect,connection_id:item.connection_id,oauth_client});
    if(result.status==='connected'){
      popup.current?.close();await verifyConnection(result.plugin_id,result.name,true);
    }else if(result.authorization_url && result.flow_id){
      const next={id:result.flow_id,name:result.name,url:result.authorization_url,startedAt:Date.now()};
      try{sessionStorage.setItem(PLUGIN_SIGN_IN_KEY,JSON.stringify(next));}catch{}
      setFlow(next);setNotice('');setFlowError('');
      try{if(popup.current&&!popup.current.closed)popup.current.location.replace(result.authorization_url);}catch{/* The visible link can reopen a closed or isolated provider window. */}
    }else throw new Error('This service did not provide a sign-in page. Try its advanced setup.');
  }
  function isConnected(item:CatalogEntry){return plugins.some(plugin=>sameEndpoint(plugin.url,item.url)&&(!item.connection_id||plugin.connection_id===item.connection_id));}
  function canvaUnavailable(item:CatalogEntry){return item.url===CANVA_MCP_URL&&!isConnected(item)&&!item.oauth_client_configured&&!available.some(connection=>sameEndpoint(connection.url,item.url));}
  function connectionFailure(error:unknown,item:CatalogEntry,reconnect=false){
    const data=(error as {details?:Record<string,unknown>})?.details;
    if(item.url===CANVA_MCP_URL&&((error as {status?:number})?.status===409||data?.code==='oauth_registration_required')){
      setCatalog(items=>items.map(entry=>entry.url===CANVA_MCP_URL?{...entry,oauth_client_configured:false}:entry));
      setRegistration(null);setError('');setNotice(CANVA_UNAVAILABLE);setRefreshableError(false);return;
    }
    if(data?.code==='oauth_registration_required' && typeof data.callback_url==='string'){
      setRegistration({item,callback:data.callback_url,reconnect});setError('');
      setClientScope(normalizeHost(item.url)==='mcp.lovable.dev'?'openid profile email offline projects:read projects:write workspaces:read workspaces:write':item.url===CANVA_MCP_URL?CANVA_READ_SCOPE:'');
    }else setError(error instanceof Error?error.message:'Connection failed.');
  }
  async function connectRegisteredClient(event:FormEvent){
    event.preventDefault();if(!registration||connecting.current||flow)return;
    connecting.current=true;setBusy(true);setConnectingName(registration.item.name);setError('');preparePopup(registration.item.name);
    try{await begin(registration.item,registration.reconnect,{client_id:clientId.trim(),client_secret:clientSecret||undefined,scope:clientScope.trim()});setRegistration(null);}
    catch(error){popup.current?.close();setBusy(false);connectionFailure(error,registration.item,registration.reconnect);}
    finally{setClientSecret('');setConnectingName('');connecting.current=false;}
  }
  async function connectItem(item:CatalogEntry,reconnect=false){
    if(!connectionsLoaded){setError('Your saved connections are still loading. Retry if they could not be loaded.');setRefreshableError(connectionsLoadFailed);return;}
    if(item.url.endsWith('/api/google/mcp')){window.location.assign('/connect/google');return;}
    if(connecting.current||flow)return;
    const connected=isConnected(item);
    if(canvaUnavailable(item)){setRegistration(null);setError('');setNotice(CANVA_UNAVAILABLE);setRefreshableError(false);return;}
    if(connected&&!reconnect){await begin(item);return;}
    const result=sync?.results[item.id];
    if(!connected&&(item.setup_note||result?.status==='setup_required')){
      popup.current?.close();setBusy(false);setError('');setRefreshableError(false);
      setNotice(`${item.name} needs setup before it can connect. ${item.setup_note||result?.message||'Follow the provider setup instructions, then try again.'}`);
      return;
    }
    const connectionItem=!connected&&result?.status==='key_required'?{...item,auth:'api_key'}:item;
    if(!connected&&connectionItem.auth!=='api_key'&&isOffCanonicalHost(window.location.hostname)){
      const destination=new URL('/',CANONICAL_APP_ORIGIN);
      destination.searchParams.set('workspace','1');destination.searchParams.set('connect',item.name);
      if(reconnect)destination.searchParams.set('reconnect','1');
      window.location.replace(destination.toString());return;
    }
    if(!connected&&item.auth==='registered_oauth'&&!item.oauth_client_configured&&!available.some(connection=>sameEndpoint(connection.url,item.url))){
      setRegistration({item,callback:CANONICAL_APP_ORIGIN+'/api/plugin-oauth/callback',reconnect});
      setClientScope(item.url===CANVA_MCP_URL?CANVA_READ_SCOPE:'');
      setError('');setNotice('');setRefreshableError(false);return;
    }
    connecting.current=true;setBusy(true);setConnectingName(item.name);setError('');setRefreshableError(false);
    if(connectionItem.auth!=='api_key')preparePopup(item.name);
    try{await begin(connectionItem,reconnect);setRegistration(null);}catch(e){popup.current?.close();setBusy(false);setNotice('');connectionFailure(e,item,reconnect);}finally{connecting.current=false;setConnectingName('');}
  }
  async function submitSearch(event:FormEvent){
    event.preventDefault();
    const query=search.trim();if(!query)return;
    if(!connectionsLoaded){setError('Your saved connections are still loading. Retry if they could not be loaded.');setRefreshableError(connectionsLoadFailed);return;}
    if(connecting.current||flow)return;
    if(query.toLocaleLowerCase()==='lovable'||normalizeHost(query)==='lovable.dev'||normalizeHost(query)==='mcp.lovable.dev'){await connectItem(lovableItem);return;}
    const match=exactCatalogMatch(query,appCatalog);
    if(match){
      if(needsManualSetup(match)){setManualOpen(true);setNotice(`${match.name} needs additional setup. Its options are below; your account has not been connected.`);return;}
      await connectItem(match);return;
    }
    if(!isWebsiteQuery(query)){
      setRefreshableError(false);setNotice(filtered.length?`Choose a service below to connect${filtered.length===1?`: ${filtered[0].name}`:'.'}`:'No matching service. Enter a provider website to check for a published connector.');
      setError('');return;
    }
    if(isOffCanonicalHost(window.location.hostname)){
      const destination=new URL('/',CANONICAL_APP_ORIGIN);destination.searchParams.set('workspace','1');destination.searchParams.set('connect','search');destination.searchParams.set('q',query);
      window.location.replace(destination.toString());return;
    }
    connecting.current=true;setBusy(true);setError('');setRefreshableError(false);setNotice('');preparePopup();
    let resolved:CatalogEntry|null=null;
    try{resolved=await api.resolvePlugin(query);await begin(resolved);}
    catch(e){popup.current?.close();setBusy(false);setNotice('');if(resolved)connectionFailure(e,resolved);else setError(e instanceof Error?e.message:'Could not find a published connector for this website.');}finally{connecting.current=false;}
  }
  async function connectCustom(event:FormEvent){
    event.preventDefault();if(connecting.current||flow)return;connecting.current=true;setBusy(true);setError('');setRefreshableError(false);setNotice('');
    try{
      const parsed=new URL(url.trim());
      if(parsed.protocol!=='https:')throw new Error('Use the HTTPS server address supplied by the company.');
      if(parsed.hostname==='vercel.com')throw new Error('This is a Vercel dashboard URL. Open Browse and enter vercel.com; we will find the right connector for you.');
      if(authHeader.trim().toLocaleLowerCase()==='cookie')throw new Error('Browser session cookies cannot be used as API keys. Use the provider’s sign-in flow or a token issued in its developer settings.');
      const item={id:'custom',name:name.trim()||parsed.hostname,url:url.trim(),description:'',category:'Custom',domains:[parsed.hostname]};
      if(token.trim()){
        const approval_id=await approveConnection('connect_plugin:'+item.url);const connection=await api.connectPlugin({name:item.name,url:item.url,token:token.trim(),auth_header:authHeader,approval_id});setToken('');await verifyConnection(connection.id,connection.name,true);
      }else if(isOffCanonicalHost(window.location.hostname)){
        const destination=new URL('/',CANONICAL_APP_ORIGIN);destination.searchParams.set('workspace','1');destination.searchParams.set('connect','custom');destination.searchParams.set('server',parsed.toString());
        window.location.replace(destination.toString());
      }else{preparePopup(item.name);await begin(item);}
    }catch(e){popup.current?.close();setBusy(false);setError(e instanceof Error?e.message:'Connection failed.');}finally{connecting.current=false;}
  }
  async function connectionAction(action:()=>Promise<unknown>){setBusy(true);setError('');setRefreshableError(false);try{await action();setPlugins(await api.getPlugins());}catch(e){setError(e instanceof Error?e.message:'Could not update this connection.');}finally{setBusy(false);}}
  async function verifyConnection(id:string|undefined,name:string,justConnected=false){
    if(testing.current)return;
    testing.current=true;setBusy(true);setTestingId(id||'');setError('');setRefreshableError(false);
    if(justConnected){setView('connected');setSearch(name);}
    setNotice(id?`${name}: checking its tools…`:`${name} connected. Tools were discovered; choose Test tools to verify access.`);
    try{
      if(id){
        const result=await api.testPlugin(id);
        if(!mounted.current)return;
        const prefix=justConnected?`${name} connected. `:`${name}: `;
        setNotice(prefix+result.message+(result.latency_ms!==undefined?` (${(result.latency_ms/1000).toFixed(1)}s)`:''));
        if(result.status==='failed')setError(result.message);
      }
    }catch(failure){
      if(mounted.current){
        setNotice(justConnected?`${name} connected, but its tools still need a successful check. The saved connection was preserved.`:'');
        setError(failure instanceof Error?failure.message:'The tool check could not finish. Try again.');
      }
    }finally{
      // Even HTTP 401 tests persist new evidence. Always replace stale success
      // with that evidence; a failed test must never delete the saved grant.
      try{if(mounted.current){const current=await api.getPlugins();if(mounted.current)setPlugins(current);}}
      catch{if(mounted.current){setError(current=>[current,'Could not refresh connection status. Retry to see the latest result.'].filter(Boolean).join(' '));setRefreshableError(true);}}
      testing.current=false;
      if(mounted.current){setTestingId('');setBusy(false);}
    }
  }
  async function testTools(plugin:PluginConnection){await verifyConnection(plugin.id,plugin.name);}
  async function enableDevice(){setBusy(true);setError('');setRefreshableError(false);try{await enrollDevice();setDevice(true);setNotice('Device approval enabled.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function setupAccount(){setBusy(true);setError('');setRefreshableError(false);try{const approval_id=await approveConnection('setup_account:'+accountUrl.trim());await api.setupPluginAccount({name:'New service',signup_url:accountUrl.trim(),email:accountEmail.trim(),approval_id});setNotice('Account setup is queued in Your team. Creating an account does not automatically connect its tools.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const query=search.trim().toLocaleLowerCase();
  const accountPlugins=plugins.filter(isAccountPlugin);
  const publicPluginCount=plugins.length-accountPlugins.length;
  const isCatalogConnected=(item:CatalogEntry)=>isConnected(item);
  const lovableItem:CatalogEntry={id:'lovable-mcp',name:'Lovable',url:LOVABLE_MCP_URL,description:'Create and edit projects with your Lovable account.',category:'Development',domains:['lovable.dev','mcp.lovable.dev'],source:LOVABLE_SOURCE,auth:'oauth',transport:'streamable-http'};
  const appCatalog=catalog.some(item=>normalizeHost(item.url)==='mcp.lovable.dev')?catalog:[...catalog,lovableItem];
  const displayCatalog=new Map<string,CatalogEntry>();
  for(const item of appCatalog){const key=displayAddress(item.url);if(!displayCatalog.has(key))displayCatalog.set(key,item);}
  function needsManualSetup(item:CatalogEntry){return !isCatalogConnected(item)&&Boolean(item.setup_note||item.auth==='api_key'||item.auth==='setup'||['setup_required','key_required'].includes(sync?.results[item.id]?.status||''));}
  const categories=Array.from(new Set(appCatalog.map(item=>item.category.trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  const popular=['linear','notion','vercel','github','figma','canva','outlook email · mintmcp','outlook calendar · mintmcp','windsor.ai'];
  const matches=appCatalog.filter(item=>(Boolean(query)||!isCatalogConnected(item))&&(activeCategory==='All'||item.category===activeCategory)&&[item.name,item.description,...item.domains].join(' ').toLocaleLowerCase().includes(query));
  const manualMatches=matches.filter(needsManualSetup);
  const filtered=matches.filter(item=>!needsManualSetup(item)).sort((a,b)=>{
    const rank=(item:CatalogEntry)=>{const index=popular.indexOf(item.name.toLocaleLowerCase());return index<0?popular.length:index;};
    return Number(isCatalogConnected(b))-Number(isCatalogConnected(a))||rank(a)-rank(b)||a.name.localeCompare(b.name);
  });
  const curatedUrls=new Set(catalog.map(item=>item.url).filter(Boolean));
  const registryVisible=registryItems.filter(item=>!item.url||!curatedUrls.has(item.url));
  const lovableActive=connectingName.toLocaleLowerCase()==='lovable'||flow?.name.toLocaleLowerCase()==='lovable';
  const connectionTerm=query;
  const connectedVisible=(query?plugins:publicTools?plugins.filter(plugin=>!isAccountPlugin(plugin)):plugins.some(isAccountPlugin)?plugins.filter(isAccountPlugin):plugins).filter(plugin=>!connectionTerm||[plugin.name,...plugin.tools.map(tool=>tool.name+' '+tool.description)].join(' ').toLocaleLowerCase().includes(connectionTerm)).sort((a,b)=>Number(b.authenticated)-Number(a.authenticated)||a.name.localeCompare(b.name));
  function connectionIdentity(plugin:PluginConnection){
    const item=displayCatalog.get(displayAddress(plugin.url));
    return {name:plugin.provider==='google'?'Google apps':item?.name||plugin.name,icon:item?.icon,provider:plugin.provider};
  }
  function connectorCard(item:CatalogEntry,keyPrefix='curated'){
    const connected=isCatalogConnected(item);
    const result=sync?.results[item.id];
    const needsEndpoint=!!item.setup_note&&!item.url;
    const manual=needsManualSetup(item);
    const unavailable=result?.status==='unavailable';
    const needsCanvaSetup=canvaUnavailable(item);
    const action=connected?'Manage':needsCanvaSetup?'Unavailable':manual?'View options':'Connect';
    return <article className="connector-entry" key={`${keyPrefix}:${item.id}`}>
      <Logo item={item}/><div className="app-entry-copy"><h4>{item.name}</h4><p>{item.description||'Use this app with Cypher.'}</p>{connected?<span className="connector-access-hint">Already in your apps</span>:needsCanvaSetup?<span className="connector-access-hint">Canva connections aren’t available yet.</span>:manual?<span className="connector-access-hint">Additional setup needed</span>:unavailable?<span className="connector-access-hint">Couldn’t reach this app at its last check</span>:null}
      </div>
      <button disabled={busy||!connectionsLoaded||needsEndpoint||!item.url||needsCanvaSetup} className="connector-connect" aria-label={`${action} ${item.name}`} onClick={()=>void connectItem(item)}>{action}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
    </article>;
  }
  const panelContent=<>
    <header className="connectors-header"><div><h2 id="plugins-title">Apps</h2><p>Connect the apps you use. You choose what Cypher can access.</p></div><button className="connector-close" aria-label="Close connections" onClick={onClose}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <nav className="connector-tabs simple-connector-tabs" aria-label="Connection pages">
      <button type="button" aria-pressed={view==='browse'} onClick={()=>chooseView('browse')}>Find apps</button>
      <button type="button" aria-pressed={view==='connected'} onClick={()=>chooseView('connected')}>My apps{plugins.length?<span className="plugin-tab-count">{' · '+plugins.length}</span>:null}</button>
      <details className="simple-app-options" data-active={view==='custom'||view==='settings'}><summary>More options</summary><div>
        <button type="button" onClick={event=>{chooseView('custom');event.currentTarget.closest('details')?.removeAttribute('open');}}>Add a connection link</button>
        <button type="button" onClick={event=>{chooseView('settings');event.currentTarget.closest('details')?.removeAttribute('open');}}>Connection settings</button>
      </div></details>
    </nav>
    <div key={view} ref={body} className="connectors-body" aria-busy={view==='browse'?catalogLoading:loading} data-view={view}>
      {connectingName.toLocaleLowerCase()==='lovable'&&!flow?<div className="lovable-connect-progress" role="status"><LovableMark active/><div><strong>Opening Lovable</strong><p>Preparing Lovable’s secure sign-in. You’ll review access on Lovable before anything connects.</p></div></div>:null}
      {flow?<section className={`connector-authorization${lovableActive?' lovable-authorization':''}`} aria-labelledby="plugin-sign-in-title">{lovableActive?<div className="lovable-auth-heading"><LovableMark active/><div><h3 id="plugin-sign-in-title">Connect Lovable</h3><p>Sign in, review access, then press Allow.</p></div></div>:<h3 id="plugin-sign-in-title">Connect {flow.name}</h3>}<ol>{lovableActive?<><li>Sign in to Lovable in the secure window.</li><li>Review the permissions Lovable lists and press <strong>Allow</strong>.</li><li>Return here while we verify the available tools.</li></>:<><li>Sign in on {flow.name}’s page.</li><li>Review the permissions and choose Allow or Authorize.</li><li>Return here. We’ll verify the connection and load its tools.</li></>}</ol><div className="connector-login-actions"><a className="btn-primary" href={flow.url} target="_blank" rel="noopener noreferrer" onClick={event=>{try{if(popup.current&&!popup.current.closed){event.preventDefault();popup.current.focus();}}catch{}}}>Continue to {flow.name}</a><button className="btn-secondary" type="button" disabled={checkingSignIn} onClick={()=>void checkSignIn.current()}>{checkingSignIn?'Checking…':'Check connection'}</button><button type="button" disabled={cancellingSignIn} onClick={()=>void cancelSignIn()}>{cancellingSignIn?'Cancelling…':'Cancel sign-in'}</button></div><p role="status">{flowError||'Waiting for provider approval. You can close this panel and continue later in this tab.'}{lovableActive?' Only tools Lovable authorizes are available; some Lovable actions may consume plan credits.':''}</p></section>:null}
      {notice?<div className="connector-notice" role="status">{notice}</div>:null}
      {disconnected?<div className="connector-error" role="status">Cypher is disconnected from its cloud runtime. Saved connections and past tool tests may be out of date. Reconnect, then use Test tools to check live access.</div>:refreshableError&&plugins.length?<div className="connector-notice" role="status">Showing saved connections. Their current status could not be refreshed.</div>:null}
      {registration?<section className="plugin-registration" aria-labelledby="plugin-registration-title"><div className="plugin-registration-heading"><div><h3 id="plugin-registration-title">Sign-in isn’t ready for {registration.item.name} yet</h3><p>Cypher needs provider setup before this app can connect. Your account has not been connected.</p></div><button type="button" aria-label="Close connection setup" onClick={()=>{setRegistration(null);setClientSecret('');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><details className="apps-advanced-list"><summary>Advanced setup for app administrators</summary><p>Use a client registered with this provider. Most people can choose another app and leave this setup to their administrator.</p><form onSubmit={event=>void connectRegisteredClient(event)}><label htmlFor="oauth-callback">Callback URL</label><input id="oauth-callback" readOnly value={registration.callback} onFocus={event=>event.currentTarget.select()}/><div className="oauth-client-fields"><label>Client ID<input required autoComplete="off" value={clientId} onChange={event=>setClientId(event.target.value)} maxLength={2000}/></label><label>Client secret <small>if required</small><input type="password" autoComplete="new-password" value={clientSecret} onChange={event=>setClientSecret(event.target.value)} maxLength={4096}/></label></div><details><summary>Requested scopes</summary><input aria-label="OAuth scopes" value={clientScope} onChange={event=>setClientScope(event.target.value)} maxLength={2000}/></details><div className="plugin-registration-actions"><button type="submit" className="btn-primary" disabled={busy||!clientId.trim()}>Connect with OAuth</button>{normalizeHost(registration.item.url)==='mcp.lovable.dev'?<a href="https://docs.lovable.dev/features/oauth-clients" target="_blank" rel="noreferrer">Lovable setup guide</a>:registration.item.source?<a href={registration.item.source} target="_blank" rel="noreferrer">Provider setup guide</a>:null}</div>{normalizeHost(registration.item.url)==='mcp.lovable.dev'?<p className="field-help">Lovable requires Business or Enterprise for project and workspace scopes. Client details stay encrypted on the server.</p>:<p className="field-help">Use your own registered client. Credentials stay encrypted on the server.</p>}</form></details></section>:null}
      {error&&!(disconnected&&error===CONNECTION_LOAD_ERROR)?<div className="connector-error" role="alert">{error}{refreshableError?<button type="button" className="connector-retry" disabled={loading||busy} onClick={()=>void retryLoad()}>Refresh connections</button>:null}</div>:null}
      {view==='browse'?<>
        <section className="store-search" aria-label="Find an app">
          <form className="website-connect" onSubmit={event=>void submitSearch(event)}>
            <label className="visually-hidden" htmlFor="plugin-search">Search apps or paste a website</label>
            <div className="website-search"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.4 4.4"/></svg><input id="plugin-search" type="search" value={search} onChange={event=>{setSearch(event.target.value);setActiveCategory('All');setNotice('');setError('');setRefreshableError(false);}} placeholder="Search apps or paste a website…" maxLength={1000} autoComplete="off"/>{search.trim()?<button className="btn-primary" disabled={busy}>{busy?'Connecting…':isWebsiteQuery(search)?'Find app':'Search'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>:null}</div>
          </form>
        </section>
        {loading||accountPlugins.length||connectionsLoadFailed?<section className="apps-connected" aria-labelledby="apps-connected-title">
          <div className="apps-section-heading"><h3 id="apps-connected-title">Your apps{connectionsLoaded&&accountPlugins.length?` · ${accountPlugins.length}`:''}</h3>{plugins.length?<button type="button" onClick={()=>{setSearch('');chooseView('connected');}}>Manage all<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>:null}</div>
          {loading?<LoadingState label="Loading connected apps…" rows={2}/>:connectionsLoadFailed&&!connectionsLoaded?<div className="apps-empty-connections" role="alert">Could not load your saved connections. <button type="button" className="connector-retry" onClick={()=>void retryLoad()}>Retry connections</button></div>:<div className="apps-connected-grid">{accountPlugins.filter(plugin=>!query||[plugin.name,connectionIdentity(plugin).name].join(' ').toLocaleLowerCase().includes(query)).slice(0,query?accountPlugins.length:4).map(plugin=>{
            const identity=connectionIdentity(plugin),status=pluginStatus(plugin);
            return <button type="button" key={plugin.id} className="apps-account-card" data-readiness={status.tone} title={status.detail} onClick={()=>{chooseView('connected');setSearch(plugin.name);}} aria-label={`Manage ${plugin.name}`}>
              <Logo item={identity}/><span className="apps-account-copy"><strong>{identity.name}</strong><span>{identity.name!==plugin.name?plugin.name:status.label}</span></span><span className="app-connection-indicator" aria-label={status.label}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={status.tone==='success'?'m5 12 4 4L19 6':status.tone==='warning'?'M12 7v6m0 4h.01':'m9 5 7 7-7 7'}/></svg></span>
            </button>;
          })}</div>}
          {!loading&&query&&!accountPlugins.some(plugin=>[plugin.name,connectionIdentity(plugin).name].join(' ').toLocaleLowerCase().includes(query))?<p className="apps-empty-connections">No connected apps match your search.</p>:null}
        </section>:null}
        {connectionsLoaded&&!query&&!plugins.some(p=>p.provider==='google')?<article className="apps-google-connect" aria-label="Google apps"><Logo item={{name:'Google apps',provider:'google'}}/><div><h3>Bring your Google apps together</h3><p>Gmail, Calendar, Drive, and more. Choose which ones Cypher can use.</p></div><a className="connector-connect" href="/connect/google">Connect Google</a></article>:null}
        <div className="connected-service-actions"><a className="btn-secondary" href="/connect/meta">Connect Facebook &amp; Instagram</a></div>
        {available.length?<section className="store-available"><div><h3>Available accounts</h3><p>Use a connection already available in this workspace.</p></div><div className="connected-service-actions">{available.map(c=><button type="button" key={c.id} disabled={busy} onClick={()=>void connectItem({id:c.id,name:c.name,url:c.url,domains:c.domains,category:'Development',description:'',connection_id:c.id})}>{c.reuse_available?`Use ${c.name}`:`Connect ${c.name}`}</button>)}</div></section>:null}
        <section className="store-browse" aria-labelledby="store-browse-title">
          {!connectionsLoaded&&!connectionsLoadFailed?<p role="status">Checking your saved connections…</p>:null}
          <div className="store-browse-heading"><h3 id="store-browse-title">{query?'Search results':'Discover apps'}</h3></div>
          <div className="store-categories" role="group" aria-label="App categories"><button type="button" aria-pressed={activeCategory==='All'} onClick={()=>setActiveCategory('All')}>All apps</button>{categories.map(category=><button type="button" key={category} aria-pressed={activeCategory===category} onClick={()=>setActiveCategory(category)}>{category}</button>)}</div>
          {catalogLoading?<LoadingState label="Loading apps…" rows={4}/>:catalogLoadFailed&&!catalogLoaded?<div className="connector-empty" role="alert"><h3>App catalog unavailable</h3><p>Cypher couldn’t load the app catalog. Try again to browse available services.</p><button type="button" className="btn-secondary" onClick={()=>void retryLoad()}>Retry catalog</button></div>:<div className="connector-catalog">{filtered.slice(0,visibleCount).map(item=>connectorCard(item))}</div>}
          {!catalogLoading&&catalogLoaded&&!matches.length?<div className="connector-empty"><h3>No matching apps</h3><p>Try another name or paste the app’s website above.</p><button className="btn-secondary" onClick={()=>{setSearch('');setActiveCategory('All');}}>Clear search</button></div>:null}
          {filtered.length>visibleCount?<button className="apps-load-more" onClick={()=>setVisibleCount(n=>n+24)}>Show more apps<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>:null}
          {!catalogLoading&&catalogLoaded&&manualMatches.length?<details className="apps-advanced-list" open={manualOpen} onToggle={event=>setManualOpen(event.currentTarget.open)}><summary>Apps that need additional setup <span>{manualMatches.length}</span></summary><p>These apps need an access key or setup by their administrator. They don’t offer simple sign-in here yet.</p><div className="connector-catalog">{manualMatches.slice(0,visibleCount).map(item=>connectorCard(item,'manual'))}</div>{manualMatches.length>visibleCount?<button className="apps-load-more" onClick={()=>setVisibleCount(n=>n+24)}>Show more setup options</button>:null}</details>:null}
        </section>
        {query.length>=2?<details className="mcp-registry-results apps-advanced-list" open={moreResultsOpen} onToggle={event=>setMoreResultsOpen(event.currentTarget.open)}><summary>Search more connections</summary><p>Community-published connections may need extra setup. Check the provider before allowing access.</p>{registryLoading?<LoadingState label="Searching more apps…" rows={4}/>:null}{registryError?<p className="connector-error" role="alert">{registryError}<button className="connector-retry" onClick={()=>setRegistryRetry(value=>value+1)}>Retry search</button></p>:null}{moreResultsOpen&&!registryLoading&&!registryError&&!registryVisible.length?<p className="registry-empty">No additional results for “{search}”.</p>:null}{moreResultsOpen&&registryVisible.length?<div className="connector-catalog">{registryVisible.map(item=>connectorCard(item,'mcp'))}</div>:null}{registryCursor?<button className="btn-secondary" disabled={registryLoadingMore} onClick={()=>void loadMoreRegistry()}>{registryLoadingMore?'Loading…':'Load more apps'}</button>:null}</details>:null}
        <details className="mcp-directory-disclosure apps-advanced-list" onToggle={event=>setDirectoryOpen(event.currentTarget.open)}><summary>Advanced connection options</summary>{directoryOpen?<><p>Browse the community directory or add a connection supplied by your service.</p><McpDirectory busy={busy} connectedUrls={plugins.map(plugin=>plugin.url)} onConnect={entry=>void connectItem(entry)} /></>:null}{publicPluginCount>0?<button type="button" className="connection-kind-toggle" onClick={()=>{setPublicTools(true);setSearch('');chooseView('connected');}}>Public tools · {publicPluginCount}</button>:null}</details>
      </>:null}
      {view==='connected'?<><div className="catalog-heading"><div><h3>{publicTools&&!query?'Public tools':'Your connections'} {connectionsLoaded?<span>{connectedVisible.length}</span>:null}</h3><p>Manage access to connected accounts. Create and manage reusable skill recipes separately in your workspace library.</p>{plugins.some(isAccountPlugin)&&plugins.some(plugin=>!isAccountPlugin(plugin))?<button type="button" className="connection-kind-toggle" onClick={()=>{setPublicTools(value=>!value);setSearch('');}}>{publicTools?'Account connections':`Public tools · ${plugins.filter(plugin=>!isAccountPlugin(plugin)).length}`}</button>:null}{onManageSkills?<button type="button" className="btn-secondary" onClick={onManageSkills}>Saved instructions</button>:null}</div><input type="search" aria-label="Search my apps" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search connected services or tools…"/></div>{loading?<LoadingState label="Loading your connections…" rows={4}/>:connectionsLoadFailed&&!connectionsLoaded?<div className="connector-empty" role="alert"><h3>Connections unavailable</h3><p>Cypher couldn’t load your saved connections. Try again to check which services are connected.</p><button type="button" className="btn-secondary" onClick={()=>void retryLoad()}>Retry connections</button></div>:!plugins.length?<div className="connector-empty"><h3>No tools connected yet</h3><p>Find a service in the app store or add its connection link.</p><div className="connector-empty-actions"><button className="btn-primary" onClick={()=>chooseView('browse')}>Browse apps</button><button className="btn-secondary" onClick={()=>chooseView('custom')}>Add by link</button></div></div>:!connectedVisible.length?<div className="connector-empty">No connected services match your search.</div>:connectedVisible.map(plugin=><section className="connected-service" key={plugin.id}><div className="connected-service-header"><Logo item={connectionIdentity(plugin)}/><div><h3>{plugin.name}</h3><p>{plugin.tools.length} tools · {plugin.enabled?'Enabled for agents':'Paused'} · {plugin.authenticated?'Account or API access linked':'Public tools · no account linked'} · {pluginStatus(plugin).label}</p></div><button type="button" className="btn-secondary" disabled={busy||!plugin.enabled} onClick={()=>void testTools(plugin)}>{testingId===plugin.id?'Checking tools…':!plugin.enabled?'Enable to test':plugin.verification?.status==='passed'?'Test again':'Test tools'}</button><button className="btn-secondary" role="switch" aria-checked={plugin.enabled} aria-label={`Enable ${plugin.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.togglePlugin(plugin.id,!plugin.enabled))}>{plugin.enabled?'Pause':'Enable'}</button></div><details open={Boolean(query)}><summary>Manage tools</summary>{plugin.tools.filter(tool=>!query||plugin.name.toLocaleLowerCase().includes(query)||(tool.name+' '+tool.description).toLocaleLowerCase().includes(query)).map(tool=><div className="connected-tool" key={tool.name}><div><strong>{tool.name}</strong><p>{tool.description}</p></div><button className="btn-secondary" role="switch" aria-checked={tool.enabled!==false} aria-label={`Enable ${tool.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.setPluginTool(plugin.id,tool.name,tool.enabled===false))}>{tool.enabled===false?'Turn on':'Turn off'}</button></div>)}<div className="connected-service-actions">{plugin.authenticated?<button type="button" disabled={busy||!plugin.enabled} onClick={()=>onExploreConnection?.(plugin.name)}>See what’s in my account</button>:null}{plugin.url.startsWith('site-mcp://') ? plugin.url === 'site-mcp://gmail.com' ? <a href="/connect/google">Use Google apps</a> : <button type="button" disabled={busy} onClick={()=>{setView('browse');setSearch(plugin.url === 'site-mcp://instagram.com' ? 'Instagram' : plugin.name);setNotice('Choose a supported provider and sign in to verify its tools.');}}>Find provider</button> : <button disabled={busy} onClick={()=>void connectItem({...catalog.find(item=>item.url===plugin.url),id:plugin.id,name:plugin.name,url:plugin.url,description:'',category:'Custom',domains:[],connection_id:plugin.connection_id},true)}>Reconnect</button>}<button disabled={busy} onClick={()=>void connectionAction(()=>api.refreshPlugin(plugin.id))}>Refresh tools</button><button disabled={busy} onClick={()=>void connectionAction(()=>api.disconnectPlugin(plugin.id))}>Disconnect</button></div></details></section>)}</>:null}
      {view==='custom'?<form className="connector-custom" onSubmit={event=>void connectCustom(event)}><h3>Connect with a link</h3><p>Paste an MCP server link. If it supports sign-in, Cypher opens the service so you can sign in and approve access.</p><label htmlFor="plugin-url">Service or MCP link</label><input id="plugin-url" type="url" value={url} onChange={event=>setUrl(event.target.value)} required placeholder="https://service.com/mcp"/><details className="connector-custom-advanced"><summary>I have an API key or need custom options</summary><label htmlFor="plugin-token">API key or bearer token <span>optional</span></label><input id="plugin-token" type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} placeholder="Paste the key from the service"/><label htmlFor="plugin-auth-header">API key header</label><input id="plugin-auth-header" value={authHeader} onChange={event=>setAuthHeader(event.target.value)} placeholder="Authorization or X-API-Key"/><label htmlFor="plugin-name">Connection name <span>optional</span></label><input id="plugin-name" value={name} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="Use the server name"/><p className="field-help">Keys are encrypted on the server. Connected tools can read or change data based on the permissions you grant.</p></details><div className="connector-custom-actions"><button className="btn-primary" disabled={busy}>{busy?'Connecting…':'Connect service'}</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>chooseView('browse')}>Browse apps</button></div></form>:null}
      {view==='settings'?<div className="connector-settings"><h3>Connection settings</h3><section><h4>Device approval</h4><p>{device?'New connections require your registered passkey.':'Confirm new connections with a device passkey, Touch ID, Face ID, or Windows Hello.'}</p>{!device?<button className="btn-secondary" disabled={busy} onClick={()=>void enableDevice()}>Enable device approval</button>:null}</section><section><h4>Email connections</h4>{Object.entries(accountState).map(([service,state])=><p key={service}><strong>{service==='gmail'?'Gmail':'Resend'} · {state.configured?'Configured':'Not connected'}</strong><br/>{state.detail}</p>)}</section><details><summary>Catalog reachability checks</summary><p>Check the curated endpoints in the background. This verifies reachability and available tools; sign-in still needs your approval.</p><button type="button" className="btn-secondary" disabled={busy||syncing} onClick={()=>void syncAll()}>{syncing?'Checking catalog…':sync?'Check again':'Check catalog'}</button>{sync?<p role="status">{sync.checked} of {sync.total} checked · {sync.counts.connected||0} reachable · {(sync.counts.sign_in_required||0)+(sync.counts.key_required||0)+(sync.counts.setup_required||0)} need setup · {sync.counts.unavailable||0} unavailable{syncing?' · Continues in the cloud.':''}</p>:null}</details><details><summary>Account signup assistance</summary><label htmlFor="account-signup">Signup page</label><input id="account-signup" type="url" value={accountUrl} onChange={event=>setAccountUrl(event.target.value)} placeholder="https://service.com/signup"/><label htmlFor="account-email">Account email</label><input id="account-email" type="email" value={accountEmail} onChange={event=>setAccountEmail(event.target.value)} placeholder="Your email"/><button disabled={busy||!accountUrl||!accountEmail} className="btn-secondary" onClick={()=>void setupAccount()}>Start account setup</button></details><details><summary>Server configuration</summary><div className="variable-inventory">{variables.map(variable=><div key={variable.target}><span><strong>{variable.name}</strong><small>{variable.project}</small></span><span>{variable.state==='configured'?'Configured':'Needs link'}</span></div>)}</div></details></div>:null}    </div>
  </>;
  return embedded?<section className="connectors-dialog app-store-dialog apps-workspace" aria-labelledby="plugins-title">{panelContent}</section>:<dialog ref={dialog} className="connectors-dialog app-store-dialog" aria-labelledby="plugins-title" onCancel={event=>{event.preventDefault();onClose();}}>{panelContent}</dialog>;
}
