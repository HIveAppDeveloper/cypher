import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { type AppSession, readSignedPayload } from '../../../lib/auth-server';
import SourcingOutreachReview from '../../../components/SourcingOutreachReview';
import WorkflowShell from '../../../components/WorkflowShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review outreach · Cypher' };

export default async function OutreachPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch { session = null; }
  const proposalId = typeof searchParams?.proposal === 'string' ? searchParams.proposal : '';
  const sourceRunId = typeof searchParams?.run === 'string' ? searchParams.run : '';
  const sourceResultId = typeof searchParams?.result === 'string' ? searchParams.result : '';
  const returnTo = '/sourcing/outreach' + (proposalId ? '?proposal=' + encodeURIComponent(proposalId) : sourceRunId && sourceResultId ? '?run=' + encodeURIComponent(sourceRunId) + '&result=' + encodeURIComponent(sourceResultId) : '');
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login?returnTo=' + encodeURIComponent(returnTo));
  const accountScopeId = session?.sub || 'anonymous';
  const reviewKey = proposalId || (sourceRunId && sourceResultId ? `${sourceRunId}:${sourceResultId}` : 'draft');
  return <WorkflowShell section="investors"><SourcingOutreachReview key={JSON.stringify([accountScopeId, reviewKey])} accountId={accountScopeId} initialProposalId={proposalId} initialSourceRunId={sourceRunId} initialSourceResultId={sourceResultId} /></WorkflowShell>;
}
