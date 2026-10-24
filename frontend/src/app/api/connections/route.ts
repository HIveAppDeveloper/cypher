import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
 let inventory: { project: string; name: string; target: string; state: string }[] = [];
 try { const parsed=JSON.parse(process.env.GROKBOT_ENV_INVENTORY || '[]'); if(Array.isArray(parsed))inventory=parsed; } catch {}
 const omni=!!(process.env.OMNIROUTE_URL&&process.env.OMNIROUTE_API_KEY);
 let manageUrl: string | undefined;
 try {
  const configured=process.env.OMNIROUTE_DASHBOARD_URL||process.env.OMNIROUTE_URL;
  if(configured){
   const parsed=new URL(configured);
   if(parsed.protocol==='https:'||parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1'){
    parsed.username='';parsed.password='';parsed.search='';parsed.hash='';
    if(!process.env.OMNIROUTE_DASHBOARD_URL||parsed.pathname==='/'||parsed.pathname==='')parsed.pathname='/providers';
    manageUrl=parsed.toString().replace(/\/$/,'');
   }
  }
 } catch {}
 const provider=process.env.LLM_PROVIDER||'openai';
 const keyName=({openai:'OPENAI_API_KEY',gemini:'GEMINI_API_KEY',anthropic:'ANTHROPIC_API_KEY',deepseek:'DEEPSEEK_API_KEY',xai:'XAI_API_KEY'} as Record<string,string>)[provider];
 const direct=!!(process.env.LLM_API_KEY||(keyName&&[process.env[keyName],process.env['HIVE_'+keyName],process.env['ATLAS_'+keyName]].some(Boolean)));
 return NextResponse.json({ variables: inventory.map(v=>({project:v.project,name:v.name,target:v.target,state:process.env[v.target]?'configured':'requires-link'})), models: {transport:omni?'omniroute':'direct',configured:omni||direct,manageUrl}, backendConfigured:!!(process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL) }, { headers:{'Cache-Control':'private, no-store'} });
}
