import {llmsIndex,PUBLIC_PATHS,documentMarkdown} from '../../lib/public-docs';
export function GET(){return new Response(PUBLIC_PATHS.map(path=>documentMarkdown(path)).join('\n---\n\n'),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
