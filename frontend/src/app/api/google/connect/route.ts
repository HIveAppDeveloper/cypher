import {NextRequest,NextResponse} from 'next/server';
import {getSessionFromCookieHeader,cookieOptions} from '../../../../lib/auth-server';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 const session=getSessionFromCookieHeader(request.headers.get('cookie'));
 if(!session)return NextResponse.json({detail:'Sign in before connecting Google.'},{status:401});
 if(request.headers.get('origin')&&request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({detail:'Start Google permissions from this app.'},{status:403});
 const backend=process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL;
 if(!backend)return NextResponse.json({detail:'The cloud runtime is unavailable.'},{status:503});
 try{
  const body=await request.json();
  const response=await fetch(new URL('/api/google/authorize',backend),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN||''}`,'x-grokbot-user-id':session.sub,'x-grokbot-public-origin':request.nextUrl.origin},body:JSON.stringify({services:body.services,approval_id:body.approval_id}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok)return NextResponse.json({detail:typeof data.detail==='string'?data.detail:'Google could not start this permission request.'},{status:response.status});
  if(!/^[0-9a-f-]{36}$/.test(data.flow_id||'')||typeof data.binding!=='string'||new URL(data.authorization_url).hostname!=='accounts.google.com')throw Error('Invalid provider response');
  const result=NextResponse.json({authorization_url:data.authorization_url},{headers:{'Cache-Control':'private, no-store'}});
  result.cookies.set('cypher-google-'+data.flow_id,data.binding,{...cookieOptions(600),path:'/api/auth/google/callback'});
  return result;
 }catch{return NextResponse.json({detail:'Google permissions could not start. Try again shortly.'},{status:503});}
}
