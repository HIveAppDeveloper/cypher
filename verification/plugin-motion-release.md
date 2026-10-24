# Plugin connections and motion — October 23, 2026

Based on production commit ae42123502f57bf40f354321dd1ba10fbc18302f. Preserve the conversation refinements, exact original logo PNG, BinaryLens and CipherIntro.

The plugin panel now uses compact service rows, a moving tab underline, bounded list arrivals, fast overlay/drawer openings and tactile controls. Connection success and pending consent retain their real state feedback. Both OS reduced motion and the saved interface-animation preference suppress the new motion. No motion dependency was added. Account connections appear before public tools; service/tool descriptions are searchable, and secondary management actions remain available in each connection’s disclosure.

Provider callback-registration failures return a structured recovery response. The app offers an encrypted own-client OAuth setup form with the exact allowed callback, client ID, optional secret and scopes. Real PKCE consent, browser binding, token exchange and tool discovery remain required. Reconnect reuses that same user’s registered client configuration without copying old tokens or verifiers into the pending flow. No third-party app credentials are reused.

## Verification

- 120 frontend tests pass, including structured API recovery, pending consent, failure/resume, account/public filtering and tool-description search.
- 38 focused backend tests pass, including the actual MCP SDK’s registered public/confidential client exchange, PKCE, encrypted storage, reconnect isolation and structured registration rejection. Twelve existing datetime.utcnow deprecation warnings remain.
- Production Next build, types/lint and source whitespace checks pass. Scoped design detector returns no findings.
- Local fixture browser checks cover desktop/mobile, dark theme, real callback round-trip through the Next proxy, search, consent, and OS/app motion controls. Fixtures are synthetic and establish no real Lovable grant.
- The original BinaryLens canvas changes while enabled and stays unchanged when app motion is disabled. Original PNG SHA256 remains 11143e325ca3ac26ffd640e89a88fbf7fb0cd7a7a45b80a9bd7b6ced49351c69.
- In signed-in production, Vercel, Linear, both saved GitHub accounts and Windsor each passed an audited read-only tool call. Public/catalog entries are not all execution-tested.

## Provider limitation

Lovable’s signed-in Free workspace shows “Upgrade to Business to create access tokens and manage programmatic access to your workspace.” Its official docs require Business or Enterprise for project/workspace scopes and a registered/approved callback for custom hosted clients. No paid upgrade was made. The new setup flow removes the dead end but cannot grant unavailable provider permissions. Sources: https://docs.lovable.dev/features/oauth-clients and https://docs.lovable.dev/integrations/lovable-mcp-server.

Browser evidence and local logs are in the separate cypher-live-verification artifact directory. Deployment identity and live verification are reported after release; a successful local build is not production evidence.
