import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {load} from './support/component-harness.mjs';

const canonical=load('../src/lib/canonical-app.ts',{}, {URL,URLSearchParams});
const docs=load('../src/lib/public-docs.ts',{'./canonical-app':canonical},{URL});
const mcp=load('../src/lib/public-mcp.ts',{'./canonical-app':canonical,'./public-docs':docs},{URL,Response,TextDecoder,Uint8Array});
const origin='https://cypher-agent.vercel.app';
const jsonrpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
const request=(body,headers={},url=origin+'/mcp')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const call=async(body,headers)=>mcp.mcpPost(request(body,headers));

test('public documents render meaningful raw HTML with sequential headings and real navigation',()=>{
  const {default:Document}=load('../src/components/PublicDocument.tsx',{
    './cipher/CypherMark':{__esModule:true,default:()=>null},'../lib/public-docs':docs,
  },{React:{createElement}});
  for(const path of docs.PUBLIC_PATHS){
    const html=renderToStaticMarkup(createElement(Document,{path}));
    const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').trim();
    assert.ok(text.length>500,`${path} has meaningful text without JavaScript`);
    assert.equal((html.match(/<h1[> ]/g)||[]).length,1);
    assert.ok(html.includes('<h2 '));assert.doesNotMatch(html,/<h[3-6][> ]/);
    assert.match(html,/href="\/docs"/);assert.match(html,/href="\/contact"/);
  }
});

test('homepage identity is Cypher with factual product metadata and no invented address or pricing',()=>{
  const {publicMetadata}=load('../src/lib/public-metadata.ts',{'./canonical-app':canonical,'./public-docs':docs},{URL});
  const metadata=publicMetadata('/');
  assert.match(metadata.title,/Cypher.*AI agents/);assert.equal(metadata.alternates.canonical,'/');
  assert.equal(metadata.openGraph.type,'website');assert.equal(metadata.openGraph.images[0].url,'/cipher-logo.png');
  const data=docs.publicStructuredData();
  const app=data['@graph'].find(item=>item['@type']==='SoftwareApplication');
  const organization=data['@graph'].find(item=>item['@type']==='Organization');
  assert.equal(app.name,'Cypher');assert.equal(app.url,origin+'/');assert.equal(app.offers,undefined);
  assert.equal(organization.contactPoint.email,'boazrnovik@gmail.com');assert.equal(organization.address,undefined);
});

test('signed-out homepage returns a public document and preserves the workspace return link; signed-in routing is unchanged',async()=>{
  const page=(session,requireAuth='true')=>load('../src/app/page.tsx',{
    'next/headers':{cookies:async()=>({get:()=>undefined})},
    '../lib/auth-server':{readSignedPayload:()=>session},
    '../lib/canonical-app':canonical,'../lib/public-metadata':{publicMetadata:()=>({})},
    '../components/WorkspaceApp':{__esModule:true,default:'workspace'},
    '../components/PublicDocument':{__esModule:true,default:'public-document'},
  },{React:{createElement},process:{env:{REQUIRE_USER_AUTH:requireAuth}}}).default;
  const anonymous=await page(null)({searchParams:Promise.resolve({conversation:'saved',view:['work','goals']})});
  assert.equal(anonymous.type,'public-document');
  assert.equal(anonymous.props.loginHref,'/login?returnTo=%2F%3Fconversation%3Dsaved%26view%3Dwork%26view%3Dgoals');
  const member=await page({sub:'tenant-A',email:'fixture@example.test'})({});
  assert.equal(member.type,'workspace');assert.equal(member.props.accountId,'tenant-A');
  const local=await page(null,'false')({});assert.equal(local.type,'workspace');
});

test('Markdown selection respects explicit quality values and ordinary browser HTML requests',()=>{
  for(const accept of ['text/markdown','TEXT/MARKDOWN; charset=utf-8','text/html;q=0.5,text/markdown;q=0.9'])assert.equal(docs.prefersMarkdown(accept),true,accept);
  for(const accept of [null,'*/*','text/html,application/xhtml+xml,*/*;q=0.8','text/markdown;q=0','text/markdown;q=0.5,text/html','text/markdown;q=bogus'])assert.equal(docs.prefersMarkdown(accept),false,accept);
});

test('discovery lists only public documents, real Markdown paths and useful recovery links',async()=>{
  const {default:sitemap}=load('../src/app/sitemap.ts',{'../lib/canonical-app':canonical,'../lib/public-docs':docs},{URL});
  const {default:robots}=load('../src/app/robots.ts',{'../lib/canonical-app':canonical});
  const urls=sitemap().map(entry=>entry.url);
  assert.ok(urls.includes(origin+'/docs/auth'));assert.ok(urls.includes(origin+'/privacy'));
  assert.ok(urls.every(url=>!url.includes('/api/')&&!url.includes('/workspace')&&!url.includes('/login')));
  assert.ok(sitemap().every(entry=>/^\d{4}-\d{2}-\d{2}$/.test(entry.lastModified)));
  assert.ok(robots().rules.disallow.includes('/api/'));
  assert.match(docs.llmsIndex(),/## When to use Cypher/);assert.match(docs.llmsIndex(),/docs\/auth\.md/);
  assert.match(docs.notFoundMarkdown(),/Page not found/);assert.match(docs.notFoundMarkdown(),/\/llms\.txt/);
  const missing=load('../src/app/[...missing]/route.ts',{'../../lib/public-docs':docs},{URL,Response});
  for(const accept of ['text/markdown','text/html']){
    const response=missing.GET(new Request(origin+'/missing',{headers:{Accept:accept}}));
    assert.equal(response.status,404);assert.match(response.headers.get('content-type'),new RegExp(accept));
    assert.equal(response.headers.get('vary'),'Accept');assert.ok((await response.text()).length>20);
  }
});

test('MCP initializes, accepts initialized notification, lists tools and reads public documentation',async()=>{
  const initialized=await call(jsonrpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}}));
  assert.equal(initialized.status,200);
  const handshake=await initialized.json();assert.equal(handshake.result.protocolVersion,'2025-11-25');
  assert.match(handshake.result.instructions,/No account access/);
  const notification=await call({jsonrpc:'2.0',method:'notifications/initialized'});
  assert.equal(notification.status,202);assert.equal(await notification.text(),'');
  const listed=await (await call(jsonrpc('tools/list'),{'MCP-Protocol-Version':'2025-11-25'})).json();
  assert.equal(listed.result.tools.length,2);
  assert.ok(listed.result.tools.every(tool=>tool.annotations.readOnlyHint&&!tool.annotations.destructiveHint&&!tool.annotations.openWorldHint));
  const read=await (await call(jsonrpc('tools/call',{name:'get_cypher_doc',arguments:{path:'/docs/auth'}}))).json();
  assert.equal(read.result.isError,false);assert.match(read.result.content[0].text,/HttpOnly cookie/);
  const search=await (await call(jsonrpc('tools/call',{name:'search_cypher_docs',arguments:{query:'Google permissions'}}))).json();
  const results=JSON.parse(search.result.content[0].text);assert.ok(results.length>0);assert.ok(results.length<=5);
  assert.ok(results.every(item=>item.url.startsWith(origin+'/')));
});

test('MCP exposes no private paths, remote fetches, task tools, or arbitrary tool arguments',async()=>{
  for(const params of [
    {name:'get_cypher_doc',arguments:{path:'/api/conversations'}},
    {name:'get_cypher_doc',arguments:{path:'https://private.example/'}},
    {name:'get_cypher_doc',arguments:{path:'__proto__'}},
    {name:'get_cypher_doc',arguments:{path:'/docs',cookie:'private'}},
    {name:'search_cypher_docs',arguments:{query:' '}},
    {name:'search_cypher_docs',arguments:{query:'x'.repeat(201)}},
    {name:'create_task',arguments:{prompt:'Must never execute'}},
  ]){
    const body=await (await call(jsonrpc('tools/call',params))).json();assert.equal(body.error.code,-32602);
  }
  const unknown=await (await call(jsonrpc('tasks/create'))).json();assert.equal(unknown.error.code,-32601);
});

test('MCP validates transport, JSON-RPC envelope, versions, payload size, and Origin before dispatch',async()=>{
  assert.equal((await call(jsonrpc('ping'),{Origin:'https://evil.example'})).status,403);
  assert.equal((await call(jsonrpc('ping'),{Origin:'null'})).status,403);
  assert.equal((await call(jsonrpc('ping'),{Origin:origin})).status,200);
  assert.equal((await call(jsonrpc('ping'),{Accept:'application/json'})).status,406);
  assert.equal((await call(jsonrpc('ping'),{Accept:'application/json;q=0, text/event-stream'})).status,406);
  assert.equal((await call(jsonrpc('ping'),{Accept:'application/json, text/event-stream;q=bogus'})).status,406);
  assert.equal((await call(jsonrpc('ping'),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await call(jsonrpc('ping'),{'MCP-Protocol-Version':'invalid'})).status,400);
  assert.equal((await call(jsonrpc('ping'),{'MCP-Protocol-Version':''})).status,400);
  for(const body of ['{bad',[],{jsonrpc:'1.0',method:'ping',id:1},{jsonrpc:'2.0',method:'ping',id:{}},{jsonrpc:'2.0',method:'ping',params:[]},' '.repeat(32769)]){
    const response=await call(body);assert.ok([400,413].includes(response.status));assert.ok((await response.json()).error);
  }
  assert.equal(mcp.mcpGet(new Request(origin+'/mcp')).status,405);
  assert.equal(mcp.mcpGet(new Request(origin+'/mcp',{headers:{Origin:'https://evil.example'}})).status,403);
  const negotiate=await (await call(jsonrpc('initialize',{protocolVersion:'future',capabilities:{},clientInfo:{name:'fixture',version:'1'}}))).json();
  assert.equal(negotiate.result.protocolVersion,'2025-11-25');
});

test('MCP manifest and OpenAPI describe the real read-only interface, without private account authentication claims',async()=>{
  assert.equal(mcp.MCP_MANIFEST.remotes[0].url,origin+'/mcp');
  assert.equal(mcp.MCP_MANIFEST.remotes[0].type,'streamable-http');
  const {GET}=load('../src/app/openapi.json/route.ts',{'../../lib/canonical-app':canonical,'../../lib/public-docs':docs},{Response});
  const spec=await GET().json();assert.equal(spec.openapi,'3.1.0');assert.equal(spec.info.title,'Cypher public documentation API');
  assert.ok(spec.paths['/mcp'].post);assert.ok(spec.paths['/docs/auth'].get);
  assert.equal(spec.paths['/api/conversations'],undefined);assert.deepEqual(spec.security,[]);
});

test('the public MCP module graph is closed over authored public text and has no account, tool, model, or network imports',()=>{
  const allowed={
    'public-mcp.ts':['./canonical-app','./public-docs'],
    'public-docs.ts':['./canonical-app'],
    'canonical-app.ts':[],
  };
  for(const [file,expected] of Object.entries(allowed)){
    const source=readFileSync(new URL('../src/lib/'+file,import.meta.url),'utf8');
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    const imports=ast.statements.filter(ts.isImportDeclaration).map(node=>node.moduleSpecifier.text);
    assert.deepEqual(imports,expected);
    const inspect=node=>{
      if(ts.isCallExpression(node)){
        assert.notEqual(node.expression.kind,ts.SyntaxKind.ImportKeyword,'no dynamic imports can escape the public module graph');
        assert.doesNotMatch(node.expression.getText(ast),/^(?:fetch|require|eval|api\.|globalThis\.fetch|window\.fetch)\b/);
      }
      ts.forEachChild(node,inspect);
    };
    inspect(ast);
  }
});
