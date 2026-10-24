import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSignedPayload,AppSession} from '../../../lib/auth-server';
import {GoogleConnections} from '../../../components/GoogleConnections';
export const dynamic='force-dynamic';
export default function GooglePermissionsPage({searchParams}:{searchParams?:{welcome?:string;result?:string}}){
 let session:AppSession|null=null;try{session=readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value);}catch{}
 if(process.env.REQUIRE_USER_AUTH==='true'&&!session)redirect('/login');
 return <GoogleConnections welcome={searchParams?.welcome==='1'} result={searchParams?.result||''}/>;
}
