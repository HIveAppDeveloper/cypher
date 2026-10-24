"""Real stateless MCP transport over the same authenticated, tenant-scoped Google handlers."""
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.types import Tool,TextContent,CallToolResult
from starlette.applications import Starlette
from starlette.routing import Route
from app.db.session import AsyncSessionLocal
from app.db.tenancy import current_tenant_id
from app.services import google_workspace as google
server=Server('Cypher Google Workspace')

@server.list_tools()
async def list_tools():
 if not current_tenant_id.get():return []
 async with AsyncSessionLocal() as db:
  row=await google.grant(db);saved=google.DatabaseTokenStorage(db,row).read() if row else {}
  return [Tool(name=t['name'],description=t['description'],inputSchema=t['schema'],annotations={'readOnlyHint':t['read_only'],'destructiveHint':not t['read_only']}) for t in google.allowed_tools(saved)]

@server.call_tool()
async def call_tool(name,arguments):
 if not current_tenant_id.get():return CallToolResult(content=[TextContent(type='text',text='Sign in to Cypher first.')],isError=True)
 try:
  async with AsyncSessionLocal() as db:result=await google.invoke(db,name,arguments)
  return CallToolResult(content=[TextContent(type='text',text=result['content'])],isError=False)
 except Exception as error:
  message=getattr(error,'detail','Google did not complete this operation.')
  return CallToolResult(content=[TextContent(type='text',text=str(message))],isError=True)

manager=StreamableHTTPSessionManager(app=server,stateless=True,json_response=True)
class Transport:
 async def __call__(self,scope,receive,send):await manager.handle_request(scope,receive,send)
app=Starlette(routes=[Route('/',endpoint=Transport(),methods=['GET','POST','DELETE'])])
