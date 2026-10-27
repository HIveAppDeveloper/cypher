import { providerIdentity } from '../lib/gateway-connections.mjs';

export function GatewayProviderLogo({name,logo,size=44}:{name?:string;logo?:string;size?:number}){
  const asset=logo||providerIdentity(name)?.logo;
  return <span className="gc-logo" style={{width:size,height:size}}>{asset?<img src={'/provider-logos/'+asset+'.svg'} width={Math.round(size*.61)} height={Math.round(size*.61)} alt=""/>:<svg width={size*.55} height={size*.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>}</span>;
}
