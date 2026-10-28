import {mcpPost,mcpGet} from '../../lib/public-mcp';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=mcpPost;
export function GET(request:Request){const response=mcpGet(request);response.headers.set('Allow','POST');return response;}
