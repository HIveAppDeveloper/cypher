import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSignedPayload,AppSession} from '../../../lib/auth-server';
import {CANONICAL_APP_ORIGIN,internalPathWithSearch,isOffCanonicalHost,requestHostname} from '../../../lib/canonical-app';
import {GoogleConnections} from '../../../components/GoogleConnections';
export const dynamic='force-dynamic';
export default async function GooglePermissionsPage(props:{searchParams?:Promise<Record<string,string|string[]|undefined>>}) {
 const searchParams = await props.searchParams;
 let session:AppSession|null=null;try{session=readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value);}catch{}
 const returnTo=internalPathWithSearch('/connect/google',searchParams);
 const host=requestHostname(await headers());
 if(isOffCanonicalHost(host))redirect(new URL(returnTo,CANONICAL_APP_ORIGIN).toString());
 if(process.env.REQUIRE_USER_AUTH==='true'&&!session)redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
 return <GoogleConnections welcome={searchParams?.welcome==='1'} result={typeof searchParams?.result==='string'?searchParams.result:''}/>;
}
