export const PLUGIN_SIGN_IN_KEY = 'grokbot-plugin-sign-in-v1';
export const PLUGIN_SIGN_IN_TTL = 600_000;
export const PLUGIN_SIGN_INS_KEY = 'grokbot-plugin-sign-ins-v2';
export const PLUGIN_STARTS_KEY = 'grokbot-plugin-starts-v1';
export const MAX_PLUGIN_SIGN_INS = 12;
export interface PluginSignIn { id:string; name:string; url:string; startedAt:number; keyHash?:string; }

export function parsePluginSignIn(value:unknown,now=Date.now()):PluginSignIn|null {
  try{
    if(!value||typeof value!=='object')return null;
    const entry=value as Record<string,unknown>;
    if(typeof entry.id!=='string'||!/^[0-9a-f-]{36}$/.test(entry.id)||typeof entry.name!=='string'||typeof entry.url!=='string'||typeof entry.startedAt!=='number'||!Number.isFinite(entry.startedAt)||now<entry.startedAt||now-entry.startedAt>=PLUGIN_SIGN_IN_TTL)return null;
    const url=new URL(entry.url);const local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
    if((url.protocol!=='https:'&&!local)||url.username||url.password)return null;
    const flow:PluginSignIn={id:entry.id,name:entry.name,url:url.href,startedAt:entry.startedAt};
    if(typeof entry.keyHash==='string'&&/^[0-9a-f]{64}$/.test(entry.keyHash))flow.keyHash=entry.keyHash;
    return flow;
  }catch{return null;}
}
export function readPluginSignIn(storage:Pick<Storage,'getItem'|'removeItem'>, now=Date.now()):PluginSignIn|null {
  try{const value=parsePluginSignIn(JSON.parse(storage.getItem(PLUGIN_SIGN_IN_KEY)||'null'),now);if(value)return value;}
  catch{}
  try{storage.removeItem(PLUGIN_SIGN_IN_KEY);}catch{}return null;
}

export async function pluginConnectionKeyHash(value:string, crypto:Pick<Crypto,'subtle'>):Promise<string> {
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// Each provider flow keeps its own binding cookie and server-side state. The
// tab stores only the provider URL needed to resume a flow, never credentials.
export function readPluginSignIns(storage:Pick<Storage,'getItem'|'removeItem'>, now=Date.now()):PluginSignIn[] {
  try {
    const raw=storage.getItem(PLUGIN_SIGN_INS_KEY);
    if(!raw){const legacy=readPluginSignIn(storage,now);return legacy?[legacy]:[];}
    const values=JSON.parse(raw);
    if(!Array.isArray(values))throw new Error('Invalid sign-ins');
    const found:PluginSignIn[]=[];const ids=new Set<string>();
    for(const value of values.slice(0,MAX_PLUGIN_SIGN_INS)){
      const flow=parsePluginSignIn(value,now);if(!flow||ids.has(flow.id))continue;
      ids.add(flow.id);found.push(flow);
    }
    return found;
  }catch{return [];}
}
export function writePluginSignIns(storage:Pick<Storage,'setItem'|'removeItem'>, flows:PluginSignIn[]):void {
  if(flows.length>MAX_PLUGIN_SIGN_INS)throw new Error('Too many pending sign-ins');
  const values=flows;
  if(values.length){storage.setItem(PLUGIN_SIGN_INS_KEY,JSON.stringify(values));storage.setItem(PLUGIN_SIGN_IN_KEY,JSON.stringify(values[0]));}
  else{storage.removeItem(PLUGIN_SIGN_INS_KEY);storage.removeItem(PLUGIN_SIGN_IN_KEY);}
}

type StartReservation={id:string;keyHash:string;startedAt:number};
type SessionStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
function readStarts(storage:SessionStore,now:number):StartReservation[]{
  try{const raw=JSON.parse(storage.getItem(PLUGIN_STARTS_KEY)||'[]');if(!Array.isArray(raw))return [];
    return raw.filter(value=>typeof value?.id==='string'&&value.id.length<=120&&typeof value.keyHash==='string'&&/^[0-9a-f]{64}$/.test(value.keyHash)&&Number.isFinite(value.startedAt)&&now>=value.startedAt&&now-value.startedAt<PLUGIN_SIGN_IN_TTL).slice(0,MAX_PLUGIN_SIGN_INS);
  }catch{return [];}
}
export function reservePluginStart(storage:SessionStore,keyHash:string,id:string,now=Date.now()):boolean{
  const starts=readStarts(storage,now),flows=readPluginSignIns(storage,now);
  if(!/^[0-9a-f]{64}$/.test(keyHash)||starts.some(value=>value.keyHash===keyHash)||flows.some(value=>value.keyHash===keyHash)||starts.length+flows.length>=MAX_PLUGIN_SIGN_INS)return false;
  storage.setItem(PLUGIN_STARTS_KEY,JSON.stringify([...starts,{id,keyHash,startedAt:now}]));return true;
}
export function releasePluginStart(storage:SessionStore,id:string,now=Date.now()):void{
  const starts=readStarts(storage,now).filter(value=>value.id!==id);
  if(starts.length)storage.setItem(PLUGIN_STARTS_KEY,JSON.stringify(starts));else storage.removeItem(PLUGIN_STARTS_KEY);
}

// Return only within this app, retaining the conversation and workspace query.
export function pluginReturnPath(value:string|null, origin:string):string {
  try {
    const url=new URL(value||'/',origin);
    if(url.origin!==origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('//'))return '/?workspace=1';
    for(const key of ['plugins','plugin_flow','code','state','error','iss','managed'])url.searchParams.delete(key);
    return url.pathname+url.search;
  } catch { return '/?workspace=1'; }
}
