import {prefersMarkdown,notFoundMarkdown} from '../../lib/public-docs';

export function GET(request:Request) {
  const markdown=prefersMarkdown(request.headers.get('accept'))||new URL(request.url).pathname.endsWith('.md');
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page not found | Cypher</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;max-width:65ch;margin:10vh auto;padding:24px"><main><h1>Page not found</h1><p>This Cypher page does not exist. Check the address or open the documentation.</p><nav><a href="/">Cypher home</a> · <a href="/docs">Documentation</a> · <a href="/llms.txt">Agent document index</a></nav></main></body></html>';
  return new Response(markdown?notFoundMarkdown():html,{status:404,headers:{'Content-Type':markdown?'text/markdown; charset=utf-8':'text/html; charset=utf-8','Vary':'Accept','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export function HEAD(request:Request){const response=GET(request);return new Response(null,{status:response.status,headers:response.headers});}
