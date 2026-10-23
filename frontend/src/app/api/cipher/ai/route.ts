import { serverProvider } from '../../../../lib/cipher/ai';

export const dynamic = 'force-dynamic';

// Tells the page whether model features work without a key typed into Setup, and through which gateway.
export function GET() {
  const provider = serverProvider();
  return Response.json({ serverKey: Boolean(provider), provider });
}
