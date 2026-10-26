// Product identities and provider-owned destinations; never a gateway dashboard.
export const gatewayProviders = [
  {id:'openai',name:'ChatGPT',company:'OpenAI',logo:'openai',description:'ChatGPT account access for eligible Codex models.',account:'https://chatgpt.com/',keyUrl:null,category:'Subscriptions'},
  {id:'claude',name:'Claude',company:'Anthropic',logo:'claude-color',description:'Writing, reasoning, and coding through the Claude API.',account:'https://claude.ai/',keyUrl:'https://platform.claude.com/settings/keys',category:'API providers'},
  {id:'gemini',name:'Gemini',company:'Google',logo:'gemini-color',description:'Google models for text, vision, and everyday tasks.',account:'https://gemini.google.com/',keyUrl:'https://aistudio.google.com/api-keys',category:'API providers'},
  {id:'xai',name:'Grok',company:'xAI',logo:'grok',description:'Connect xAI model access with your own account.',account:'https://grok.com/',keyUrl:'https://console.x.ai/',category:'API providers'},
  {id:'openrouter',name:'OpenRouter',company:'OpenRouter',logo:'openrouter',description:'One account for models across many providers.',account:'https://openrouter.ai/',keyUrl:'https://openrouter.ai/settings/keys',category:'API providers'},
  {id:'meta',name:'Meta',company:'Meta',logo:'meta-color',description:'Llama models through a supported API provider.',account:'https://www.llama.com/',keyUrl:null,category:'API providers'},
];

export function providerIdentity(value='') {
  const name=value.toLowerCase();
  return gatewayProviders.find(p=>name.includes(p.id)||name.includes(p.name.toLowerCase())||name.includes(p.company.toLowerCase()));
}

// An owner-authorized runtime must advertise this exact same-origin action.
// Do not infer support from provider name or create an OAuth URL in the browser.
export function connectionBeginPath(item) {
  if(item?.can_connect!==true || !gatewayProviders.some(p=>p.id===item.id))return null;
  const path=`/api/model-connections/${item.id}/begin`;
  return item.connect_url===path?path:null;
}

const consentHosts={openai:['auth.openai.com'],claude:['claude.ai','console.anthropic.com'],gemini:['accounts.google.com'],xai:['accounts.x.ai','auth.x.ai'],openrouter:['openrouter.ai']};
export function providerConsentUrl(provider,value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&consentHosts[provider]?.includes(url.hostname)?url.href:null;
  }catch{return null;}
}

export function providerConnectionLabel(item,preview=false) {
  if(preview)return 'Preview';
  if(item?.state==='checking')return 'Checking';
  if(item?.account_connected===true)return 'Account connected';
  if(item?.state==='ready'){
    if(item.access_kind==='public')return 'Public route available';
    if(item.verification_target==='provider_account'&&item.access_kind==='api_key')return 'API key verified';
    if(item.verification_target==='provider_account'&&item.access_kind==='account')return 'Account route verified';
    return 'Route available';
  }
  return ({rate_limited:'Rate limited',billing_required:'Billing needed',verification_required:'Action needed',access_denied:'Access denied',sign_in_required:'Sign in again',unavailable:'Needs attention'})[item?.state]||'Not connected';
}

export function providerHasVerifiedAccess(item) {
  return item?.account_connected===true || item?.state==='ready'&&item.verification_target==='provider_account'&&['account','api_key'].includes(item.access_kind);
}
