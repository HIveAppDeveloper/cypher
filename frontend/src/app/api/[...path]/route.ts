import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ detail: 'Your cloud runtime is not connected. Open Workspace setup to connect it.' }, { status: 503 });
  const url = new URL('/api/' + params.path.map(encodeURIComponent).join('/'), backend);
  url.search = request.nextUrl.search;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.GROKBOT_BACKEND_API_TOKEN) headers.Authorization = `Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN}`;
  let response: Response;
  try { response = await fetch(url, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(), cache: 'no-store', signal: AbortSignal.timeout(25000) }); } catch { return NextResponse.json({ detail: 'The cloud API is starting or unavailable. Try again shortly.' }, { status: 503 }); }
  const responseHeaders: Record<string, string> = { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const disposition = response.headers.get('content-disposition');
  if (disposition) responseHeaders['Content-Disposition'] = disposition;
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
