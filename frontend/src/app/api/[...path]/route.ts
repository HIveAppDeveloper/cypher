import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  const backend = process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ detail: 'Runtime is not connected. Configure GROKBOT_BACKEND_URL on the server.' }, { status: 503 });
  const url = new URL('/api/' + params.path.map(encodeURIComponent).join('/'), backend);
  url.search = request.nextUrl.search;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.GROKBOT_BACKEND_API_TOKEN) headers.Authorization = `Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN}`;
  const response = await fetch(url, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(), cache: 'no-store', signal: AbortSignal.timeout(30000) });
  return new NextResponse(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' } });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
