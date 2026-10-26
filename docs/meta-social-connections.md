# Facebook Pages and Instagram permissions

This additive source provides `/connect/meta` using the current tenant's saved
Windsor MCP connection. It does not register a new Meta OAuth client, share
another tenant's grant, provision a database, connect a Meta model account or
perform publishing/actions. Existing model/Llama and social connections remain
distinct.

The page requires a signed Cypher session and canonical app origin. Its mount
reads only the local saved-plugin list. A new user can start Windsor's existing
OAuth flow, including the existing device-approval policy, and return to
`/connect/meta` through the existing signed browser-binding callback. Existing
Windsor grants can be explicitly reconnected. Multiple saved connections require
the user's choice; the page does not pick the first one silently.

The backend accepts two explicit POSTs against a tenant-owned saved plugin:

- `/api/plugins/{id}/meta/inspect`
- `/api/plugins/{id}/meta/authorize` with
  `{service:"facebook_organic"|"instagram"}`

The saved endpoint must be HTTPS `mcp.windsor.ai`, enabled, and advertise each
enabled tool's current schema. Each action calls registered `get_connectors`
with `{include_not_yet_connected:true,include_actions:false,include_options:false}`.
The actual returned connector ID must match the requested Facebook Organic or
Instagram connector before `get_connector_connect_info` can run. Public
Instagram and Meta Ads are separate connector identities and cannot substitute
for these grants. No arbitrary tools, service IDs, URLs or credentials are
accepted in the request.

The service parses bounded MCP output before generic agent-output truncation,
then returns only the two service names, availability and account counts. It
does not expose account names/IDs or raw provider metadata. Unknown account
shapes remain unknown. `accounts_listed` and `data_access_verified:false` mean
metadata discovery, not a successful platform data read.

Authorization returns only a bounded provider-issued HTTPS URL at reviewed
Windsor/Meta hosts plus the provider's notes. Notes appear verbatim before the
user opens the link; passwords and tokens are entered on the provider's page.
There is no automatic redirect after receiving the link, no browser storage,
background probe, write action, grant replacement, selected-account invention or
success claim from merely opening consent. The user returns and explicitly
checks account selections. Responses use private/no-store and no-referrer.

Account discovery does not prove live asset permissions. Production acceptance
requires the canonical release owner's frontend/API/worker parity gate, actual
user consent when needed, and a bounded actual read with fields/selected account
IDs discovered from the registered Windsor tools. Do not infer a data-read pass
from the earlier generic Windsor `get_connectors` smoke test. The UI deliberately
keeps that distinction. No actual provider call or authorization was performed
while authoring this source; tests use synthetic metadata and temporary SQLite.

The Apps UI owner may link the appropriate cards to `/connect/meta` after
review; this source does not edit `PluginPanel` or `AppsHome`.

Primary reference: [Windsor MCP tool reference](https://mcp.windsor.ai/).
