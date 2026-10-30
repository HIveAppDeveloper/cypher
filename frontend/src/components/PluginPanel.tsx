import { LoadingState } from './LoadingState';
import { pluginStatus, isAccountPlugin } from '../lib/plugin-status';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { approveConnection, enrollDevice } from '../lib/device';
import { api } from '../lib/api';
import { PLUGIN_SIGN_IN_TTL, PLUGIN_STARTS_KEY, MAX_PLUGIN_SIGN_INS, readPluginSignIns, writePluginSignIns, pluginConnectionKeyHash, parsePluginSignIn, reservePluginStart, releasePluginStart, type PluginSignIn } from '../lib/pluginAuthorization';
import { ConnectionQueue, untilAborted, type ConnectionJob, type ConnectionOutcome } from '../lib/connectionQueue';
import { CANONICAL_APP_ORIGIN, isOffCanonicalHost } from '../lib/canonical-app';
import CypherMark from './cipher/CypherMark';
import BinaryLens from './cipher/BinaryLens';
import { McpDirectory } from './McpDirectory';
export interface PluginConnection { provider?:string; connection_id?:string; id:string;name:string;url:string;enabled:boolean;authenticated:boolean;verification?:{status:string;checked_at?:string;detail?:{tool?:string;latency_ms?:number;message?:string}};tools:{name:string;description:string;enabled?:boolean}[]; }
export interface CatalogEntry { id:string;name:string;url:string;description:string;category:string;domains:string[];icon?:string;source?:string;auth?:string;auth_header?:string;setup_note?:string;connection_id?:string;transport?:string;oauth_client_configured?:boolean; }
export interface AvailableConnection {id:string;name:string;url:string;domains:string[];reuse_available:boolean;method:string;}
export interface PluginSync {id:string;status:string;checked:number;total:number;counts:Record<string,number>;results:Record<string,{status:string;message:string;tool_count?:number;credential_source?:string}>;}
type View='browse'|'connected'|'custom'|'settings';
type QueuedConnection={item:CatalogEntry;reconnect:boolean;popup:Window|null;key:string;keyHash:string;reservationId:string;controller:AbortController};
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
function connectionKey(endpoint:string,connectionId?:string){try{return new URL(endpoint).href+'|'+(connectionId||'');}catch{return endpoint+'|'+(connectionId||'');}}
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
export function PluginPanel({onClose,onExploreConnection,onManageSkills,embedded=false}:{onClose:()=>void;onExploreConnection?:(name:string,pluginId:string)=>void|Promise<void>;onManageSkills?:()=>void;embedded?:boolean}){
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
  const [availableLoaded,setAvailableLoaded]=useState(false);
  const [availableLoadFailed,setAvailableLoadFailed]=useState(false);
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
  const [busy,setBusy]=useState(false);const [flows,setFlows]=useState<PluginSignIn[]>([]);
  const flowsRef=useRef<PluginSignIn[]>([]);const flow=flows[0]||null;
  const flowPopups=useRef(new Map<string,Window>());
  const pendingKeys=useRef(new Set<string>());
  const [queueJobs,setQueueJobs]=useState<ConnectionJob<QueuedConnection>[]>([]);
  const queueJobsRef=useRef<ConnectionJob<QueuedConnection>[]>([]);
  const queueRunner=useRef<(job:QueuedConnection)=>Promise<ConnectionOutcome>>(async()=>({state:'setup'}));
  const queue=useRef<ConnectionQueue<QueuedConnection>|null>(null);
  if(!queue.current)queue.current=new ConnectionQueue(async job=>{try{return await queueRunner.current(job);}finally{try{releasePluginStart(sessionStorage,job.reservationId);}catch{}}},jobs=>{queueJobsRef.current=jobs;setQueueJobs(jobs);},MAX_PLUGIN_SIGN_INS,job=>{job.controller.abort();job.popup?.close();try{releasePluginStart(sessionStorage,job.reservationId);}catch{}});
  const [connectingName,setConnectingName]=useState('');
  const [checkingSignIns,setCheckingSignIns]=useState<Record<string,boolean>>({});
  const [cancellingSignIns,setCancellingSignIns]=useState<Record<string,boolean>>({});
  const verificationChain=useRef<Promise<void>>(Promise.resolve());
  const checkSignIn=useRef<(id?:string)=>Promise<void>>(async()=>{});
  const connecting=useRef(false);
  const testing=useRef(false);
  const mounted=useRef(false);
  const [testingId,setTestingId]=useState('');
  const [exploringId,setExploringId]=useState('');
  const exploring=useRef(false);
  useEffect(()=>{mounted.current=true;if(!queue.current||queue.current.isDisposed)queue.current=new ConnectionQueue(async job=>{try{return await queueRunner.current(job);}finally{try{releasePluginStart(sessionStorage,job.reservationId);}catch{}}},jobs=>{queueJobsRef.current=jobs;setQueueJobs(jobs);},MAX_PLUGIN_SIGN_INS,job=>{job.controller.abort();job.popup?.close();try{releasePluginStart(sessionStorage,job.reservationId);}catch{}});return()=>{mounted.current=false;queue.current?.dispose();};},[]);
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
    void items;
    void api.getPlugins().then(value=>{if(active){setPlugins(value);setConnectionsLoaded(true);setConnectionsLoadFailed(false);}}).catch(()=>{if(active){setConnectionsLoadFailed(true);setError(CONNECTION_LOAD_ERROR);setRefreshableError(true);}}).finally(()=>{if(active)setLoading(false);});
    api.deviceStatus().then(s=>{if(active)setDevice(s.enrolled);}).catch(()=>{});
    api.getAvailableConnections().then(s=>{if(active){setAvailable(s);setAvailableLoaded(true);setAvailableLoadFailed(false);}}).catch(()=>{if(active)setAvailableLoadFailed(true);});
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
    let saved:PluginSignIn[]=[];
    try{saved=readPluginSignIns(sessionStorage);}catch{}
    if(result&&['connected','cancelled','failed'].includes(result)){
      const returned=params.get('plugin_flow');
      if(returned)saved=saved.filter(item=>item.id!==returned);
      else if(saved.length===1)saved=[];
      try{writePluginSignIns(sessionStorage,saved);}catch{}
      setView('connected');if(result==='connected')setNotice('Your app is connected. You can manage its access below.');else setError(result==='cancelled'?'Access was not allowed. Choose Connect to try again.':'Sign-in could not be verified. Choose Connect to try again.');
      const clean=new URL(window.location.href);clean.searchParams.delete('plugins');clean.searchParams.delete('plugin_flow');window.history.replaceState(window.history.state,'',clean.pathname+clean.search+clean.hash);
    }
    flowsRef.current=saved;if(saved.length){setFlows(saved);setNotice('Finish signing in on each provider’s page. Your progress is saved in this tab.');}
    const syncFlows=()=>{try{const latest=readPluginSignIns(sessionStorage);if(JSON.stringify(latest)!==JSON.stringify(flowsRef.current)){flowsRef.current=latest;setFlows(latest);}}catch{}};
    window.addEventListener('cypher-plugin-sign-ins-changed',syncFlows);
    return()=>{active=false;window.removeEventListener('cypher-plugin-sign-ins-changed',syncFlows);dialog.current?.close();previous?.focus();};
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
  async function retryLoad(){
    setLoading(true);setCatalogLoading(!catalogLoaded);setError('');setRefreshableError(false);
    const fail=()=>{if(mounted.current){setError('The connection service is unavailable. Try again shortly.');setRefreshableError(true);}};
    const items=api.getPluginCatalog().then(value=>{if(mounted.current){setCatalog(value);setCatalogLoaded(true);setCatalogLoadFailed(false);}}).catch(()=>{if(mounted.current){setCatalogLoadFailed(true);fail();}}).finally(()=>{if(mounted.current)setCatalogLoading(false);});
    const connections=api.getPlugins().then(value=>{if(mounted.current){setPlugins(value);setConnectionsLoaded(true);setConnectionsLoadFailed(false);}}).catch(()=>{if(mounted.current){setConnectionsLoadFailed(true);fail();}}).finally(()=>{if(mounted.current)setLoading(false);});
    const accounts=api.getAvailableConnections().then(value=>{if(mounted.current){setAvailable(value);setAvailableLoaded(true);setAvailableLoadFailed(false);}}).catch(()=>{if(mounted.current){setAvailableLoadFailed(true);fail();}});
    const status=api.pluginSyncStatus().then(value=>{if(mounted.current)setSync(value);}).catch(fail);
    await Promise.all([items,connections,accounts,status]);
  }
  async function loadMoreRegistry(){if(!registryCursor||registryLoadingMore)return;const term=search.trim();const cursor=registryCursor;setRegistryLoadingMore(true);setRegistryError('');try{const page=await api.searchMcpRegistry(term,cursor);if(registryQueryRef.current!==term)return;setRegistryItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.items.filter(item=>!seen.has(item.id))];});setRegistryCursor(page.next_cursor);}catch(e){if(registryQueryRef.current===term)setRegistryError(e instanceof Error?e.message:'Could not load more MCP servers.');}finally{if(registryQueryRef.current===term)setRegistryLoadingMore(false);}}  useEffect(()=>{
    if(!syncing)return;let active=true;let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const [job,connections]=await Promise.all([api.pluginSyncStatus(),api.getPlugins()]);if(!active)return;setSync(job);setPlugins(connections);}
      catch{if(active){setError('Could not refresh catalog progress. The cloud job keeps running; refresh connections to check again.');setRefreshableError(true);}}
      if(active)timer=setTimeout(poll,5000);
    }
    timer=setTimeout(poll,3000);return()=>{active=false;clearTimeout(timer);};
  },[syncing]);
  async function syncAll(){setBusy(true);setError('');setRefreshableError(false);try{const approval=await approveConnection('connect_plugin:catalog');setSync(await api.syncPlugins(approval));}catch(e){setError(e instanceof Error?e.message:'Could not start catalog sync.');}finally{setBusy(false);}}
  const pendingPolls=useRef(new Set<string>());
  const pollFailures=useRef(new Map<string,number>());
  const cancellingFlows=useRef(new Set<string>());
  const [flowErrors,setFlowErrors]=useState<Record<string,string>>({});
  const [flowResults,setFlowResults]=useState<{id:string;name:string;message:string}[]>([]);
  function showFlowFailure(current:PluginSignIn,message:string){
    const key=flowJobKey(current);if(key)queue.current?.update(key,'failed',message);
    else setFlowResults(previous=>[...previous.filter(value=>value.id!==current.id),{id:current.id,name:current.name,message}]);
  }
  function saveFlows(next:PluginSignIn[]){
    flowsRef.current=next;try{writePluginSignIns(sessionStorage,next);window.dispatchEvent(new Event('cypher-plugin-sign-ins-changed'));}catch{}
    if(mounted.current)setFlows(next);
  }
  function flowJobKey(current:PluginSignIn){return current.keyHash?queueJobsRef.current.find(job=>job.item.keyHash===current.keyHash)?.key:undefined;}
  function clearSignIn(id:string){
    const current=mounted.current?flowsRef.current:readPluginSignIns(sessionStorage);
    pollFailures.current.delete(id);saveFlows(current.filter(item=>item.id!==id));
    if(mounted.current){setFlowErrors(previous=>{const copy={...previous};delete copy[id];return copy;});setCheckingSignIns(previous=>({...previous,[id]:false}));setNotice('');setRefreshableError(false);}
  }
  function scheduleVerification(id:string|undefined,name:string,navigate:boolean){
    const task=verificationChain.current.then(async()=>{if(mounted.current)await verifyConnection(id,name,true,navigate);});
    verificationChain.current=task.catch(()=>{});
  }
  useEffect(()=>{
    if(!flows.length)return;let active=true;const timers=new Map<string,ReturnType<typeof setTimeout>>();
    function schedule(current:PluginSignIn){if(active&&flowsRef.current.some(value=>value.id===current.id)){clearTimeout(timers.get(current.id));timers.set(current.id,setTimeout(()=>void pollOne(current),Math.min(15000,AUTH_POLL_MS*2**Math.min(3,pollFailures.current.get(current.id)||0))));}}
    async function pollOne(current:PluginSignIn){
      if(!active)return;if(pendingPolls.current.has(current.id)){schedule(current);return;}
      pendingPolls.current.add(current.id);setCheckingSignIns(previous=>({...previous,[current.id]:true}));
      try{
        if(Date.now()-current.startedAt>=PLUGIN_SIGN_IN_TTL){
          clearSignIn(current.id);flowPopups.current.get(current.id)?.close();flowPopups.current.delete(current.id);
          showFlowFailure(current,'Sign-in expired. Try again.');return;
        }
        const state=await api.pluginAuthStatus(current.id);if(!active||cancellingFlows.current.has(current.id))return;
        if(state.status==='connected'){
          clearSignIn(current.id);flowPopups.current.get(current.id)?.close();flowPopups.current.delete(current.id);
          if(flowJobKey(current))queue.current?.update(flowJobKey(current)!,'connected','Connected.');
          const hasOthers=flowsRef.current.length>0||queueJobsRef.current.some(job=>['queued','connecting','waiting'].includes(job.state));
          scheduleVerification(state.plugin_id,state.name,!hasOthers);return;
        }
        if(['failed','cancelled','expired'].includes(state.status)){
          clearSignIn(current.id);flowPopups.current.get(current.id)?.close();flowPopups.current.delete(current.id);
          const message=state.status==='cancelled'?'Access was not allowed. Try again.':state.status==='expired'?'Sign-in expired. Try again.':'The connection could not be verified. Try again.';
          showFlowFailure(current,message);return;
        }
        pollFailures.current.delete(current.id);setFlowErrors(previous=>({...previous,[current.id]:''}));
      }catch{if(active){pollFailures.current.set(current.id,(pollFailures.current.get(current.id)||0)+1);const message='Could not check the connection yet. We’ll retry automatically; you can continue on the provider’s page.';setFlowErrors(previous=>({...previous,[current.id]:message}));}}
      finally{pendingPolls.current.delete(current.id);if(active){setCheckingSignIns(previous=>({...previous,[current.id]:false}));schedule(current);}}
    }
    checkSignIn.current=async(id?:string)=>{await Promise.all(flowsRef.current.filter(item=>!id||item.id===id).map(pollOne));};
    const resume=()=>{if(!document.hidden)for(const current of flowsRef.current)void pollOne(current);};
    window.addEventListener('focus',resume);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
    for(const current of flows)void pollOne(current);
    return()=>{active=false;timers.forEach(timer=>clearTimeout(timer));checkSignIn.current=async()=>{};window.removeEventListener('focus',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
  },[flows]);
  async function cancelSignIn(current:PluginSignIn){
    if(cancellingFlows.current.has(current.id))return;cancellingFlows.current.add(current.id);setCancellingSignIns(previous=>({...previous,[current.id]:true}));
    try{await api.cancelPluginAuth(current.id);flowPopups.current.get(current.id)?.close();flowPopups.current.delete(current.id);clearSignIn(current.id);if(flowJobKey(current))queue.current?.update(flowJobKey(current)!,'cancelled','Sign-in cancelled.');if(mounted.current){setBusy(false);setNotice('Sign-in cancelled. You can choose another service or try again.');setError('');}}
    catch{if(mounted.current){setFlowErrors(previous=>({...previous,[current.id]:'Could not cancel sign-in. Try again.'}));setRefreshableError(false);}}
    finally{cancellingFlows.current.delete(current.id);if(mounted.current)setCancellingSignIns(previous=>({...previous,[current.id]:false}));}
  }
  function chooseView(next:View){setView(next);setError('');setRefreshableError(false);if(!flow)setNotice('');}
  function preparePopup(provider='service'){
    const opened=window.open('about:blank',`grokbot-service-login-${Date.now()}-${Math.random().toString(36).slice(2)}`,'popup,width=620,height=760');
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
    popup.current=opened;return opened;
  }
  async function begin(item:CatalogEntry,reconnect=false,oauth_client?:{client_id:string;client_secret?:string;scope?:string}){
    const existing=plugins.find(plugin=>sameEndpoint(plugin.url,item.url) && (!item.connection_id||plugin.connection_id===item.connection_id));
    if(existing && !reconnect){setBusy(false);setView('connected');setSearch(existing.name);setNotice(`${existing.name} is already in your workspace. ${existing.enabled?'Its enabled tools are available to agents.':'Enable it below to let agents use its tools.'}`);popup.current?.close();return;}
    const keyHash=await pluginConnectionKeyHash(connectionKey(item.url,item.connection_id),window.crypto);
    if(flowsRef.current.some(value=>value.keyHash===keyHash||(!value.keyHash&&value.name.toLocaleLowerCase()===item.name.toLocaleLowerCase()))){popup.current?.close();setBusy(false);setNotice(`${item.name} is already waiting for sign-in.`);return;}
    if(item.setup_note){popup.current?.close();setBusy(false);setNotice(item.setup_note+' Source: '+(item.source||item.url));return;}
    if(item.auth==='api_key'){popup.current?.close();setView('custom');setUrl(item.url);setName(item.name);setAuthHeader(item.auth_header||'Authorization');setNotice(`${item.name} uses an API key. Get it from the service, then paste it below.`);setBusy(false);return;}
    const reservationId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if(!reservePluginStart(sessionStorage,keyHash,reservationId)){popup.current?.close();setBusy(false);setNotice(`${item.name} is already connecting, or the connection limit is reached.`);return;}
    try{
      setNotice(item.name.toLocaleLowerCase()==='lovable'?'':`Checking ${item.name}…`);
      const approval_id=await approveConnection('connect_plugin:'+item.url);
      if(!mounted.current){popup.current?.close();return;}
      const result=await api.authorizePlugin({name:item.name.slice(0,80),url:item.url,approval_id,reconnect,connection_id:item.connection_id,oauth_client});
      if(result.status==='connected'){
        popup.current?.close();if(mounted.current)await verifyConnection(result.plugin_id,result.name,true);
      }else if(result.authorization_url && result.flow_id){
        const next=parsePluginSignIn({id:result.flow_id,name:result.name,url:result.authorization_url,startedAt:Date.now(),keyHash});
        if(!next)throw new Error('The provider returned an invalid sign-in link.');
        const current=mounted.current?flowsRef.current:readPluginSignIns(sessionStorage);
        if(current.some(value=>value.id===next.id))throw new Error('The provider returned an existing sign-in. Try again.');
        saveFlows([...current,next]);if(popup.current)flowPopups.current.set(next.id,popup.current);if(mounted.current)setNotice('');
        try{if(popup.current&&!popup.current.closed){try{writePluginSignIns(popup.current.sessionStorage,[next]);popup.current.sessionStorage.removeItem(PLUGIN_STARTS_KEY);}catch{}popup.current.location.replace(next.url);}}catch{/* The visible link can reopen a closed or isolated provider window. */}
      }else throw new Error('This service did not provide a sign-in page. Try its advanced setup.');
    }finally{try{releasePluginStart(sessionStorage,reservationId);}catch{}}
  }
  function isConnected(item:CatalogEntry){return plugins.some(plugin=>sameEndpoint(plugin.url,item.url)&&(!item.connection_id||plugin.connection_id===item.connection_id));}
  function canvaUnavailable(item:CatalogEntry){return item.url===CANVA_MCP_URL&&connectionsLoaded&&availableLoaded&&!isConnected(item)&&!item.oauth_client_configured&&!available.some(connection=>sameEndpoint(connection.url,item.url));}
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
    event.preventDefault();if(!registration||connecting.current||queueJobsRef.current.some(job=>job.state==='connecting'))return;
    connecting.current=true;setBusy(true);setConnectingName(registration.item.name);setError('');preparePopup(registration.item.name);
    try{await begin(registration.item,registration.reconnect,{client_id:clientId.trim(),client_secret:clientSecret||undefined,scope:clientScope.trim()});setRegistration(null);}
    catch(error){popup.current?.close();setBusy(false);connectionFailure(error,registration.item,registration.reconnect);}
    finally{setClientSecret('');setConnectingName('');connecting.current=false;}
  }
  queueRunner.current=async job=>{
    const {item,reconnect,key}=job;
    const close=()=>{try{job.popup?.close();}catch{}};
    if(!mounted.current){close();return {state:'setup',message:'Open Apps to try again.'};}
    if(isConnected(item)&&!reconnect){close();return {state:'connected',message:'Already connected.'};}
    if(canvaUnavailable(item)){close();return {state:'setup',message:CANVA_UNAVAILABLE};}
    const result=sync?.results[item.id];
    if(item.setup_note||result?.status==='setup_required'||item.auth==='api_key'||item.auth==='setup'||result?.status==='key_required'){
      close();return {state:'setup',message:'This app needs additional setup before it can connect.'};
    }
    if(item.auth==='registered_oauth'&&!item.oauth_client_configured&&!available.some(connection=>sameEndpoint(connection.url,item.url))){
      close();return {state:'setup',message:'This app needs provider setup before it can connect.'};
    }
    try{
      const approval_id=await untilAborted(()=>approveConnection('connect_plugin:'+item.url),job.controller.signal);
      if(!mounted.current){close();return {state:'setup',message:'Open Apps to try again.'};}
      const response=await untilAborted(()=>api.authorizePlugin({name:item.name.slice(0,80),url:item.url,approval_id,reconnect,connection_id:item.connection_id},job.controller.signal),job.controller.signal);
      if(response.status==='connected'){
        close();if(mounted.current){const hasOthers=flowsRef.current.length>0||queueJobsRef.current.some(other=>other.key!==key&&['queued','connecting','waiting'].includes(other.state));scheduleVerification(response.plugin_id,response.name,!hasOthers);}return {state:'connected',message:'Connected.'};
      }
      if(!response.authorization_url||!response.flow_id)throw new Error('This app did not provide a sign-in page. Try again or check its setup.');
      const next=parsePluginSignIn({id:response.flow_id,name:response.name,url:response.authorization_url,startedAt:Date.now(),keyHash:job.keyHash});
      if(!next)throw new Error('The provider returned an invalid sign-in link.');
      // Read the current tab state when an old panel finishes after it was closed.
      const current=mounted.current?flowsRef.current:readPluginSignIns(sessionStorage);
      if(current.some(value=>value.id===next.id))throw new Error('The provider returned an existing sign-in. Try again.');
      saveFlows([...current,next]);
      if(job.popup)flowPopups.current.set(next.id,job.popup);
      try{if(job.popup&&!job.popup.closed){try{writePluginSignIns(job.popup.sessionStorage,[next]);job.popup.sessionStorage.removeItem(PLUGIN_STARTS_KEY);}catch{}job.popup.location.replace(next.url);}}catch{/* The per-app Continue link remains available. */}
      if(mounted.current){setNotice('');}
      return {state:'waiting',message:'Waiting for sign-in.'};
    }catch(error){
      close();const data=(error as {details?:Record<string,unknown>})?.details;
      if(item.url===CANVA_MCP_URL&&((error as {status?:number})?.status===409||data?.code==='oauth_registration_required')){if(mounted.current)connectionFailure(error,item,reconnect);return {state:'setup',message:CANVA_UNAVAILABLE};}
      if(data?.code==='oauth_registration_required'&&typeof data.callback_url==='string'){if(mounted.current)connectionFailure(error,item,reconnect);return {state:'setup',message:'This app needs provider setup.'};}
      throw error;
    }
  };
  async function connectItem(item:CatalogEntry,reconnect=false){
    if((!connectionsLoaded||loading||connectionsLoadFailed)&&!(isConnected(item)&&!reconnect)){setError(connectionsLoadFailed?'Could not check your saved connections. Refresh to try again.':'Checking your saved connections…');setRefreshableError(connectionsLoadFailed);return;}
    if(item.url===CANVA_MCP_URL&&!isConnected(item)&&!item.oauth_client_configured&&!availableLoaded){setError(availableLoadFailed?'Could not check available Canva connections. Refresh connections to try again.':'Checking available Canva connections…');setRefreshableError(availableLoadFailed);return;}
    if(item.url.endsWith('/api/google/mcp')){window.location.assign('/connect/google');return;}
    if(isConnected(item)&&!reconnect){const existing=plugins.find(plugin=>sameEndpoint(plugin.url,item.url)&&(!item.connection_id||plugin.connection_id===item.connection_id));if(existing){setView('connected');setSearch(existing.name);setNotice(`${existing.name} is already in your workspace. ${existing.enabled?'Its enabled tools are available to agents.':'Enable it below to let agents use its tools.'}`);}return;}
    if(isOffCanonicalHost(window.location.hostname)){
      const destination=new URL('/',CANONICAL_APP_ORIGIN);destination.searchParams.set('workspace','1');destination.searchParams.set('connect',item.name);
      if(reconnect)destination.searchParams.set('reconnect','1');window.location.replace(destination.toString());return;
    }
    const key=connectionKey(item.url,item.connection_id);
    if(flowsRef.current.some(value=>!value.keyHash&&value.name.toLocaleLowerCase()===item.name.toLocaleLowerCase())){setNotice(`${item.name} is already waiting for sign-in.`);return;}
    if(pendingKeys.current.has(key)||!queue.current?.canEnqueue(key))return;
    if(flowsRef.current.length+queueJobsRef.current.filter(job=>job.state==='queued'||job.state==='connecting').length+pendingKeys.current.size>=MAX_PLUGIN_SIGN_INS){setNotice('Finish or cancel a sign-in before adding another app.');return;}
    const manual=Boolean(canvaUnavailable(item)||item.setup_note||item.auth==='api_key'||item.auth==='setup'||['setup_required','key_required'].includes(sync?.results[item.id]?.status||'')||(item.auth==='registered_oauth'&&!item.oauth_client_configured&&!available.some(connection=>sameEndpoint(connection.url,item.url))));
    const opened=manual?null:preparePopup(item.name);if(popup.current===opened)popup.current=null;
    const controller=new AbortController();
    pendingKeys.current.add(key);
    try{
      const keyHash=await pluginConnectionKeyHash(key,window.crypto);
      const reservationId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if(!mounted.current||!reservePluginStart(sessionStorage,keyHash,reservationId)){opened?.close();if(mounted.current)setNotice('This app is already connecting, or the connection limit is reached.');return;}
      if(!queue.current?.enqueue(key,{item,reconnect,popup:opened,key,keyHash,reservationId,controller})){releasePluginStart(sessionStorage,reservationId);opened?.close();}
    }catch{opened?.close();if(mounted.current)setError('Could not prepare this connection. Try again.');}
    finally{pendingKeys.current.delete(key);}
  }
  function showSetupOptions(item:CatalogEntry,reconnect:boolean){
    if(item.url===CANVA_MCP_URL&&canvaUnavailable(item)){setNotice(CANVA_UNAVAILABLE);return;}
    const result=sync?.results[item.id];
    if(item.auth==='api_key'||result?.status==='key_required'){
      setView('custom');setUrl(item.url);setName(item.name);setAuthHeader(item.auth_header||'Authorization');
      setNotice(`${item.name} uses an API key. Get it from the service, then paste it below.`);return;
    }
    if(item.auth==='registered_oauth'&&!item.oauth_client_configured){
      setRegistration({item,callback:CANONICAL_APP_ORIGIN+'/api/plugin-oauth/callback',reconnect});setClientScope('');return;
    }
    setNotice(item.setup_note||result?.message||`${item.name} needs setup from its provider before it can connect.`);
  }
  async function submitSearch(event:FormEvent){
    event.preventDefault();
    const query=search.trim();if(!query)return;
    if(!connectionsLoaded||loading||connectionsLoadFailed){setError(connectionsLoadFailed?'Could not check your saved connections. Refresh to try again.':'Checking your saved connections…');setRefreshableError(connectionsLoadFailed);return;}
    if(query.toLocaleLowerCase()==='lovable'||normalizeHost(query)==='lovable.dev'||normalizeHost(query)==='mcp.lovable.dev'){await connectItem(lovableItem);return;}
    const match=exactCatalogMatch(query,appCatalog);
    if(match){
      if(needsManualSetup(match)){setManualOpen(true);setNotice(`${match.name} needs additional setup. Its options are below; your account has not been connected.`);return;}
      await connectItem(match);return;
    }
    if(connecting.current||flow)return;
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
    event.preventDefault();if(connecting.current||queueJobsRef.current.some(job=>job.state==='connecting'))return;connecting.current=true;setBusy(true);setError('');setRefreshableError(false);setNotice('');
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
  async function verifyConnection(id:string|undefined,name:string,justConnected=false,navigate=true){
    if(testing.current)return;
    testing.current=true;setBusy(true);setTestingId(id||'');setError('');setRefreshableError(false);
    if(justConnected&&navigate){setView('connected');setSearch(name);}
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
  async function exploreAccount(plugin:PluginConnection){
    if(!onExploreConnection||exploring.current||!plugin.enabled||!plugin.authenticated)return;
    exploring.current=true;setExploringId(plugin.id);
    try{await onExploreConnection(plugin.name,plugin.id);}
    finally{exploring.current=false;if(mounted.current)setExploringId('');}
  }
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
  const connectionTerm=query;
  const connectedVisible=(publicTools?plugins.filter(plugin=>!isAccountPlugin(plugin)):accountPlugins).filter(plugin=>!connectionTerm||[plugin.name,...plugin.tools.map(tool=>tool.name+' '+tool.description)].join(' ').toLocaleLowerCase().includes(connectionTerm)).sort((a,b)=>Number(b.authenticated)-Number(a.authenticated)||a.name.localeCompare(b.name));
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
    const job=queueJobs.find(value=>value.key===connectionKey(item.url,item.connection_id));
    const pending=Boolean(job&&['queued','connecting','waiting'].includes(job.state));
    const checkingCanva=item.url===CANVA_MCP_URL&&!connected&&!item.oauth_client_configured&&!availableLoaded;
    const action=connected?'Manage':needsCanvaSetup?'Unavailable':pending?'In progress':manual?'View options':'Connect';
    return <article className="connector-entry" key={`${keyPrefix}:${item.id}`}>
      <Logo item={item}/><div className="app-entry-copy"><h4>{item.name}</h4><p>{item.description||'Use this app with Cypher.'}</p>{connected?<span className="connector-access-hint">Already in your apps</span>:needsCanvaSetup?<span className="connector-access-hint">Canva connections aren’t available yet.</span>:manual?<span className="connector-access-hint">Additional setup needed</span>:unavailable?<span className="connector-access-hint">Couldn’t reach this app at its last check</span>:null}
      </div>
      <button disabled={((!connectionsLoaded||loading||connectionsLoadFailed)&&!connected)||needsEndpoint||!item.url||needsCanvaSetup||checkingCanva||pending} className="connector-connect" aria-label={`${action} ${item.name}`} onClick={()=>void connectItem(item)}>{action}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
    </article>;
  }
  const panelContent=<>
    <header className="connectors-header"><div><h2 id="plugins-title">Apps</h2><p>Connect the apps you use. You choose what Cypher can access.</p></div><button className="connector-close" aria-label="Close connections" onClick={onClose}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <nav className="connector-tabs simple-connector-tabs" aria-label="Connection pages">
      <button type="button" aria-pressed={view==='browse'} onClick={()=>chooseView('browse')}>Find apps</button>
      <button type="button" aria-pressed={view==='connected'} onClick={()=>chooseView('connected')}>My apps{accountPlugins.length?<span className="plugin-tab-count">{' · '+accountPlugins.length}</span>:null}</button>
      <details className="simple-app-options" data-active={view==='custom'||view==='settings'}><summary>More options</summary><div>
        <button type="button" onClick={event=>{chooseView('custom');event.currentTarget.closest('details')?.removeAttribute('open');}}>Add a connection link</button>
        <button type="button" onClick={event=>{chooseView('settings');event.currentTarget.closest('details')?.removeAttribute('open');}}>Connection settings</button>
      </div></details>
    </nav>
    <div key={view} ref={body} className="connectors-body" aria-busy={view==='browse'?catalogLoading:loading} data-view={view}>
      {connectingName.toLocaleLowerCase()==='lovable'&&!flow?<div className="lovable-connect-progress" role="status"><LovableMark active/><div><strong>Opening Lovable</strong><p>Preparing Lovable’s secure sign-in. You’ll review access on Lovable before anything connects.</p></div></div>:null}
      {flows.map(current=><section key={current.id} className={`connector-authorization${current.name.toLocaleLowerCase()==='lovable'?' lovable-authorization':''}`} aria-label={`Connect ${current.name}`}>{current.name.toLocaleLowerCase()==='lovable'?<div className="lovable-auth-heading"><LovableMark active/><div><h3>Connect Lovable</h3><p>Sign in, review access, then press Allow.</p></div></div>:<h3>Connect {current.name}</h3>}<ol>{current.name.toLocaleLowerCase()==='lovable'?<><li>Sign in to Lovable in the secure window.</li><li>Review the permissions Lovable lists and press <strong>Allow</strong>.</li><li>Return here while we verify the available tools.</li></>:<><li>Sign in on {current.name}’s page.</li><li>Review the permissions and choose Allow or Authorize.</li><li>Return here. We’ll verify the connection and load its tools.</li></>}</ol><div className="connector-login-actions"><a className="btn-primary" href={current.url} target="_blank" rel="noopener noreferrer" onClick={event=>{try{const opened=flowPopups.current.get(current.id);if(opened&&!opened.closed){event.preventDefault();opened.focus();return;}const reopened=window.open('about:blank','_blank');if(reopened){event.preventDefault();reopened.opener=null;try{writePluginSignIns(reopened.sessionStorage,[current]);reopened.sessionStorage.removeItem(PLUGIN_STARTS_KEY);}catch{}flowPopups.current.set(current.id,reopened);reopened.location.replace(current.url);}}catch{}}}>Continue to {current.name}</a><button className="btn-secondary" type="button" aria-label={`Check ${current.name} connection`} disabled={Boolean(checkingSignIns[current.id])} onClick={()=>void checkSignIn.current(current.id)}>{checkingSignIns[current.id]?'Checking…':'Check connection'}</button><button type="button" aria-label={`Cancel ${current.name} sign-in`} disabled={Boolean(cancellingSignIns[current.id])} onClick={()=>void cancelSignIn(current)}>{cancellingSignIns[current.id]?'Cancelling…':'Cancel sign-in'}</button></div><p role="status">{flowErrors[current.id]||'Waiting for provider approval. You can close this panel and continue later in this tab.'}{current.name.toLocaleLowerCase()==='lovable'?' Only tools Lovable authorizes are available; some Lovable actions may consume plan credits.':''}</p></section>)}
      {flowResults.map(result=><section key={result.id} className="connector-authorization" aria-label={`${result.name} connection result`}><h3>{result.name}</h3><p role="status">{result.message}</p><div className="connector-login-actions"><button type="button" className="btn-secondary" onClick={()=>{setView('browse');setSearch(result.name);setFlowResults(previous=>previous.filter(value=>value.id!==result.id));}}>Find {result.name}</button><button type="button" onClick={()=>setFlowResults(previous=>previous.filter(value=>value.id!==result.id))}>Dismiss</button></div></section>)}
      {queueJobs.length?<section className="connector-authorization connection-queue" aria-label="Connection progress"><h3>Connection progress</h3>{queueJobs.map(job=><div key={job.key} className="connection-queue-item connector-login-actions"><strong>{job.item.item.name}</strong>{' · '}<span role="status">{job.state==='queued'?'Queued':job.state==='connecting'?'Connecting…':job.state==='waiting'?'Waiting for sign-in':job.state==='connected'?'Connected':job.state==='setup'?'Needs setup':job.state==='cancelled'?'Cancelled':'Could not connect'}{job.message?` · ${job.message}`:''}</span>{['queued','connecting'].includes(job.state)?<button type="button" className="btn-secondary" onClick={()=>queue.current?.cancel(job.key)}>Cancel {job.item.item.name}</button>:null}{job.state==='setup'?<button type="button" className="btn-secondary" onClick={()=>showSetupOptions(job.item.item,job.item.reconnect)}>View options for {job.item.item.name}</button>:null}{['failed','cancelled'].includes(job.state)?<button type="button" className="btn-secondary" onClick={()=>void connectItem(job.item.item,job.item.reconnect)}>Retry {job.item.item.name}</button>:null}{['failed','setup','cancelled'].includes(job.state)?<button type="button" className="btn-secondary" onClick={()=>queue.current?.dismiss(job.key)}>Dismiss {job.item.item.name}</button>:null}</div>)}</section>:null}
      {notice?<div className="connector-notice" role="status">{notice}</div>:null}
      {disconnected?<div className="connector-error" role="status">Cypher is disconnected from its cloud runtime. Saved connections and past tool tests may be out of date. Reconnect, then use Test tools to check live access.</div>:refreshableError&&plugins.length?<div className="connector-notice" role="status">Showing saved connections. Their current status could not be refreshed.</div>:null}
      {registration?<section className="plugin-registration" aria-labelledby="plugin-registration-title"><div className="plugin-registration-heading"><div><h3 id="plugin-registration-title">Sign-in isn’t ready for {registration.item.name} yet</h3><p>Cypher needs provider setup before this app can connect. Your account has not been connected.</p></div><button type="button" aria-label="Close connection setup" onClick={()=>{setRegistration(null);setClientSecret('');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><details className="apps-advanced-list"><summary>Advanced setup for app administrators</summary><p>Use a client registered with this provider. Most people can choose another app and leave this setup to their administrator.</p><form onSubmit={event=>void connectRegisteredClient(event)}><label htmlFor="oauth-callback">Callback URL</label><input id="oauth-callback" readOnly value={registration.callback} onFocus={event=>event.currentTarget.select()}/><div className="oauth-client-fields"><label>Client ID<input required autoComplete="off" value={clientId} onChange={event=>setClientId(event.target.value)} maxLength={2000}/></label><label>Client secret <small>if required</small><input type="password" autoComplete="new-password" value={clientSecret} onChange={event=>setClientSecret(event.target.value)} maxLength={4096}/></label></div><details><summary>Requested scopes</summary><input aria-label="OAuth scopes" value={clientScope} onChange={event=>setClientScope(event.target.value)} maxLength={2000}/></details><div className="plugin-registration-actions"><button type="submit" className="btn-primary" disabled={busy||queueJobs.some(job=>job.state==='connecting')||!clientId.trim()}>Connect with OAuth</button>{normalizeHost(registration.item.url)==='mcp.lovable.dev'?<a href="https://docs.lovable.dev/features/oauth-clients" target="_blank" rel="noreferrer">Lovable setup guide</a>:registration.item.source?<a href={registration.item.source} target="_blank" rel="noreferrer">Provider setup guide</a>:null}</div>{normalizeHost(registration.item.url)==='mcp.lovable.dev'?<p className="field-help">Lovable requires Business or Enterprise for project and workspace scopes. Client details stay encrypted on the server.</p>:<p className="field-help">Use your own registered client. Credentials stay encrypted on the server.</p>}</form></details></section>:null}
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
            const accountActionName=identity.name===plugin.name?identity.name:`${identity.name}, ${plugin.name}`;
            return <div key={plugin.id} className="apps-account-card" data-readiness={status.tone} title={status.detail}>
              <button type="button" className="apps-account-manage" onClick={()=>{chooseView('connected');setSearch(plugin.name);}} aria-label={`Manage ${plugin.name}`}>
                <Logo item={identity}/><span className="apps-account-copy"><strong>{identity.name}</strong>{identity.name!==plugin.name?<span>{plugin.name}</span>:null}<small>{plugin.authenticated?'Connected':'Needs sign-in'} · {plugin.tools.length} available {plugin.tools.length===1?'tool':'tools'} · {plugin.enabled?'Enabled':'Paused'} · {status.label}</small></span><span className="app-connection-indicator" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={status.tone==='success'?'m5 12 4 4L19 6':status.tone==='warning'?'M12 7v6m0 4h.01':'m9 5 7 7-7 7'}/></svg></span>
              </button>
              {plugin.authenticated&&plugin.enabled&&onExploreConnection?<button type="button" className="apps-account-use" aria-label={`Ask Cypher to explore ${accountActionName}`} disabled={Boolean(exploringId)} onClick={()=>void exploreAccount(plugin)}>{exploringId===plugin.id?'Opening…':'Ask Cypher'}</button>:<button type="button" className="apps-account-use apps-account-use-secondary" onClick={()=>{chooseView('connected');setSearch(plugin.name);}}>{plugin.authenticated?plugin.enabled?'Manage access':'Enable to use':'Finish setup'}</button>}
            </div>;
          })}</div>}
          {!loading&&query&&!accountPlugins.some(plugin=>[plugin.name,connectionIdentity(plugin).name].join(' ').toLocaleLowerCase().includes(query))?<p className="apps-empty-connections">No connected apps match your search.</p>:null}
        </section>:null}
        {connectionsLoaded&&!query&&!plugins.some(p=>p.provider==='google')?<article className="apps-google-connect" aria-label="Google apps"><Logo item={{name:'Google apps',provider:'google'}}/><div><h3>Bring your Google apps together</h3><p>Gmail, Calendar, Drive, and more. Choose which ones Cypher can use.</p></div><a className="connector-connect" href="/connect/google">Connect Google</a></article>:null}
        <div className="connected-service-actions"><a className="btn-secondary" href="/connect/meta">Connect Facebook &amp; Instagram</a></div>
        {available.length?<section className="store-available"><div><h3>Available accounts</h3><p>Use a connection already available in this workspace.</p></div><div className="connected-service-actions">{available.map(c=><button type="button" key={c.id} disabled={busy} onClick={()=>void connectItem({id:c.id,name:c.name,url:c.url,domains:c.domains,category:'Development',description:'',connection_id:c.id})}>{c.reuse_available?`Use ${c.name}`:`Connect ${c.name}`}</button>)}</div></section>:null}
        <section className="store-browse" aria-labelledby="store-browse-title">
          {!connectionsLoaded&&!connectionsLoadFailed?<p role="status">Checking your saved connections…</p>:null}
          {availableLoadFailed?<p role="alert">Could not check available accounts. <button type="button" className="connector-retry" onClick={()=>void retryLoad()}>Retry connections</button></p>:null}
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
      {view==='connected'?<><div className="catalog-heading"><div><h3>{publicTools?'Public tools':'Your connections'} {connectionsLoaded?<span>{connectedVisible.length}</span>:null}</h3><p>Manage access to connected accounts. Create and manage reusable skill recipes separately in your workspace library.</p>{publicPluginCount>0?<button type="button" className="connection-kind-toggle" onClick={()=>{setPublicTools(value=>!value);setSearch('');}}>{publicTools?'Account connections':`Public tools · ${plugins.filter(plugin=>!isAccountPlugin(plugin)).length}`}</button>:null}{onManageSkills?<button type="button" className="btn-secondary" onClick={onManageSkills}>Saved instructions</button>:null}</div><input type="search" aria-label={publicTools?'Search public tools':'Search my apps'} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search connected services or tools…"/></div>{loading?<LoadingState label="Loading your connections…" rows={4}/>:connectionsLoadFailed&&!connectionsLoaded?<div className="connector-empty" role="alert"><h3>Connections unavailable</h3><p>Cypher couldn’t load your saved connections. Try again to check which services are connected.</p><button type="button" className="btn-secondary" onClick={()=>void retryLoad()}>Retry connections</button></div>:!plugins.length?<div className="connector-empty"><h3>No tools connected yet</h3><p>Find a service in the app store or add its connection link.</p><div className="connector-empty-actions"><button className="btn-primary" onClick={()=>chooseView('browse')}>Browse apps</button><button className="btn-secondary" onClick={()=>chooseView('custom')}>Add by link</button></div></div>:!connectedVisible.length?<div className="connector-empty">{query?(publicTools?'No public tools match your search.':'No connected services match your search.'):(publicTools?'No public tools yet.':'No account connections yet.')}</div>:connectedVisible.map(plugin=><section className="connected-service" key={plugin.id}><div className="connected-service-header"><Logo item={connectionIdentity(plugin)}/><div><h3>{plugin.name}</h3><p>{plugin.tools.length} tools · {plugin.enabled?'Enabled for agents':'Paused'} · {plugin.authenticated?'Account or API access linked':'Public tools · no account linked'} · {pluginStatus(plugin).label}</p></div><button type="button" className="btn-secondary" disabled={busy||!plugin.enabled} onClick={()=>void testTools(plugin)}>{testingId===plugin.id?'Checking tools…':!plugin.enabled?'Enable to test':plugin.verification?.status==='passed'?'Test again':'Test tools'}</button><button className="btn-secondary" role="switch" aria-checked={plugin.enabled} aria-label={`Enable ${plugin.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.togglePlugin(plugin.id,!plugin.enabled))}>{plugin.enabled?'Pause':'Enable'}</button></div><details open={Boolean(query)}><summary>Manage tools</summary>{plugin.tools.filter(tool=>!query||plugin.name.toLocaleLowerCase().includes(query)||(tool.name+' '+tool.description).toLocaleLowerCase().includes(query)).map(tool=><div className="connected-tool" key={tool.name}><div><strong>{tool.name}</strong><p>{tool.description}</p></div><button className="btn-secondary" role="switch" aria-checked={tool.enabled!==false} aria-label={`Enable ${tool.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.setPluginTool(plugin.id,tool.name,tool.enabled===false))}>{tool.enabled===false?'Turn on':'Turn off'}</button></div>)}<div className="connected-service-actions">{plugin.authenticated?<button type="button" disabled={busy||!plugin.enabled} onClick={()=>onExploreConnection?.(plugin.name,plugin.id)}>See what’s in my account</button>:null}{plugin.url.startsWith('site-mcp://') ? plugin.url === 'site-mcp://gmail.com' ? <a href="/connect/google">Use Google apps</a> : <button type="button" disabled={busy} onClick={()=>{setView('browse');setSearch(plugin.url === 'site-mcp://instagram.com' ? 'Instagram' : plugin.name);setNotice('Choose a supported provider and sign in to verify its tools.');}}>Find provider</button> : <button disabled={busy} onClick={()=>void connectItem({...catalog.find(item=>item.url===plugin.url),id:plugin.id,name:plugin.name,url:plugin.url,description:'',category:'Custom',domains:[],connection_id:plugin.connection_id},true)}>Reconnect</button>}<button disabled={busy} onClick={()=>void connectionAction(()=>api.refreshPlugin(plugin.id))}>Refresh tools</button><button disabled={busy} onClick={()=>void connectionAction(()=>api.disconnectPlugin(plugin.id))}>Disconnect</button></div></details></section>)}</>:null}
      {view==='custom'?<form className="connector-custom" onSubmit={event=>void connectCustom(event)}><h3>Connect with a link</h3><p>Paste an MCP server link. If it supports sign-in, Cypher opens the service so you can sign in and approve access.</p><label htmlFor="plugin-url">Service or MCP link</label><input id="plugin-url" type="url" value={url} onChange={event=>setUrl(event.target.value)} required placeholder="https://service.com/mcp"/><details className="connector-custom-advanced"><summary>I have an API key or need custom options</summary><label htmlFor="plugin-token">API key or bearer token <span>optional</span></label><input id="plugin-token" type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} placeholder="Paste the key from the service"/><label htmlFor="plugin-auth-header">API key header</label><input id="plugin-auth-header" value={authHeader} onChange={event=>setAuthHeader(event.target.value)} placeholder="Authorization or X-API-Key"/><label htmlFor="plugin-name">Connection name <span>optional</span></label><input id="plugin-name" value={name} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="Use the server name"/><p className="field-help">Keys are encrypted on the server. Connected tools can read or change data based on the permissions you grant.</p></details><div className="connector-custom-actions"><button className="btn-primary" disabled={busy||queueJobs.some(job=>job.state==='connecting')}>{busy?'Connecting…':'Connect service'}</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>chooseView('browse')}>Browse apps</button></div></form>:null}
      {view==='settings'?<div className="connector-settings"><h3>Connection settings</h3><section><h4>Device approval</h4><p>{device?'New connections require your registered passkey.':'Confirm new connections with a device passkey, Touch ID, Face ID, or Windows Hello.'}</p>{!device?<button className="btn-secondary" disabled={busy} onClick={()=>void enableDevice()}>Enable device approval</button>:null}</section><section><h4>Email connections</h4>{Object.entries(accountState).map(([service,state])=><p key={service}><strong>{service==='gmail'?'Gmail':'Resend'} · {state.configured?'Configured':'Not connected'}</strong><br/>{state.detail}</p>)}</section><details><summary>Catalog reachability checks</summary><p>Check the curated endpoints in the background. This verifies reachability and available tools; sign-in still needs your approval.</p><button type="button" className="btn-secondary" disabled={busy||syncing} onClick={()=>void syncAll()}>{syncing?'Checking catalog…':sync?'Check again':'Check catalog'}</button>{sync?<p role="status">{sync.checked} of {sync.total} checked · {sync.counts.connected||0} reachable · {(sync.counts.sign_in_required||0)+(sync.counts.key_required||0)+(sync.counts.setup_required||0)} need setup · {sync.counts.unavailable||0} unavailable{syncing?' · Continues in the cloud.':''}</p>:null}</details><details><summary>Account signup assistance</summary><label htmlFor="account-signup">Signup page</label><input id="account-signup" type="url" value={accountUrl} onChange={event=>setAccountUrl(event.target.value)} placeholder="https://service.com/signup"/><label htmlFor="account-email">Account email</label><input id="account-email" type="email" value={accountEmail} onChange={event=>setAccountEmail(event.target.value)} placeholder="Your email"/><button disabled={busy||!accountUrl||!accountEmail} className="btn-secondary" onClick={()=>void setupAccount()}>Start account setup</button></details><details><summary>Server configuration</summary><div className="variable-inventory">{variables.map(variable=><div key={variable.target}><span><strong>{variable.name}</strong><small>{variable.project}</small></span><span>{variable.state==='configured'?'Configured':'Needs link'}</span></div>)}</div></details></div>:null}    </div>
  </>;
  return embedded?<section className="connectors-dialog app-store-dialog apps-workspace" aria-labelledby="plugins-title">{panelContent}</section>:<dialog ref={dialog} className="connectors-dialog app-store-dialog" aria-labelledby="plugins-title" onCancel={event=>{event.preventDefault();onClose();}}>{panelContent}</dialog>;
}
