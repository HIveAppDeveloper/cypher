import {CANONICAL_APP_ORIGIN} from './canonical-app';

export const PUBLIC_UPDATED = '2026-10-28';
export const SUPPORT_EMAIL = 'boazrnovik@gmail.com';
export const PUBLIC_DESCRIPTION = 'Cypher is an AI agent workspace for research, writing, shared conversations, and tasks across the apps you choose to connect.';
export type PublicDocument = {title:string;description:string;sections:{title:string;paragraphs:string[]}[]};

// Public, authored product documentation only. Never add workspace or provider data.
export const PUBLIC_DOCS:Record<string,PublicDocument> = {
  '/': {
    title:'Cypher — AI agents and connected tools',description:PUBLIC_DESCRIPTION,
    sections:[
      {title:'Describe the work. Keep it together.',paragraphs:[
        'Use Cypher to research a topic, prepare for a meeting, draft a document, or review information with a team of AI agents. Your workspace keeps conversations, files, and task results together so you can return to work you started earlier.',
        'Connect the apps you want Cypher to use. Find an app, sign in with its provider, and review the access it requests before allowing it. Existing saved connections can be reused. Some services require administrator setup, a provider account, or a paid plan; a listing alone does not mean access is connected.',
      ]},
      {title:'You choose the access',paragraphs:[
        'Account data, conversations, connected tools, and cloud tasks require a signed-in workspace. Model availability depends on the configured provider and your account permissions. Review important results and external changes. Public documentation and the documentation MCP server describe the product without exposing private account data.',
        'Start with a task in the workspace, or read the documentation to understand app permissions, cloud goals, and supported integration surfaces. Signing in does not grant Gmail, Drive, Calendar, Facebook, Instagram, or any other service permission automatically.',
      ]},
    ],
  },
  '/about': {
    title:'About Cypher',description:'What Cypher does and how its AI agents use connected tools.',
    sections:[
      {title:'An AI workspace for getting work done',paragraphs:[
        'Cypher brings AI conversations, specialist agents, files, and connected tools into a shared workspace. It is intended for tasks such as researching companies, preparing for meetings, writing and reviewing documents, and working with information from services you have chosen to connect.',
        'A task can use a main agent or a team. Saved conversations retain context and results. Cloud goals schedule a bounded number of runs, with pause, cancellation, and completion controls. A worker processes accepted work while the browser is closed; a configured model provider and working service permissions are still required.',
      ]},
      {title:'Product identity and limits',paragraphs:[
        'This site is the Cypher agent workspace at cypher-agent.vercel.app. Vercel is its hosting platform, not the name of this product. Cypher is not the Vercel developer platform or a promise of access to another company’s accounts, models, or tools.',
        'Provider sign-in and consent determine which external services an agent can use. Catalog discovery, an account listing, and a successful data read are different kinds of evidence. Cypher keeps those states separate. AI results can be incomplete or wrong, and changes to external services should be reviewed with the same care as other delegated work.',
      ]},
    ],
  },
  '/contact': {
    title:'Contact Cypher',description:'Get help with Cypher access, connections, and stored account data.',
    sections:[
      {title:'Get help',paragraphs:[
        `For questions about Cypher, a connection problem, or a request concerning stored account data, email ${SUPPORT_EMAIL}. This is the contact already published in Cypher’s privacy information. Include the page you were using, what you expected, what happened, and the approximate time of the problem.`,
        'Do not send passwords, API keys, access tokens, recovery codes, private recordings, or full account exports. A short description and a screenshot with private details removed are usually enough to start investigating. Never approve a provider permission request you do not understand merely to troubleshoot a connection.',
      ]},
      {title:'Control your connections',paragraphs:[
        'You can manage saved services from Apps in your signed-in workspace. Google services have a dedicated permissions page where you choose which services to connect. Provider-side access can also be revoked from the provider’s own account settings. Disconnecting prevents future access but does not automatically erase results already saved in a conversation.',
        'For a problem with provider billing, account verification, or an administrator approval, the provider may need to resolve that account requirement. This contact page does not offer a guaranteed response time or emergency support. Read the privacy information for how task data and connected-service access are handled.',
      ]},
    ],
  },
  '/docs': {
    title:'Cypher documentation',description:'How to use Cypher AI agents, app connections, cloud goals, and developer resources.',
    sections:[
      {title:'Start a task',paragraphs:[
        'Sign in to Cypher, describe the outcome you want, and choose an agent or a shared team conversation. Add relevant files when needed. Saved conversations keep task context; the worker records accepted work and results. Review responses and evidence before relying on them.',
        'For work in another service, open Apps and search by app name or website. Use a saved connection when available. Otherwise follow the provider sign-in and Allow flow. Only the scopes you approve become available, and some apps need administrator setup. An available tool is not proof that a particular record or account is accessible.',
      ]},
      {title:'Cloud goals and recovery',paragraphs:[
        'Goals describe an objective, completion criteria, a room, an interval, and a finite run allowance. Accepted cloud work persists in the database so closing the app does not cancel it. Pause and cancellation stop future execution where possible; they cannot undo an external action already completed. Failed or interrupted goals require an explicit resume or retry.',
        'Use the in-app status and results to verify a goal. Do not repeatedly submit a task because a page is slow to refresh. Provider availability, permissions, model configuration, and service limits can affect completion. A task marked accepted is not yet a completed result.',
      ]},
      {title:'Developer resources',paragraphs:[
        'The API guide describes public machine-readable resources. The authentication guide separates public documentation from private workspace and provider access. The MCP guide explains the read-only public documentation server and the separate authenticated Google Workspace transport. These public resources do not grant access to any private workspace.',
      ]},
    ],
  },
  '/docs/api': {
    title:'Cypher API documentation',description:'Public Cypher HTTP resources, OpenAPI description, and integration boundaries.',
    sections:[
      {title:'Public HTTP resources',paragraphs:[
        'GET /openapi.json is the OpenAPI 3.1 description of Cypher’s public documentation interface. GET /llms.txt provides the document index and when-to-use guidance. GET /llms-full.txt provides the combined public text. GET /sitemap.xml lists public pages; GET /robots.txt describes crawler paths. These reads require no account or API key.',
        'Request Accept: text/markdown on the homepage or a public documentation page to receive Markdown with Content-Type: text/markdown and Vary: Accept. Request text/html for HTML. Direct Markdown links use /index.md, /about.md, /contact.md, /privacy.md, /docs/index.md, /docs/api.md, /docs/auth.md, and /docs/mcp.md. Unknown public pages return HTTP 404, including Markdown error text for Markdown requests.',
      ]},
      {title:'Workspace operations are private',paragraphs:[
        'The public documentation server does not submit tasks, call connected tools, read files, inspect account state, or change a workspace. Private /api routes continue to enforce their existing application and tenant authentication. Do not paste browser session cookies into an external agent or assume a public API key can be created from this documentation.',
        'For event-driven tasks, an owner can configure Channels in the signed-in workspace and use the channel’s generated endpoint and authentication instructions. Keep channel secrets private, preserve event identifiers for deduplication, and review delivery status in the app. Provider credentials and workspace authentication are separate requirements; a model connection is not an external-service grant.',
      ]},
    ],
  },
  '/docs/auth': {
    title:'Cypher authentication and permissions',description:'Sign-in, tenant boundaries, and consent for external app access.',
    sections:[
      {title:'Sign in before using a workspace',paragraphs:[
        'Public product pages, documentation, and the public documentation MCP server can be read without signing in. Your conversations, files, goals, and saved connections require the existing signed-in application session. The browser stores this session in an HttpOnly cookie. Do not copy it into prompts, URLs, source code, or third-party MCP settings.',
        'Sign in through /login using the methods shown for this installation. A sign-in to Cypher does not grant access to Google or another connected app. To use a service, start from Apps or its dedicated permission page, authenticate with that provider, review the requested scopes, and choose whether to allow them.',
      ]},
      {title:'Separate account and provider access',paragraphs:[
        'Google permissions are selected at /connect/google. Facebook and Instagram permissions are managed at /connect/meta through a supported saved provider connection. A provider may require account verification, administrator consent, or approval of an OAuth callback. Cypher cannot bypass those requirements. An account being listed is not proof that a selected asset can be read or changed.',
        'Saved tokens are handled by existing server-side connection storage. Tenant boundaries and tool controls still apply. Disconnect a service in the app or revoke it at the provider to stop future access. The public documentation MCP server uses no authentication because it exposes only authored public documentation; it does not inherit a visitor’s session or provider grants.',
      ]},
    ],
  },
  '/docs/mcp': {
    title:'Cypher MCP server documentation',description:'Connect an agent host to Cypher’s read-only public documentation using Streamable HTTP.',
    sections:[
      {title:'Public documentation MCP',paragraphs:[
        `Use ${CANONICAL_APP_ORIGIN}/mcp as a remote Streamable HTTP MCP endpoint. It is public and read-only. The tools search_cypher_docs and get_cypher_doc search or retrieve the same authored product, API, authentication, contact, and privacy guidance available on this website. They cannot read accounts, run models, send messages, create tasks, or invoke connected apps.`,
        'Clients initialize with JSON-RPC 2.0, then send notifications/initialized and tools/list or tools/call. POST requests use Content-Type: application/json and Accept: application/json, text/event-stream. Include the negotiated MCP-Protocol-Version on subsequent requests. Responses are JSON; this stateless server does not offer an SSE stream, so GET returns 405. No API key or browser cookie is needed. Origin headers are checked, and no cross-origin browser credential access is enabled.',
      ]},
      {title:'Discovery and private Google tools',paragraphs:[
        'The discovery manifest is at /.well-known/mcp and /server.json. It describes this public documentation server only. Discovery is not a claim that Cypher has been published to an external registry or that any provider account has been authorized.',
        'A separate Google Workspace MCP transport exists at /api/google/mcp/ behind the app’s existing authentication and granted Google scopes. It is not the public documentation endpoint and does not provide general hosted OAuth enrollment for external agent hosts. Use Google permissions in the signed-in app; never publish a session cookie to connect an outside host.',
      ]},
    ],
  },
  '/privacy': {
    title:'Privacy and data use | Cypher',description:'How Cypher uses account and connected service data to carry out the tasks you request.',
    sections:[
      {title:'Google connections and task data',paragraphs:[
        'You choose whether to connect Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts or Tasks. Google shows the requested permissions before you allow access. Only granted services become available to your agents. You can continue without connecting Google.',
        'Google data is accessed to provide the features you choose: finding and reading information, preparing drafts, creating or editing files, and managing calendar entries, contacts and tasks. Relevant information can appear in your saved conversations and can be sent to your configured AI model provider or another connected service when needed for your request. Your model provider handles task data under its own terms. We do not sell Google account data or use it to serve advertising. We do not train AI models on it.',
      ]},
      {title:'Storage, access, and disconnecting',paragraphs:[
        'Google access and refresh tokens are encrypted on the server and scoped to your authenticated workspace. Tokens are not exposed to the agent’s sandbox or included in tool arguments. Saved access lets authorized cloud tasks continue while the app is closed.',
        `Use Disconnect Google in Google permissions to revoke access and remove the saved connection. You can also revoke access from your Google Account. Disconnecting stops future access; it does not erase results already saved in conversations. For questions or requests concerning stored account data, contact ${SUPPORT_EMAIL}.`,
      ]},
    ],
  },
};

export const PUBLIC_PATHS = Object.keys(PUBLIC_DOCS);
export function markdownPath(path:string) {return path==='/'?'/index.md':path==='/docs'?'/docs/index.md':`${path}.md`;}
export function documentMarkdown(path:string):string|null {
  const doc=PUBLIC_DOCS[path];
  if(!doc)return null;
  return `# ${doc.title}\n\n${doc.description}\n\n${doc.sections.map(section=>`## ${section.title}\n\n${section.paragraphs.join('\n\n')}`).join('\n\n')}\n\n[Cypher documentation](${CANONICAL_APP_ORIGIN}/docs) · [Privacy](${CANONICAL_APP_ORIGIN}/privacy) · [Contact](${CANONICAL_APP_ORIGIN}/contact)\n`;
}
export function prefersMarkdown(accept:string|null):boolean {
  let markdown=0,html=0;
  for(const part of (accept||'').toLowerCase().split(',')){
    const [type,...parameters]=part.trim().split(';');
    const q=parameters.find(value=>value.trim().startsWith('q='));
    const quality=q===undefined?1:Number(q.trim().slice(2));
    if(!Number.isFinite(quality)||quality<0||quality>1)continue;
    if(type==='text/markdown')markdown=Math.max(markdown,quality);
    if(type==='text/html')html=Math.max(html,quality);
  }
  return markdown>0&&markdown>=html;
}
export function notFoundMarkdown(){return `# Page not found\n\nThis Cypher page does not exist. Check the address, or use the [documentation](${CANONICAL_APP_ORIGIN}/docs), [document index](${CANONICAL_APP_ORIGIN}/llms.txt), or [sitemap](${CANONICAL_APP_ORIGIN}/sitemap.xml).\n`;}
export function llmsIndex(){return `# Cypher\n\n> ${PUBLIC_DESCRIPTION}\n\nCypher is an application hosted on Vercel, not the Vercel developer platform. Public documentation is available without JavaScript or sign-in. Workspace and provider access require their existing authorization.\n\n## When to use Cypher\n\n- [Agent guidance](${CANONICAL_APP_ORIGIN}/docs/index.md): Use Cypher for research, meeting preparation, writing, document review, and bounded cloud goals in a signed-in workspace.\n- [Permissions](${CANONICAL_APP_ORIGIN}/docs/auth.md): Connect an app only with the account owner’s consent. A catalog listing or account listing is not proof of data access.\n\n## Documentation\n\n${PUBLIC_PATHS.filter(path=>path!=='/').map(path=>`- [${PUBLIC_DOCS[path].title}](${CANONICAL_APP_ORIGIN}${markdownPath(path)}): ${PUBLIC_DOCS[path].description}`).join('\n')}\n\n## Machine interfaces\n\n- [OpenAPI description](${CANONICAL_APP_ORIGIN}/openapi.json): Public read-only documentation resources.\n- [MCP guide](${CANONICAL_APP_ORIGIN}/docs/mcp.md): Public documentation tools at /mcp; no account access or task execution.\n- [MCP manifest](${CANONICAL_APP_ORIGIN}/.well-known/mcp): Streamable HTTP discovery, not a registry enrollment claim.\n- [Full public text](${CANONICAL_APP_ORIGIN}/llms-full.txt): Combined public documents.\n- [Sitemap](${CANONICAL_APP_ORIGIN}/sitemap.xml): Indexable public pages only.\n`;}

export function publicStructuredData(){return {'@context':'https://schema.org','@graph':[
  {'@type':'SoftwareApplication','@id':`${CANONICAL_APP_ORIGIN}/#app`,name:'Cypher',url:`${CANONICAL_APP_ORIGIN}/`,description:PUBLIC_DESCRIPTION,applicationCategory:'ProductivityApplication',operatingSystem:'Web browser',image:`${CANONICAL_APP_ORIGIN}/cipher-logo.png`,softwareHelp:{'@type':'WebPage',url:`${CANONICAL_APP_ORIGIN}/docs`},publisher:{'@id':`${CANONICAL_APP_ORIGIN}/#project`}},
  {'@type':'Organization','@id':`${CANONICAL_APP_ORIGIN}/#project`,name:'Cypher',url:`${CANONICAL_APP_ORIGIN}/`,contactPoint:{'@type':'ContactPoint',contactType:'Support and privacy questions',email:SUPPORT_EMAIL,url:`${CANONICAL_APP_ORIGIN}/contact`}},
]};}
