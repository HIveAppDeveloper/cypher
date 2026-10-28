import {NextResponse,type NextRequest} from 'next/server';
import {PUBLIC_DOCS,PUBLIC_PATHS,documentMarkdown,markdownPath,prefersMarkdown} from './lib/public-docs';

export function middleware(request:NextRequest) {
  if(request.method!=='GET'&&request.method!=='HEAD')return NextResponse.next();
  const path=request.nextUrl.pathname;
  const alias=PUBLIC_PATHS.find(candidate=>markdownPath(candidate)===path);
  const document=alias||Object.prototype.hasOwnProperty.call(PUBLIC_DOCS,path)&&path;
  if(!document)return NextResponse.next();
  const response=alias||prefersMarkdown(request.headers.get('accept'))?
    new NextResponse(request.method==='HEAD'?null:documentMarkdown(document),{headers:{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'private, no-store'}}):NextResponse.next();
  response.headers.set('Vary','Accept');
  response.headers.set('Link',`</llms.txt>; rel="describedby", <${markdownPath(document)}>; rel="alternate"; type="text/markdown"`);
  return response;
}
export const config={runtime:'nodejs',matcher:['/((?!api/|_next/|mcp$|provider-logos/|connector-icons/).*)']};
