# Territory pulse competition slice

Implemented on isolated branch codex/territory-pulse-demo from main 300949ded687c04dfda6c03bc3062589bdde5feb.

## Working flow
Market + offer -> 20 ranked fictional demo accounts -> select/filter -> editable role-based draft -> mark reviewed -> copy or CSV export. Activity is an actual browser-session action log. Root opens the demo; /?workspace=1, existing conversation links, and plugin callback links open the original agent workspace. Existing signed-session guard is preserved.

## Data boundaries
This is a visibly labeled synthetic demo. The fixed 20-company fixture is not market research and contains no real public companies, verified buying signals, contacts, or source links. Scores are illustrative deterministic numbers, not evidence-based prioritization. Fixture dates are fixture dates, not research timestamps. Personalization is a local template using market, offer, and buyer role. Sending is disabled; no sending API, model, research, connector, credentials, or paid inference is invoked. No backend or auth/security settings changed.

## Verification
- 68 frontend tests pass, including 8 new fixture/ranking/validation/CSV tests.
- Next.js production build passes with TypeScript/lint checks after preserving legacy conversation/plugin routing.
- Actual connected Mac Chrome: 20 rows generated; filter narrows to one; selection updates detail; edited draft marks reviewed; reviewed button and sending are disabled; copied text matches; export action reports CSV; activity records review/copy/export without implying send.
- Validation rejects whitespace market; empty filter has truthful no-results state; Enter submits; repeated click produces 20 rows without duplication.
- Desktop 1440x1000 and mobile 390x844 inspected. Mobile measured document scrollWidth=clientWidth=384; no horizontal overflow. Screenshots in verification/.
- Independent read-only source review clear after fixing legacy query routing.
- Initial shared dependencies disappeared during rebuild; isolated npm ci --offline restored dependencies, and final build/test reran successfully.

## Limits / next work
Not a complete prospecting service: real company discovery, dated source retrieval, evidence-based ranking, verified contacts, durable shared activity/drafts, and a reviewed/approved sending adapter are not implemented. State resets on refresh. Browser export control/action was checked; CSV content/formula safety covered by unit tests. No real sign-in, inference, connector delivery, or external outbound tested. Deployment status must be read from the release result, not inferred from this report.

## Cipher logo and visual follow-up
Used the exact user-provided Library asset libfile_a557535e8ae481919079291f4a729e91 (Cipher logo.png, 2000x2000 RGBA) as the main logo at frontend/public/cipher-logo.png. PNG bytes are unchanged; Git blob 08d6c37ce9aa9fbaa69a823247558a097f9e6ba7. Inspected on white to see the transparent black binary cloud and Cipher wordmark. Added system typography, graphite controls, neutral surfaces, soft corners and focus states, scoped to the prospecting screen. Fresh desktop/mobile browser screenshots captured after checking actual logo rendering and no horizontal overflow. The web app is not a native macOS app.
