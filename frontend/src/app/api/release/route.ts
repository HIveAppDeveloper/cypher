import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Public, credential-free provenance. Functional readiness is checked separately.
export async function GET() {
  return NextResponse.json({
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    environment: process.env.VERCEL_ENV || null,
    backend_bound: Boolean(process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL),
  }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
