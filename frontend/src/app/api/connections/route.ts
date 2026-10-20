import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
 let inventory: { project: string; name: string; target: string; state: string }[] = [];
 try { const parsed=JSON.parse(process.env.GROKBOT_ENV_INVENTORY || '[]'); if(Array.isArray(parsed))inventory=parsed; } catch {}
 return NextResponse.json({ variables: inventory.map(v=>({project:v.project,name:v.name,target:v.target,state:process.env[v.target]?'configured':'requires-link'})), models: {gateway:!!(process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN)}, backendConfigured:!!(process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL) }, { headers:{'Cache-Control':'private, no-store'} });
}
