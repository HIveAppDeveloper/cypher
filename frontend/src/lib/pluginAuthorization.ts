export const PLUGIN_SIGN_IN_KEY = 'grokbot-plugin-sign-in-v1';
export const PLUGIN_SIGN_IN_TTL = 600_000;
export interface PluginSignIn { id:string; name:string; url:string; startedAt:number; }

export function readPluginSignIn(storage:Pick<Storage,'getItem'|'removeItem'>, now=Date.now()):PluginSignIn|null {
  try {
    const value=JSON.parse(storage.getItem(PLUGIN_SIGN_IN_KEY)||'null');
    const url=new URL(value.url);
    const local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
    if (!/^[0-9a-f-]{36}$/.test(value.id)||typeof value.name!=='string'||!Number.isFinite(value.startedAt)||
        now<value.startedAt||now-value.startedAt>=PLUGIN_SIGN_IN_TTL||
        (url.protocol!=='https:'&&!local)||url.username||url.password) throw new Error('Invalid sign-in');
    return {id:value.id,name:value.name,url:url.href,startedAt:value.startedAt};
  } catch { try {storage.removeItem(PLUGIN_SIGN_IN_KEY);} catch {} return null; }
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
