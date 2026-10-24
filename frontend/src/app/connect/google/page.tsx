import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSignedPayload,AppSession} from '../../../lib/auth-server';
import {CANONICAL_APP_ORIGIN,internalPathWithSearch,isOffCanonicalHost,requestHostname} from '../../../lib/canonical-app';
import {GoogleConnections} from '../../../components/GoogleConnections';
export const dynamic='force-dynamic';
export default function GooglePermissionsPage({searchParams}:{searchParams?:Record<string,string|string[]|undefined>}){
 let session:AppSession|null=null;try{session=readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value);}catch{}
 const returnTo=internalPathWithSearch('/connect/google',searchParams);
 const host=requestHostname(headers());
 if(isOffCanonicalHost(host))redirect(new URL(returnTo,CANONICAL_APP_ORIGIN).toString());
 if(process.env.REQUIRE_USER_AUTH==='true'&&!session)redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
 return <GoogleConnections welcome={searchParams?.welcome==='1'} result={typeof searchParams?.result==='string'?searchParams.result:''}/>;
}
