import {CANONICAL_APP_ORIGIN} from './canonical-app';
import {PUBLIC_DOCS,PUBLIC_PATHS,documentMarkdown} from './public-docs';

export const MCP_PROTOCOLS=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
export const MCP_MANIFEST={
  $schema:'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name:'io.github.HIveAppDeveloper/cypher',title:'Cypher public documentation',
  description:'Read and search public Cypher product and integration documentation. No private workspace access.',
  version:'1.0.0',websiteUrl:`${CANONICAL_APP_ORIGIN}/`,
  remotes:[{type:'streamable-http',url:`${CANONICAL_APP_ORIGIN}/mcp`}],
};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const tools=[
  {name:'search_cypher_docs',description:'Find public Cypher documentation about app permissions, AI tasks, goals, and integration boundaries.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:200}},required:['query'],additionalProperties:false},annotations},
  {name:'get_cypher_doc',description:'Read a public Cypher document by path. This cannot access accounts, files, conversations, or connected apps.',inputSchema:{type:'object',properties:{path:{type:'string',enum:PUBLIC_PATHS}},required:['path'],additionalProperties:false},annotations},
];
type Id=string|number|null;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function json(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function error(id:Id,code:number,message:string,status=200){return json({jsonrpc:'2.0',id,error:{code,message}},status);}
function originAllowed(request:Request){
  const origin=request.headers.get('origin');
  if(!origin)return true;
  if(origin===CANONICAL_APP_ORIGIN)return true;
  const url=new URL(request.url);
  return (url.hostname==='localhost'||url.hostname==='127.0.0.1')&&origin===url.origin;
}
async function boundedBody(request:Request){
  const reader=request.body?.getReader();
  if(!reader)return '';
  const chunks:Uint8Array[]=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768){await reader.cancel();throw new RangeError('MCP request exceeds 32 KiB.');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function mcpPost(request:Request):Promise<Response>{
  if(!originAllowed(request))return error(null,-32000,'Origin is not allowed.',403);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return error(null,-32600,'Use Content-Type: application/json.',415);
  const accept=(request.headers.get('accept')||'').toLowerCase().split(',').flatMap(part=>{
    const [type,...parameters]=part.trim().split(';');
    const q=parameters.find(value=>value.trim().startsWith('q='));
    const quality=q===undefined?1:Number(q.trim().slice(2));
    return Number.isFinite(quality)&&quality>0&&quality<=1?[type]:[];
  });
  if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return error(null,-32600,'Accept must include application/json and text/event-stream.',406);
  const version=request.headers.get('mcp-protocol-version');
  if(version!==null&&!MCP_PROTOCOLS.includes(version))return error(null,-32600,'Unsupported MCP-Protocol-Version.',400);
  let body:unknown;
  try{body=JSON.parse(await boundedBody(request));}catch(cause){return error(null,-32700,cause instanceof RangeError?'Request exceeds 32 KiB.':'Invalid UTF-8 JSON.',cause instanceof RangeError?413:400);}
  if(!object(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string'||('params'in body&&!object(body.params)))return error(null,-32600,'Expected a single JSON-RPC 2.0 message.',400);
  if('id'in body&&!(typeof body.id==='string'||typeof body.id==='number'&&Number.isFinite(body.id)||body.id===null))return error(null,-32600,'Invalid JSON-RPC request id.',400);
  // A stateless public documentation server never sends requests to a client.
  if(!('id'in body))return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
  const id=body.id as Id,params=object(body.params)?body.params:{};
  const result=(value:unknown)=>json({jsonrpc:'2.0',id,result:value});
  switch(body.method){
    case 'initialize':{
      if(typeof params.protocolVersion!=='string'||!object(params.capabilities)||!object(params.clientInfo)||typeof params.clientInfo.name!=='string'||typeof params.clientInfo.version!=='string')return error(id,-32602,'Initialize requires protocolVersion, capabilities, and clientInfo.');
      return result({protocolVersion:MCP_PROTOCOLS.includes(params.protocolVersion)?params.protocolVersion:MCP_PROTOCOLS[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'cypher-public-docs',title:'Cypher public documentation',version:'1.0.0',websiteUrl:`${CANONICAL_APP_ORIGIN}/`},instructions:'Read-only public documentation. No account access, model calls, task execution, or external service actions.'});
    }
    case 'ping':return result({});
    case 'tools/list':return result({tools});
    case 'tools/call':{
      if(typeof params.name!=='string'||!object(params.arguments))return error(id,-32602,'Tool name and arguments are required.');
      const args=params.arguments;
      if(params.name==='get_cypher_doc'){
        if(Object.keys(args).length!==1||typeof args.path!=='string'||!PUBLIC_PATHS.includes(args.path))return error(id,-32602,'Choose a public document path from the tool schema.');
        return result({content:[{type:'text',text:documentMarkdown(args.path)}],isError:false});
      }
      if(params.name==='search_cypher_docs'){
        if(Object.keys(args).length!==1||typeof args.query!=='string'||!args.query.trim()||args.query.length>200)return error(id,-32602,'query must contain 1–200 characters.');
        const terms=args.query.toLowerCase().trim().split(/\s+/);
        const matches=PUBLIC_PATHS.map(path=>({path,score:terms.filter(term=>documentMarkdown(path)!.toLowerCase().includes(term)).length})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(({path})=>({path,title:PUBLIC_DOCS[path].title,url:new URL(path,CANONICAL_APP_ORIGIN).toString(),description:PUBLIC_DOCS[path].description}));
        return result({content:[{type:'text',text:matches.length?JSON.stringify(matches):'No matching public document. Read /docs or /llms.txt for the document index.'}],isError:false});
      }
      return error(id,-32602,'Unknown documentation tool.');
    }
    default:return error(id,-32601,'Method not found.');
  }
}
export function mcpGet(request:Request){return originAllowed(request)?json({error:'This stateless documentation MCP endpoint accepts POST JSON-RPC; no SSE stream is offered.'},405):error(null,-32000,'Origin is not allowed.',403);}
