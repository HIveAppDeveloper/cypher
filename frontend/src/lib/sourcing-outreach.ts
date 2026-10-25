export type SendingAccount = {
  id: string; provider: 'gmail'; sender?: string; available: boolean; detail?: string;
};

export type OutreachProposal = {
  id: string; provider: 'gmail'; account_id: string;
  sender: string; recipient: string; subject: string; body: string; digest: string;
  status: string; review_expires_at: string | null; approved_at: string | null;
  approved_by: string | null; not_before: string | null; attempted_at: string | null;
  completed_at: string | null; gmail_draft_id: string | null;
  detail: { code?: string; message?: string } | null;
  review_token?: string; server_time?: string; review_expired?: boolean;
  recipient_policy: { held: boolean; suppressed: boolean };
  review_eligible: boolean; creation_eligible: boolean;
  review_blocker: null | 'recipient_suppressed' | 'recipient_held' | 'provider_attempt_exists' | 'proposal_state';
};

export const proposalIdIsValid = (id: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);

// The initial adapter emits naive UTC. Accept its explicit UTC successor too.
export function outreachTime(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value + 'Z');
}

export function canReviewProposal(row: OutreachProposal, now: number): boolean {
  if (row.attempted_at || row.review_eligible !== true || row.recipient_policy?.held !== false || row.recipient_policy?.suppressed !== false) return false;
  return ['awaiting_approval', 'held', 'expired', 'denied', 'failed'].includes(row.status)
    || (row.status === 'queued' && (row.review_expired || outreachTime(row.review_expires_at) <= now));
}

export function canCreateDraftProposal(row: OutreachProposal, now: number): boolean {
  return row.status === 'awaiting_approval' && !row.attempted_at && !row.review_expired
    && row.creation_eligible === true && row.recipient_policy?.held === false
    && row.recipient_policy?.suppressed === false && outreachTime(row.review_expires_at) > now;
}

export const canCancelProposal = (row: OutreachProposal) => !row.attempted_at
  && ['awaiting_approval', 'held', 'expired', 'denied', 'failed', 'queued'].includes(row.status);

export function outreachStatus(row: OutreachProposal): { label: string; message: string } {
  if (!row.attempted_at && row.recipient_policy?.suppressed) return { label: 'Recipient opted out', message: 'This recipient has opted out. Creating a draft is blocked.' };
  if (!row.attempted_at && row.recipient_policy?.held) return { label: 'On hold', message: 'This recipient is on hold. Creating a draft is blocked.' };
  if (row.status === 'held' && row.review_eligible) return { label: 'Fresh review required', message: 'The hold has been cleared. Review the exact account and message before approving again.' };
  const statuses: Record<string, { label: string; message: string }> = {
    awaiting_approval: { label: 'Ready to review', message: 'Check the account, recipient, and message before creating a Gmail draft.' },
    held: { label: 'On hold', message: 'This recipient is held or opted out. Creating a draft is blocked.' },
    creating_draft: { label: 'Saving Gmail draft', message: 'Cypher is saving the email to Gmail. Check Drafts before trying again.' },
    draft_created: { label: 'Gmail draft saved', message: 'The email is in Gmail Drafts. Review and send it there when you are ready.' },
    draft_unknown: { label: 'Check Gmail Drafts', message: 'Cypher could not confirm whether the draft was saved. Check Gmail Drafts before creating another.' },
    unknown: { label: 'Check Gmail Drafts', message: 'Cypher could not confirm whether the draft was saved. Check Gmail Drafts before creating another.' },
    failed: { label: 'Draft not saved', message: 'Gmail did not confirm the draft. Check Gmail Drafts before trying again.' },
    expired: { label: 'Confirmation expired', message: 'Review the email again before confirming it.' },
    cancelled: { label: 'Cancelled', message: 'No Gmail draft was created.' },
    denied: { label: 'Needs review', message: 'Review the Gmail account and email again before confirming.' },
  };
  return statuses[row.status] || { label: 'Check status', message: 'Cypher couldn’t confirm this email’s status. Refresh before taking another action.' };
}
