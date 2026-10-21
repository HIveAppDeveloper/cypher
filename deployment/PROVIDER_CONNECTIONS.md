# Provider sign-in and reusable connections

Users connect a provider by entering its website in Plugins. Lookup checks the
published catalog, configured managed providers, links from the website itself,
and same-domain MCP registry endpoints. Registry entries cannot redirect a
website lookup to an unrelated server merely by claiming its website URL.

Generic MCP OAuth providers use the existing SDK discovery, registration, PKCE,
encrypted token storage and browser-bound callback flow. Providers configured in
`GROKBOT_MANAGED_CONNECTORS` use Vercel Connect. The application stores an
encrypted connector reference, and requests short-lived provider access at use
time. It does not copy provider private keys, client secrets or refresh tokens.

Example server configuration:

```json
[
  {"id":"vercel","name":"Vercel","url":"https://mcp.vercel.com","connector":"vercel/my-app","domains":["vercel.com"]},
  {"id":"github","name":"GitHub","url":"https://api.githubcopilot.com/mcp/","connector":"github/my-app","domains":["github.com"],"owner_installation":"installation-from-provider"}
]
```

Create and attach each managed connector to this Vercel project and its intended
environments. A locally pulled OIDC token identifies development even when the
environment pull requests production values; enable development for local tests
or test from the deployed production runtime. The worker uses the expiry-aware
OIDC accessor as a callable so its credential can rotate while it stays alive.

The configured installation owner is resolved from the verified account for
`LEGACY_OWNER_EMAIL`, including after legacy data moves to that email account’s
tenant ID. Only that owner may reuse an `owner_installation` app grant. All other
users receive a `grokbot:<authenticated-tenant-id>` user subject. Request bodies
cannot choose token subjects or provider installation IDs. `owner_only` entries
are hidden from other users. Endpoint bindings are checked again when resolving
a stored reference, so a provider token cannot be sent to another MCP server.

Managed sign-in returns through the existing HttpOnly browser-bound callback.
Connection records appear only after the account grant and actual MCP tool
discovery succeed. Expired, replayed, cancelled, cross-browser and cross-workspace
callbacks cannot enable a connection. Reconnection preserves tool switches and
updates the existing record. Background catalog jobs reuse authorized grants
without starting hidden consent flows.

Account sign-in and a provider’s permission grant remain separate from signing
into GrokBot. A new user grants their own account; the owner’s installation is not
shared with them. Providers that offer only API keys still require a key, and a
website without a supported published integration cannot be connected by login
alone. Keys stay in Advanced; supported OAuth providers need no key copying.

References: [Vercel Connect Python SDK](https://vercel.com/docs/connect/python-sdk-reference)
and [authentication](https://vercel.com/docs/connect/concepts/authentication).
