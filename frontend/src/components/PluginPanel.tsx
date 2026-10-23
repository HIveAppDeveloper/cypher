import { useEffect, useRef, useState, type FormEvent } from 'react';
import { approveConnection, enrollDevice } from '../lib/device';
import { api } from '../lib/api';
import { PLUGIN_SIGN_IN_KEY, PLUGIN_SIGN_IN_TTL, readPluginSignIn, type PluginSignIn } from '../lib/pluginAuthorization';
import CypherMark from './cipher/CypherMark';
import BinaryLens from './cipher/BinaryLens';
export interface PluginConnection { connection_id?:string; id:string;name:string;url:string;enabled:boolean;authenticated:boolean;verification?:{status:string;checked_at?:string;detail?:{tool?:string;latency_ms?:number;message?:string}};tools:{name:string;description:string;enabled?:boolean}[]; }
export interface CatalogEntry { id:string;name:string;url:string;description:string;category:string;domains:string[];icon?:string;source?:string;auth?:string;auth_header?:string;setup_note?:string;connection_id?:string;transport?:string; }
export interface AvailableConnection {id:string;name:string;url:string;domains:string[];reuse_available:boolean;method:string;}
export interface PluginSync {id:string;status:string;checked:number;total:number;counts:Record<string,number>;results:Record<string,{status:string;message:string;tool_count?:number;credential_source?:string}>;}
type View='browse'|'connected'|'custom'|'settings';
type CatalogFilter='all'|'connected'|'sign_in'|'key'|'public';
const AUTH_POLL_MS=2000;
const LOVABLE_MCP_URL='https://mcp.lovable.dev';
const LOVABLE_SOURCE='https://docs.lovable.dev/integrations/lovable-mcp-server';
function normalizeHost(value:string){
  try{return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())?value.trim():`https://${value.trim()}`).hostname.toLocaleLowerCase().replace(/^www\./,'');}
  catch{return '';}
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
function Logo({item}:{item:Pick<CatalogEntry,'name'|'icon'>}){
  const [failed,setFailed]=useState(false);
  return <span className="connector-logo">{item.icon && !failed?<img src={item.icon} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<span>{item.name.slice(0,2).toUpperCase()}</span>}</span>;
}
function LovableMark({active=false}:{active?:boolean}){
  return <span className="lovable-cypher-mark" data-active={active} aria-hidden="true">
    {active?<BinaryLens className="lovable-binary-lens" active label="Cypher connecting"/>:<CypherMark className="lovable-real-mark" decorative/>}
  </span>;
}
export function PluginPanel({onClose}:{onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const popup=useRef<Window|null>(null);
  const body=useRef<HTMLDivElement>(null);
  const [view,setView]=useState<View>('browse');
  const [catalog,setCatalog]=useState<CatalogEntry[]>([]);
  const [plugins,setPlugins]=useState<PluginConnection[]>([]);
  const [available,setAvailable]=useState<AvailableConnection[]>([]);
  const [sync,setSync]=useState<PluginSync|null>(null);
  const syncing=sync?.status==='pending'||sync?.status==='running';
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [registryItems,setRegistryItems]=useState<CatalogEntry[]>([]);
  const [registryCursor,setRegistryCursor]=useState<string|null>(null);
  const [registryLoading,setRegistryLoading]=useState(false);
  const [registryLoadingMore,setRegistryLoadingMore]=useState(false);
  const [registryError,setRegistryError]=useState('');
  const [registryRetry,setRegistryRetry]=useState(0);
  const registryQueryRef=useRef('');
  const [catalogFilter,setCatalogFilter]=useState<CatalogFilter>('all');
  const [visibleCount,setVisibleCount]=useState(12);
  useEffect(()=>setVisibleCount(12),[search,catalogFilter]);
  const [url,setUrl]=useState('');const [name,setName]=useState('');const [token,setToken]=useState('');const [authHeader,setAuthHeader]=useState('Authorization');
  const [busy,setBusy]=useState(false);const [flow,setFlow]=useState<PluginSignIn|null>(null);
  const [connectingName,setConnectingName]=useState('');
  const [flowError,setFlowError]=useState('');const [checkingSignIn,setCheckingSignIn]=useState(false);
  const [cancellingSignIn,setCancellingSignIn]=useState(false);
  const checkSignIn=useRef<()=>Promise<void>>(async()=>{});
  const connecting=useRef(false);
  const [notice,setNotice]=useState('');const [error,setError]=useState('');
  const [refreshableError,setRefreshableError]=useState(false);
  const [device,setDevice]=useState(false);
  const [accountState,setAccountState]=useState<Record<string,{configured:boolean;detail:string}>>({});
  const [accountUrl,setAccountUrl]=useState('');const [accountEmail,setAccountEmail]=useState('');
  const [variables,setVariables]=useState<{project:string;name:string;target:string;state:string}[]>([]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;dialog.current?.showModal();let active=true;
    Promise.allSettled([api.getPluginCatalog(),api.getPlugins()]).then(([items,connections])=>{if(!active)return;if(items.status==='fulfilled')setCatalog(items.value);if(connections.status==='fulfilled')setPlugins(connections.value);if(items.status==='rejected'||connections.status==='rejected'){setError('Some connections could not load. Retry to refresh the catalog and your connected services.');setRefreshableError(true);}setLoading(false);});
    api.deviceStatus().then(s=>{if(active)setDevice(s.enrolled);}).catch(()=>{});
    api.getAvailableConnections().then(s=>{if(active)setAvailable(s);}).catch(()=>{});
    api.pluginSyncStatus().then(s=>{if(active)setSync(s);}).catch(()=>{});
    api.accountStatus().then(s=>{if(active)setAccountState(s);}).catch(()=>{});
    fetch('/api/connections').then(r=>r.json()).then(data=>{if(active)setVariables(data.variables||[]);}).catch(()=>{});
    const params=new URLSearchParams(window.location.search);const result=params.get('plugins');
    let saved:PluginSignIn|null=null;
    try{saved=readPluginSignIn(sessionStorage);}catch{}
    if(result&&['connected','cancelled','failed'].includes(result)){
      if(!params.get('plugin_flow')||params.get('plugin_flow')===saved?.id){try{sessionStorage.removeItem(PLUGIN_SIGN_IN_KEY);}catch{}saved=null;}
      setView('connected');if(result==='connected')setNotice('Connected. Your team can now use this service.');else setError(result==='cancelled'?'Access was not allowed. Choose Connect to try again.':'Sign-in could not be verified. Choose Connect to try again.');
      const clean=new URL(window.location.href);clean.searchParams.delete('plugins');clean.searchParams.delete('plugin_flow');window.history.replaceState(window.history.state,'',clean.pathname+clean.search+clean.hash);
    }
    if(saved){setFlow(saved);setBusy(true);setNotice('Finish signing in and allow access on the provider’s page. Your progress is saved in this tab.');}
    return()=>{active=false;dialog.current?.close();previous?.focus();};
  },[]);
  useEffect(()=>{
    const term=search.trim();
    registryQueryRef.current=view==='browse'&&term.length>=2?term:'';
    setRegistryLoadingMore(false);
    if(view!=='browse'||term.length<2){setRegistryItems([]);setRegistryCursor(null);setRegistryError('');setRegistryLoading(false);return;}
    let active=true;
    setRegistryItems([]);setRegistryCursor(null);setRegistryError('');setRegistryLoading(false);
    const timer=setTimeout(async()=>{
      setRegistryLoading(true);setRegistryError('');
      try{const page=await api.searchMcpRegistry(term);if(active){setRegistryItems(page.items);setRegistryCursor(page.next_cursor);}}
      catch(e){if(active){setRegistryItems([]);setRegistryCursor(null);setRegistryError(e instanceof Error?e.message:'MCP Registry search failed.');}}
      finally{if(active)setRegistryLoading(false);}
    },300);
    return()=>{active=false;clearTimeout(timer);};
  },[view,search,registryRetry]);
  useEffect(()=>{ if(error || notice) body.current?.scrollTo({top:0}); },[error,notice]);
  async function retryLoad(){setLoading(true);setError('');setRefreshableError(false);const [items,connections,status]=await Promise.allSettled([api.getPluginCatalog(),api.getPlugins(),api.pluginSyncStatus()]);if(items.status==='fulfilled')setCatalog(items.value);if(connections.status==='fulfilled')setPlugins(connections.value);if(status.status==='fulfilled')setSync(status.value);if(items.status==='rejected'||connections.status==='rejected'||status.status==='rejected'){setError('The connection service is unavailable. Try again shortly.');setRefreshableError(true);}setLoading(false);}  async function loadMoreRegistry(){if(!registryCursor||registryLoadingMore)return;const term=search.trim();const cursor=registryCursor;setRegistryLoadingMore(true);setRegistryError('');try{const page=await api.searchMcpRegistry(term,cursor);if(registryQueryRef.current!==term)return;setRegistryItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.items.filter(item=>!seen.has(item.id))];});setRegistryCursor(page.next_cursor);}catch(e){if(registryQueryRef.current===term)setRegistryError(e instanceof Error?e.message:'Could not load more MCP servers.');}finally{if(registryQueryRef.current===term)setRegistryLoadingMore(false);}}  useEffect(()=>{
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
          const connections=await api.getPlugins();if(!active)return;
          setPlugins(connections);setView('connected');finish(`${state.name} connected. Your team can use its tools.`);return;
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
  function clearSignIn(){try{sessionStorage.removeItem(PLUGIN_SIGN_IN_KEY);}catch{}setFlow(null);setFlowError('');setNotice('');setRefreshableError(false);}
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
              if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)requestAnimationFrame(draw);
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
  async function begin(item:CatalogEntry,reconnect=false){
    const existing=plugins.find(plugin=>plugin.url===item.url && (!item.connection_id||plugin.connection_id===item.connection_id));
    if(existing && !reconnect){setBusy(false);setView('connected');setNotice(`${existing.name} is already in your workspace. ${existing.enabled?'Its enabled tools are available to agents.':'Enable it below to let agents use its tools.'}`);popup.current?.close();return;}
    if(item.setup_note){popup.current?.close();setBusy(false);setNotice(item.setup_note+' Source: '+(item.source||item.url));return;}
    if(item.auth==='api_key'){popup.current?.close();setView('custom');setUrl(item.url);setName(item.name);setAuthHeader(item.auth_header||'Authorization');setNotice(`${item.name} uses an API key. Get it from the service, then paste it below.`);setBusy(false);return;}
    setNotice(item.name.toLocaleLowerCase()==='lovable'?'':`Checking ${item.name}…`);
    const approval_id=await approveConnection('connect_plugin:'+item.url);
    const result=await api.authorizePlugin({name:item.name.slice(0,80),url:item.url,approval_id,reconnect,connection_id:item.connection_id});
    if(result.status==='connected'){
      setPlugins(await api.getPlugins());setView('connected');setNotice(`${result.name} connected. Your team can now use it.`);popup.current?.close();setBusy(false);
    }else if(result.authorization_url && result.flow_id){
      const next={id:result.flow_id,name:result.name,url:result.authorization_url,startedAt:Date.now()};
      try{sessionStorage.setItem(PLUGIN_SIGN_IN_KEY,JSON.stringify(next));}catch{}
      setFlow(next);setNotice('');setFlowError('');
      try{if(popup.current&&!popup.current.closed)popup.current.location.replace(result.authorization_url);}catch{/* The visible link can reopen a closed or isolated provider window. */}
    }else throw new Error('This service did not provide a sign-in page. Try its advanced setup.');
  }
  function isConnected(item:CatalogEntry){return plugins.some(plugin=>plugin.url===item.url&&(!item.connection_id||plugin.connection_id===item.connection_id));}
  async function connectItem(item:CatalogEntry,reconnect=false){
    if(connecting.current||flow)return;
    const connected=isConnected(item);
    const result=sync?.results[item.id];
    if(!connected&&(item.setup_note||result?.status==='setup_required')){
      popup.current?.close();setBusy(false);setError('');setRefreshableError(false);
      setNotice(`${item.name} needs setup before it can connect. ${item.setup_note||result?.message||'Follow the provider setup instructions, then try again.'}`);
      return;
    }
    const connectionItem=!connected&&result?.status==='key_required'?{...item,auth:'api_key'}:item;
    connecting.current=true;setBusy(true);setConnectingName(item.name);setError('');setRefreshableError(false);
    if(connectionItem.auth!=='api_key')preparePopup(item.name);
    try{await begin(connectionItem,reconnect);}catch(e){popup.current?.close();setBusy(false);setNotice('');setError(e instanceof Error?e.message:'Connection failed.');}finally{connecting.current=false;setConnectingName('');}
  }
  async function submitSearch(event:FormEvent){
    event.preventDefault();
    const query=search.trim();if(!query)return;
    if(connecting.current||flow)return;
    if(query.toLocaleLowerCase()==='lovable'||normalizeHost(query)==='lovable.dev'||normalizeHost(query)==='mcp.lovable.dev'){await connectItem(lovableItem);return;}
    const match=exactCatalogMatch(query,catalog);
    if(match){await connectItem(match);return;}
    if(!isWebsiteQuery(query)){
      setRefreshableError(false);setNotice(filtered.length?`Choose a service below to connect${filtered.length===1?`: ${filtered[0].name}`:'.'}`:'No matching service. Enter a provider website to check for a published connector.');
      setError('');return;
    }
    connecting.current=true;setBusy(true);setError('');setRefreshableError(false);setNotice('');preparePopup();
    try{const item=await api.resolvePlugin(query);await begin(item);}
    catch(e){popup.current?.close();setBusy(false);setNotice('');setError(e instanceof Error?e.message:'Could not find a published connector for this website.');}finally{connecting.current=false;}
  }
  async function connectCustom(event:FormEvent){
    event.preventDefault();if(connecting.current||flow)return;connecting.current=true;setBusy(true);setError('');setRefreshableError(false);setNotice('');
    if(!token.trim())preparePopup();
    try{
      const parsed=new URL(url.trim());
      if(parsed.protocol!=='https:')throw new Error('Use the HTTPS server address supplied by the company.');
      if(parsed.hostname==='vercel.com')throw new Error('This is a Vercel dashboard URL. Open Browse and enter vercel.com; we will find the right connector for you.');
      if(authHeader.trim().toLocaleLowerCase()==='cookie')throw new Error('Browser session cookies cannot be used as API keys. Use the provider’s sign-in flow or a token issued in its developer settings.');
      const item={id:'custom',name:name.trim()||parsed.hostname,url:url.trim(),description:'',category:'Custom',domains:[parsed.hostname]};
      if(token.trim()){
        const approval_id=await approveConnection('connect_plugin:'+item.url);const connection=await api.connectPlugin({name:item.name,url:item.url,token:token.trim(),auth_header:authHeader,approval_id});setPlugins(current=>[...current,connection]);setView('connected');setToken('');setNotice(`${connection.name} connected.`);setBusy(false);
      }else{await begin(item);}
    }catch(e){popup.current?.close();setBusy(false);setError(e instanceof Error?e.message:'Connection failed.');}finally{connecting.current=false;}
  }
  async function connectionAction(action:()=>Promise<unknown>){setBusy(true);setError('');setRefreshableError(false);try{await action();setPlugins(await api.getPlugins());}catch(e){setError(e instanceof Error?e.message:'Could not update this connection.');}finally{setBusy(false);}}
  async function enableDevice(){setBusy(true);setError('');setRefreshableError(false);try{await enrollDevice();setDevice(true);setNotice('Device approval enabled.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function setupAccount(){setBusy(true);setError('');setRefreshableError(false);try{const approval_id=await approveConnection('setup_account:'+accountUrl.trim());await api.setupPluginAccount({name:'New service',signup_url:accountUrl.trim(),email:accountEmail.trim(),approval_id});setNotice('Account setup is queued in Your team. Creating an account does not automatically connect its tools.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const query=search.trim().toLocaleLowerCase();
  const isCatalogConnected=(item:CatalogEntry)=>isConnected(item);
  const filterMatches=(item:CatalogEntry)=>catalogFilter==='all'||
    (catalogFilter==='connected'&&isCatalogConnected(item))||
    (catalogFilter==='sign_in'&&!isCatalogConnected(item)&&item.auth!=='api_key'&&!item.setup_note&&sync?.results[item.id]?.status!=='unavailable'&&sync?.results[item.id]?.status!=='setup_required'&&sync?.results[item.id]?.status!=='key_required')||
    (catalogFilter==='key'&&!isCatalogConnected(item)&&(item.auth==='api_key'||sync?.results[item.id]?.status==='key_required'))||
    (catalogFilter==='public'&&!isCatalogConnected(item)&&sync?.results[item.id]?.status==='connected');
  const filtered=catalog.filter(item=>filterMatches(item)&&[item.name,item.description,...item.domains].join(' ').toLocaleLowerCase().includes(query))
    .sort((a,b)=>Number(isCatalogConnected(b))-Number(isCatalogConnected(a))||a.name.localeCompare(b.name));
  const curatedUrls=new Set(catalog.map(item=>item.url).filter(Boolean));
  const registryVisible=registryItems.filter(item=>!item.url||!curatedUrls.has(item.url));
  const lovableItem:CatalogEntry={id:'lovable-mcp',name:'Lovable',url:LOVABLE_MCP_URL,description:'Connect Lovable through its official MCP server and provider consent flow.',category:'Development',domains:['lovable.dev','mcp.lovable.dev'],source:LOVABLE_SOURCE,auth:'oauth',transport:'streamable-http'};
  const lovableConnection=plugins.find(plugin=>normalizeHost(plugin.url)==='mcp.lovable.dev');
  const lovableActive=connectingName.toLocaleLowerCase()==='lovable'||flow?.name.toLocaleLowerCase()==='lovable';
  function connectorCard(item:CatalogEntry,keyPrefix='curated'){
    const connected=isCatalogConnected(item);
    const result=sync?.results[item.id];
    const needsEndpoint=!!item.setup_note&&!item.url;
    const action=connected?'Manage':needsEndpoint?'Endpoint needed':item.auth==='api_key'||result?.status==='key_required'?'Add key':item.setup_note||result?.status==='setup_required'?'View setup':result?.status==='connected'?'Add public tool':result?.status==='sign_in_required'?'Sign in':'Connect';
    return <article className="connector-entry" key={`${keyPrefix}:${item.id}`}><div className="connector-entry-title"><Logo item={item}/><div><h4>{item.name}</h4><span>{item.category}</span></div>{connected?<span className="connector-state">In workspace</span>:null}</div><p>{item.description}</p>{item.setup_note?<p className="connector-detail">{item.setup_note}</p>:result&&!connected&&['unavailable','setup_required','key_required'].includes(result.status)?<p className="connector-detail">{result.message}</p>:null}<div className="connector-entry-footer">{item.source?<a href={item.source} target="_blank" rel="noreferrer">Provider details</a>:<span/>}<button disabled={busy||needsEndpoint||!item.url} className="connector-connect" aria-label={`${action} ${item.name}`} onClick={()=>void connectItem(item)}>{action}<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button></div></article>;
  }
  return <dialog ref={dialog} className="connectors-dialog" aria-labelledby="plugins-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="connectors-header"><div><h2 id="plugins-title">Plugins</h2><p>Connect services, then let Cypher use their tools.</p></div><button className="connector-close" aria-label="Close plugins" onClick={onClose}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <nav className="connector-tabs" aria-label="Plugin pages">{([['browse','Browse'],['connected',`Connected${plugins.length?' · '+plugins.length:''}`],['custom','Advanced'],['settings','Settings']] as const).map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>chooseView(id)}>{label}</button>)}</nav>
    <div ref={body} className="connectors-body" aria-busy={loading}>
      {connectingName.toLocaleLowerCase()==='lovable'&&!flow?<div className="lovable-connect-progress" role="status"><LovableMark active/><div><strong>Opening Lovable</strong><p>Cypher is preparing Lovable’s secure sign-in. You’ll review access on Lovable before anything connects.</p></div></div>:null}
      {flow?<section className={`connector-authorization${lovableActive?' lovable-authorization':''}`} aria-labelledby="plugin-sign-in-title">{lovableActive?<div className="lovable-auth-heading"><LovableMark active/><div><h3 id="plugin-sign-in-title">Connect Lovable</h3><p>Sign in, review access, then press Allow.</p></div></div>:<h3 id="plugin-sign-in-title">Allow access to {flow.name}</h3>}<ol>{lovableActive?<><li>Sign in to Lovable in the secure window.</li><li>Review the permissions Lovable lists and press <strong>Allow</strong>.</li><li>Return here while Cypher verifies the available tools.</li></>:<><li>Sign in on {flow.name}’s page.</li><li>Review the permissions and choose Allow or Authorize.</li><li>Return here. We’ll verify the connection and load its tools.</li></>}</ol><div className="connector-login-actions"><a className="btn-primary" href={flow.url} target="_blank" rel="noopener noreferrer" onClick={event=>{try{if(popup.current&&!popup.current.closed){event.preventDefault();popup.current.focus();}}catch{}}}>Continue to {flow.name}</a><button className="btn-secondary" type="button" disabled={checkingSignIn} onClick={()=>void checkSignIn.current()}>{checkingSignIn?'Checking…':'Check connection'}</button><button type="button" disabled={cancellingSignIn} onClick={()=>void cancelSignIn()}>{cancellingSignIn?'Cancelling…':'Cancel sign-in'}</button></div><p role="status">{flowError||'Waiting for provider approval. You can close this panel and continue later in this tab.'}{lovableActive?' Cypher can use only the tools Lovable authorizes; some Lovable actions may consume plan credits.':''}</p></section>:null}
      {notice?<div className="connector-notice" role="status">{notice}</div>:null}
      {error?<div className="connector-error" role="alert">{error}{refreshableError?<button type="button" className="connector-retry" disabled={loading||busy} onClick={()=>void retryLoad()}>Refresh connections</button>:null}</div>:null}
      {view==='browse'?<>
        <section className="lovable-connect" data-active={lovableActive} aria-label="Connect Lovable">
          <LovableMark active={lovableActive}/>
          <div className="lovable-connect-copy"><div className="lovable-title-row"><h3>Lovable</h3><span>Development</span></div><p>Use the official Lovable MCP connection in Cypher.</p><small>Sign in with Lovable and approve the access shown on its consent screen. Cypher checks the tools before marking it connected.</small></div>
          <div className="lovable-connect-actions"><button type="button" className="connector-connect" disabled={busy||Boolean(flow)} onClick={()=>{if(lovableConnection){setSearch('lovable');setView('connected');setNotice('Lovable is connected. Review its enabled tools below.');}else void connectItem(lovableItem);}}>{lovableConnection?'Manage connection':busy&&lovableActive?'Opening…':'Connect Lovable'}<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button><a href={LOVABLE_SOURCE} target="_blank" rel="noreferrer">Provider details</a></div>
        </section>
        <section className="connector-discovery" aria-label="Find a service">
          <div className="discovery-heading"><h3>Connect a service</h3><p>Search the catalog or enter a provider website.</p></div>
          <form className="website-connect" onSubmit={event=>void submitSearch(event)}>
            <label htmlFor="plugin-search">Service or website</label>
            <div className="website-search"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.4 4.4"/></svg><input id="plugin-search" type="search" value={search} onChange={event=>{setSearch(event.target.value);setNotice('');setError('');setRefreshableError(false);}} placeholder="Search services or enter a domain, e.g. notion.so" maxLength={1000} autoComplete="url"/>{(exactCatalogMatch(search,catalog)||isWebsiteQuery(search))?<button className="btn-primary" disabled={busy}>{busy?'Connecting…':exactCatalogMatch(search,catalog)?'Connect':'Find connector'}<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>:null}</div>
            <p>Results filter as you type. Website lookup only connects services with a published MCP connector; sign in and review access on the provider’s page.</p>
          </form>
        </section>
        {available.length?<section className="website-connect"><h3>Connect configured providers</h3><p>Connect these providers directly. Existing authorization is reused when available; a provider may ask you to approve access the first time.</p><div className="connected-service-actions">{available.map(c=><button type="button" key={c.id} disabled={busy} onClick={()=>void connectItem({id:c.id,name:c.name,url:c.url,domains:c.domains,category:'Development',description:'',connection_id:c.id})}>{c.reuse_available?`Use existing ${c.name}`:`Connect ${c.name}`}</button>)}</div></section>:null}
        <div className="catalog-heading"><div><h3>Find a service <span>{catalog.length} curated</span></h3><p>Search curated connectors and the live MCP Registry.</p></div></div>
        <div className="catalog-toolbar"><label htmlFor="plugin-setup-filter">Show</label><select id="plugin-setup-filter" value={catalogFilter} onChange={event=>setCatalogFilter(event.target.value as CatalogFilter)}><option value="all">All services</option><option value="connected">Connected</option><option value="sign_in">Can sign in</option><option value="key">Needs an API key</option><option value="public">Public tools</option></select></div>
        {!loading?<p className="catalog-results" role="status">{filtered.length} curated {filtered.length===1?'match':'matches'}{query ? ` for “${search}”` : ' ready to browse'}</p>:null}{loading?<p className="connector-empty" role="status">Loading curated connectors…</p>:<div className="connector-catalog">{filtered.slice(0,visibleCount).map(item=>connectorCard(item))}</div>}
        {!loading && !filtered.length?<div className="connector-empty"><p>No curated services match. Search below for MCP Registry results.</p><button className="btn-secondary" onClick={()=>{setSearch('');setCatalogFilter('all');}}>Clear search</button></div>:null}
        {filtered.length>visibleCount?<button className="btn-secondary" onClick={()=>setVisibleCount(n=>n+60)}>Show more curated services ({filtered.length-visibleCount} remaining)</button>:null}
        {query.length>=2?<section className="mcp-registry-results"><div className="catalog-heading"><div><h3>MCP Registry</h3><p>Live search · {registryItems.length} loaded</p></div></div>{registryLoading?<p className="connector-empty" role="status">Searching MCP Registry…</p>:null}{registryError?<p className="connector-error" role="alert">{registryError}<button className="connector-retry" onClick={()=>setRegistryRetry(value=>value+1)}>Retry search</button></p>:null}{!registryLoading&&!registryError&&!registryVisible.length?<p className="registry-empty">No additional registry results for “{search}”.</p>:null}{registryVisible.length?<div className="connector-catalog">{registryVisible.map(item=>connectorCard(item,'mcp'))}</div>:null}{registryCursor?<button className="btn-secondary" disabled={registryLoadingMore} onClick={()=>void loadMoreRegistry()}>{registryLoadingMore?'Loading…':'Load more MCP servers'}</button>:null}</section>:null}
        <p className="catalog-note">The MCP Registry search covers thousands of published servers. A listing is discovery data, not a tested connection: public HTTPS Streamable HTTP servers can connect here; local packages and unsupported transports need a hosted endpoint or provider setup. Sign-in and access still require your approval.</p>
      </>:null}
      {view==='connected'?<><div className="catalog-heading"><div><h3>Your connections <span>{plugins.length}</span></h3><p>Enabled tools appear in Cypher’s plugin search.</p></div><input type="search" aria-label="Search connected plugins" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search connected services or tools…"/></div>{loading?<p className="connector-empty" role="status">Loading your connections…</p>:!plugins.length?<div className="connector-empty"><h3>No plugins connected yet</h3><p>Choose a service or paste its website to get started.</p><button className="btn-primary" onClick={()=>chooseView('browse')}>Browse plugins</button></div>:!plugins.some(plugin=>[plugin.name,...plugin.tools.map(tool=>tool.name)].join(' ').toLocaleLowerCase().includes(query))?<div className="connector-empty">No connected services match your search.</div>:plugins.filter(plugin=>[plugin.name,...plugin.tools.map(tool=>tool.name)].join(' ').toLocaleLowerCase().includes(query)).map(plugin=><section className="connected-service" key={plugin.id}><div className="connected-service-header"><Logo item={{name:plugin.name,icon:catalog.find(item=>item.url===plugin.url)?.icon}}/><div><h3>{plugin.name}</h3><p>{plugin.tools.length} tools · {plugin.enabled?'Enabled for agents':'Paused'} · {plugin.authenticated?'Account or API access linked':'Public tools · no account linked'} · {plugin.verification?.status==='passed'?'Tool test passed':plugin.verification?.status==='failed'?'Tool test failed':'Execution not tested'}</p></div><button className="btn-secondary" role="switch" aria-checked={plugin.enabled} aria-label={`Enable ${plugin.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.togglePlugin(plugin.id,!plugin.enabled))}>{plugin.enabled?'Pause':'Enable'}</button></div><details><summary>Manage tools</summary>{plugin.tools.map(tool=><div className="connected-tool" key={tool.name}><div><strong>{tool.name}</strong><p>{tool.description}</p></div><button className="btn-secondary" role="switch" aria-checked={tool.enabled!==false} aria-label={`Enable ${tool.name}`} disabled={busy} onClick={()=>void connectionAction(()=>api.setPluginTool(plugin.id,tool.name,tool.enabled===false))}>{tool.enabled===false?'Enable':'Pause'}</button></div>)}</details><div className="connected-service-actions"><button disabled={busy} onClick={()=>void connectionAction(async()=>{const result=await api.testPlugin(plugin.id);setNotice(`${plugin.name}: ${result.message}${result.latency_ms!==undefined?` (${(result.latency_ms/1000).toFixed(1)}s)`:""}`);if(result.status==="failed")setError(result.message);})}>Test tools</button><button disabled={busy} onClick={()=>void connectItem({...catalog.find(item=>item.url===plugin.url),id:plugin.id,name:plugin.name,url:plugin.url,description:'',category:'Custom',domains:[],connection_id:plugin.connection_id},true)}>Reconnect</button><button disabled={busy} onClick={()=>void connectionAction(()=>api.refreshPlugin(plugin.id))}>Refresh tools</button><button disabled={busy} onClick={()=>void connectionAction(()=>api.disconnectPlugin(plugin.id))}>Disconnect</button></div></section>)}</>:null}
      {view==='custom'?<form className="connector-custom" onSubmit={event=>void connectCustom(event)}><h3>Add a custom server</h3><p>For a service that supplies its own MCP address. For a company website, use Browse.</p><label htmlFor="plugin-url">MCP server address</label><input id="plugin-url" type="url" value={url} onChange={event=>setUrl(event.target.value)} required placeholder="https://service.com/mcp"/><label htmlFor="plugin-name">Name <span>optional</span></label><input id="plugin-name" value={name} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="We can use the server name"/><label htmlFor="plugin-token">API key or bearer token <span>optional</span></label><input id="plugin-token" type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} placeholder="Leave blank to try secure sign-in"/><label htmlFor="plugin-auth-header">API key header</label><input id="plugin-auth-header" value={authHeader} onChange={event=>setAuthHeader(event.target.value)} placeholder="Authorization or X-API-Key"/><p className="field-help">Keys stay encrypted on the server. A connected service’s tools can read or change data according to the permissions you grant.</p><button className="btn-primary" disabled={busy}>{busy?'Connecting…':'Connect server'}</button></form>:null}
      {view==='settings'?<div className="connector-settings"><h3>Connection settings</h3><section><h4>Device approval</h4><p>{device?'New connections require your registered passkey.':'Confirm new connections with a device passkey, Touch ID, Face ID, or Windows Hello.'}</p>{!device?<button className="btn-secondary" disabled={busy} onClick={()=>void enableDevice()}>Enable device approval</button>:null}</section><section><h4>Email connections</h4>{Object.entries(accountState).map(([service,state])=><p key={service}><strong>{service==='gmail'?'Gmail':'Resend'} · {state.configured?'Configured':'Not connected'}</strong><br/>{state.detail}</p>)}</section><details><summary>Catalog reachability checks</summary><p>Check the curated endpoints in the background. This verifies reachability and available tools; sign-in still needs your approval.</p><button type="button" className="btn-secondary" disabled={busy||syncing} onClick={()=>void syncAll()}>{syncing?'Checking catalog…':sync?'Check again':'Check catalog'}</button>{sync?<p role="status">{sync.checked} of {sync.total} checked · {sync.counts.connected||0} reachable · {(sync.counts.sign_in_required||0)+(sync.counts.key_required||0)+(sync.counts.setup_required||0)} need setup · {sync.counts.unavailable||0} unavailable{syncing?' · Continues in the cloud.':''}</p>:null}</details><details><summary>Account signup assistance</summary><label htmlFor="account-signup">Signup page</label><input id="account-signup" type="url" value={accountUrl} onChange={event=>setAccountUrl(event.target.value)} placeholder="https://service.com/signup"/><label htmlFor="account-email">Account email</label><input id="account-email" type="email" value={accountEmail} onChange={event=>setAccountEmail(event.target.value)} placeholder="Your email"/><button disabled={busy||!accountUrl||!accountEmail} className="btn-secondary" onClick={()=>void setupAccount()}>Start account setup</button></details><details><summary>Server configuration</summary><div className="variable-inventory">{variables.map(variable=><div key={variable.target}><span><strong>{variable.name}</strong><small>{variable.project}</small></span><span>{variable.state==='configured'?'Configured':'Needs link'}</span></div>)}</div></details></div>:null}    </div>
  </dialog>;
}
