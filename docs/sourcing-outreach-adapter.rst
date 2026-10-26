VC outreach drafts
==================

This is the review and Gmail-draft step for Cypher's existing VC Intelligence
workflow. The current SEC matching and company research remain in place. A
match can prefill the subject and message; SEC filings do not provide verified
contact email addresses, so the signed-in VC supplies the recipient's current
work email and edits the message before continuing.

The flow does not use an Eve runtime, Clay, a shared sender credential, or a
second founder database. It does not send email, schedule sends, retry a Gmail
request, or expose proposal creation as an agent tool.

User flow
---------

1. From a completed VC match, open **Review email and sending options**.
2. Choose an already-connected Gmail account, add a verified work email, and
   edit the subject and body.
3. Prepare the message. Cypher saves a tenant-scoped proposal, not a Gmail item.
4. Read the exact Gmail account, recipient, subject and message. The user must
   check the confirmation box and click **Confirm and create Gmail draft**.
5. That confirmed action asks Gmail to save an unsent draft. Cypher never calls
   a Gmail send method.
6. Open Gmail Drafts to review, edit or send the email there.

The message and recipient are immutable after confirmation. A saved Gmail draft
is not reported as a sent message or a verified delivery. If a Gmail request
ends with an unknown result, the UI tells the user to check Drafts before
trying again; Cypher does not retry it automatically.

API routes
----------

Every route requires the existing signed-in tenant:

* ``GET /api/sourcing/outreach/accounts`` lists this tenant's connected Gmail
  accounts and whether draft access is available.
* ``POST /api/sourcing/outreach`` saves an immutable Gmail draft proposal with a
  client request UUID, account ID, one recipient, subject and plain-text body.
* ``GET /{id}`` returns the saved proposal status without rotating review tokens.
* ``POST /{id}/review`` creates a short-lived review token for the current
  account and exact message.
* ``POST /{id}/approve`` records the signed-in user's explicit confirmation
  that this exact email should become an unsent Gmail draft.
* ``POST /{id}/create-draft`` creates the Gmail draft only after confirmation
  and the cancel window. This calls ``users.drafts.create``; it never calls
  ``users.messages.send`` or ``users.drafts.send``.
* ``POST /{id}/cancel`` cancels a proposal before Gmail draft creation starts.
* ``PUT /policy`` records a tenant-scoped hold or recipient opt-out. Suppression
  cannot be cleared through this endpoint.

Google account and consent
--------------------------

The feature reuses the user's existing Cypher Google Workspace connection and
keeps its current Gmail OAuth consent unchanged. Draft creation requires a
verified Gmail identity, enabled ``gmail_compose_draft`` tool, and an existing
grant containing ``gmail.modify``, ``gmail.compose`` or full-mail access. No
new key, OAuth flow or shared Resend credential is introduced. See Google's
`users.drafts.create reference <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create>`_.

Tenant data and recovery
------------------------

Proposal and recipient-policy rows use the existing app database and tenant
scope. The normal API and worker database bootstrap create the tables. The
``2026-10-25-sourcing-outreach-v2`` revision includes an idempotent addition of
``gmail_draft_id`` for a pre-release v1 table, so existing records and unrelated
workspace data are retained.

The server binds the proposal digest to the tenant, connected Gmail grant,
verified sender, recipient, subject, body and flow revision. Approval checks the
same digest and a short-lived review token. PostgreSQL advisory/row locks and a
conditional database claim persist draft-creation intent before the Gmail API
call. A row with a committed attempt is never automatically retried: a timeout
may have happened after Gmail saved the draft. The UI directs the user to check
Gmail Drafts before taking another action.

No production database, credentials, environment values or Vercel deployment
were changed while preparing this source-review branch. Tests, a production
build and the owner's shared full-stack release gate remain pending.
