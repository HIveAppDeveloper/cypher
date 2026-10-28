import {llmsIndex,PUBLIC_PATHS,documentMarkdown} from '../../lib/public-docs';
export function GET(){return new Response(llmsIndex(),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
