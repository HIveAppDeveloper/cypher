import {MCP_MANIFEST} from '../../../lib/public-mcp';
export function GET(){return Response.json(MCP_MANIFEST,{headers:{'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
