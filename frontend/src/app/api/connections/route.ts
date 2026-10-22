import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
 let inventory: { project: string; name: string; target: string; state: string }[] = [];
 try { const parsed=JSON.parse(process.env.GROKBOT_ENV_INVENTORY || '[]'); if(Array.isArray(parsed))inventory=parsed; } catch {}
 const omni=!!(process.env.OMNIROUTE_URL&&process.env.OMNIROUTE_API_KEY);
 return NextResponse.json({ variables: inventory.map(v=>({project:v.project,name:v.name,target:v.target,state:process.env[v.target]?'configured':'requires-link'})), models: {transport:omni?'omniroute':process.env.LLM_USE_GATEWAY==='true'?'vercel':'direct',configured:omni||!!process.env.LLM_API_KEY,gateway:!omni&&process.env.LLM_USE_GATEWAY==='true'}, backendConfigured:!!(process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL) }, { headers:{'Cache-Control':'private, no-store'} });
}
