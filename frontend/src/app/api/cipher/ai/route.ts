export const dynamic = 'force-dynamic';

// Tells the page whether model features work without a key typed into Setup.
export function GET() {
  return Response.json({ serverKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()) });
}
