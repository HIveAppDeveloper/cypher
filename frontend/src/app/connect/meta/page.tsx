import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSignedPayload,AppSession} from '../../../lib/auth-server';
import {CANONICAL_APP_ORIGIN,isOffCanonicalHost,requestHostname} from '../../../lib/canonical-app';
import {MetaSocialConnections} from '../../../components/MetaSocialConnections';
export const dynamic='force-dynamic';
export const metadata={title:'Facebook and Instagram permissions | Cypher',referrer:'no-referrer'};
export default async function MetaPermissionsPage(props:{searchParams?:Promise<Record<string,string|string[]|undefined>>}){
  const params=await props.searchParams;
  let session:AppSession|null=null;try{session=readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value);}catch{}
  if(isOffCanonicalHost(requestHostname(await headers())))redirect(new URL('/connect/meta',CANONICAL_APP_ORIGIN).toString());
  if(!session)redirect('/login?returnTo=%2Fconnect%2Fmeta');
  return <MetaSocialConnections result={typeof params?.plugins==='string'?params.plugins:''}/>;
}
