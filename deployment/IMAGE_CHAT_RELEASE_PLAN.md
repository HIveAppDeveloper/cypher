# Historical release plan — superseded

This plan described a Vercel AI Gateway inference route. Current model inference uses OmniRoute or a direct provider API instead; the route and credential assumptions below are obsolete.

## Exact target

- App / production alias: https://open-grokbot-hiveapp.vercel.app/
- Hosting provider: Vercel.
- Team: `hiveapp`, ID `team_UafepbgM7cD7FhLkcShYT9re`.
- Project: `open-grokbot`, ID `prj_9ogAU0O7roLSchWUmzGwsjIinyFM`.
- Region: `iad1`; Next.js frontend, private Python container backend and persistent `agent-worker` daemon, declared by repository-root `vercel.json`.
- Source: https://github.com/HIveAppDeveloper/cypher.
- Base / current remote `main`: `a9e7e19971be672cffbf80a69286156ae5cf3fa7`.
- Currently serving READY deployment: `dpl_6DZumbpvAAq6bEG7FnvUx7iKjcnD`, https://open-grokbot-fka98i5uv-hiveapp.vercel.app/.
- Model provider/route proposed for validation: OpenAI `gpt-6.1-sol` through Vercel AI Gateway `https://ai-gateway.vercel.sh/v1`, using the existing Responses bridge and deployment OIDC. No new credential, model-policy change, Gateway routing rule, account permission, or deployment-protection change is proposed.

The local repair branch is `fix/image-chat-validation`. The final handoff identifies its immutable local commit. It has not been pushed, merged or deployed.

## Proposed approved sequence

1. Recheck remote `main` and reconcile the other scratch task's unpublished provider/failover changes before publishing. If combining or rebasing changes the candidate, rerun the focused suite/build and present the resulting commit for review.
2. Only after explicit approval, push the reviewed repair branch and create a **draft** PR. Git integration may create a billable preview deployment; branch publication/preview approval should cover that. Do not merge without approval.
3. Confirm the intended Vercel team, project, source commit and production environment. Inspect existing queued tasks, goals and automatic verification flags read-only. This is an always-on worker: a production-target deployment can begin background work even before a domain is promoted. Do not pause tasks or change flags without approval; if approval covers only the four probes below, resolve background-work scope before releasing.
4. Create a production-target deployment of the exact reviewed commit without immediately assigning the stable alias, where supported. Check build, database connectivity, worker lock/heartbeat and OIDC configuration. No database migration is introduced by this patch. Never call the broad `/api/runtime/checks` smoke suite as a substitute; it can invoke other models, media and sandbox operations.
5. Promote the tested deployment to the stable alias only within the approved release scope. Preserve existing environment values, access protection and database schema. If authentication still fails or no rotating token file is supplied, stop and report; do not create a key, add credits or change permissions.
6. If separately approved, run the bounded inference tests below through a fresh direct conversation. Inspect actual returned text and worker logs. Repeat after the deployment's original OIDC token expiry; determine timing from safe platform metadata, without exposing the token. Do not claim production token rotation is verified until that second check passes.
7. Observe the result and record the final deployment ID/commit. Rollback or other release changes require the approved scope; no source merge is implied by a deployment approval.

## Proposed billable test scope and data

**Yes, genuine model tests can incur charges.** They use metered Vercel AI Gateway/OpenAI API inference, even if the user has a ChatGPT subscription. Hosting/builds and resumed background work may also consume Vercel resources. No dollar amount is guaranteed by this app; actual inference cost depends on input/image and output/reasoning tokens. Do not add credits, keys, budgets or payment methods.

Propose at most **four primary-model requests**: one text and one image check immediately after release, then the same two checks after initial OIDC token expiry. Stop after the first failure; no automatic retries. Verify no fallback model is configured before starting; do not change its configuration under test-only approval.

Use a clearly named temporary test assistant and fresh direct conversations, memory disabled. Request options for every probe:

```json
{
  "provider": "openai",
  "model": "gpt-6.1-sol",
  "output": "text",
  "allow_tools": false,
  "max_iterations": 1,
  "max_tokens": 512,
  "reasoning_effort": "low",
  "service_tier": "default",
  "team_rounds": 1
}
```

`allow_tools=false` is enforced before tool execution, so the probe cannot consult specialists, generate media, create goals, browse or run commands. The LiteLLM call uses `num_retries=0`. The four-request scope is up to 2048 total output-token budget plus test input/image tokens; a successful result can use fewer tokens. Any broader app/worker activity needs the appropriate release approval.

- Text prompt: `Reply with exactly: GROKBOT_TEXT_OK_7429`.
- Image: the user-provided screenshot `image(2).png`, Library `libfile_c3ef351248a48191b234b3d67c2e257f`; 131011 bytes, 1442×724 PNG, SHA-256 `601e4f9e1c0a000838c235818b2c25c92e192cc5d75d9e8800786cb11de1fa5f`.
- Image prompt: `Read the field label and its placeholder in the attached screenshot. Reply only with label | placeholder.`
- Expected image result: `Model ID | Your provider's model ID` (typographic apostrophe variations are acceptable).
- Data destination: the existing app's state database and worker, then Vercel AI Gateway and its OpenAI model provider. Use only the fresh test conversations; do not send unrelated conversation history, credentials, browser state or other user files.
- Proposed cleanup: leave clearly labelled test records for review; deletion is not part of this approval request.

## Evidence already available without paid inference

61 backend tests passed, including the real worker/Responses adapter with mocked HTTP and tool-disable enforcement; four frontend file-reader tests passed; frontend production build passed. Browser file selection, submission, persisted-byte equality, reload, responsive previews and image-viewer keyboard behavior were verified locally. The real model's visual understanding and production OIDC recovery remain unverified.
