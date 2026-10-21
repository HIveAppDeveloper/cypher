"""Owner computer commands execute on the persistent worker, beside its browser."""
import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
from datetime import datetime,timedelta
from uuid import uuid5,NAMESPACE_URL
from sqlalchemy import select,delete
from app.db.tenancy import current_tenant_id
from app.models.workspace import ComputerControl,ComputerCommand,ToolApproval,SharedFile
from app.services.plugins import seal,reveal

locks={}
def lock(bot_id):return locks.setdefault(bot_id,asyncio.Lock())

async def taken_over(db,bot_id):
    row=await db.get(ComputerControl,bot_id)
    return bool(row and row.takeover_until and row.takeover_until>datetime.utcnow())

@asynccontextmanager
async def agent_access(bot_id,sessions):
    while True:
        async with lock(bot_id):
            async with sessions() as db:paused=await taken_over(db,bot_id)
            if not paused:
                yield
                return
        await asyncio.sleep(2)

async def approve_tool(name,args,bot_id,replay_safe):
    from app.services.usage import active
    from app.services.workspace import preferences
    current=active.get()
    if not current or not current[0]:return True
    task_id,sessions=current
    async with sessions() as db:
        policy=(await preferences(db)).get('tool_approval','never')
        if policy=='never' or (policy=='writes' and replay_safe):return True
        digest=hashlib.sha256(json.dumps([name,args],sort_keys=True).encode()).hexdigest()
        id=str(uuid5(NAMESPACE_URL,task_id+':approval:'+digest))
        row=await db.get(ToolApproval,id)
        if not row:
            row=ToolApproval(id=id,task_id=task_id,bot_id=bot_id,name=name,arguments=seal(json.dumps(args)));db.add(row);await db.commit()
    for _ in range(900):
        async with sessions() as db:
            row=await db.get(ToolApproval,id)
            if row.status!='pending':return row.status=='approved'
        await asyncio.sleep(2)
    return False

async def execute_command(command,arguments):
    from app.services.tools.registry import _browser_tool,_shell_tool,_filesystem_tool
    bot_id=command.bot_id
    if command.action=='terminal':return await _shell_tool.execute(bot_id,arguments['command'],timeout=30)
    if command.action=='list_files':return await _filesystem_tool.list_directory(bot_id,arguments.get('path','/workspace'))
    if command.action=='read_file':return await _filesystem_tool.read_file(bot_id,arguments['path'])
    if command.action=='write_file':return await _filesystem_tool.write_file(bot_id,arguments['path'],arguments['content'])
    if command.action=='navigate':
        from app.services.plugins import validate_endpoint
        await validate_endpoint(arguments['url'])
        result=await _browser_tool.navigate_to(arguments['url'],session_id=bot_id)
        if not result.get('success'):return result
    page=await _browser_tool._get_page(bot_id)
    if command.action=='click':await page.mouse.click(arguments['x'],arguments['y'])
    if command.action=='type':await page.keyboard.insert_text(arguments['text'])
    if command.action=='key':await page.keyboard.press(arguments['key'])
    if command.action=='scroll':await page.mouse.wheel(0,arguments['delta'])
    await _browser_tool._save_state(bot_id)
    import base64
    return {'success':True,'url':page.url,'title':await page.title(),'width':1280,'height':720,'image':base64.b64encode(await page.screenshot(type='jpeg',quality=65)).decode()}

async def tick_commands(sessions):
    async with sessions() as db:
        commands=(await db.execute(select(ComputerCommand).where(ComputerCommand.status=='pending').order_by(ComputerCommand.created_at).limit(3).with_for_update(skip_locked=True))).scalars().all()
        for command in commands:
            token=current_tenant_id.set(command.tenant_id)
            try:
                if command.created_at<datetime.utcnow()-timedelta(minutes=2):
                    command.status='expired';command.payload='';continue
                if not await taken_over(db,command.bot_id):
                    command.status='failed';command.result=seal(json.dumps({'error':'Take control before using the computer.'}));command.payload='';continue
                # Mark intent before input. A crash never replays an ambiguous click or shell command.
                arguments=json.loads(reveal(command.payload));command.status='running';await db.commit()
                async with lock(command.bot_id):
                    try:
                        if not await taken_over(db,command.bot_id):
                            result={'error':'Control was returned before this action started. No action was performed.'}
                        else:
                            async with asyncio.timeout(45):result=await execute_command(command,arguments)
                    except Exception as error:result={'error':'Computer operation failed. Refresh and check the current state before trying again.','type':type(error).__name__}
                command.result=seal(json.dumps(result));command.payload='';command.status='completed';command.updated_at=datetime.utcnow();await db.commit()
            finally:current_tenant_id.reset(token)
        await db.execute(delete(ComputerCommand).where(ComputerCommand.created_at<datetime.utcnow()-timedelta(hours=1)))
        await db.commit()

async def shared_files_tool(args,bot_id):
    from app.db.session import AsyncSessionLocal
    from app.services.usage import active
    context=active.get()
    sessions=context[1] if context else AsyncSessionLocal
    async with sessions() as db:
        if args.get('action')=='list':
            return {'files':[{'name':r.name,'updated_at':r.updated_at.isoformat()} for r in (await db.execute(select(SharedFile.name,SharedFile.updated_at))).all()]}
        name=args.get('name','').strip()
        if not name or len(name)>200 or '/' in name or '\\' in name:return {'error':'Use a simple file name.'}
        row=(await db.execute(select(SharedFile).where(SharedFile.name==name))).scalar_one_or_none()
        if args.get('action')=='read':return {'name':name,'content':reveal(row.content)} if row else {'error':'Shared file not found.'}
        content=args.get('content','')
        if len(content.encode())>200000:return {'error':'Keep shared text files below 200 KB.'}
        if not row:row=SharedFile(name=name);db.add(row)
        row.content=seal(content);row.updated_at=datetime.utcnow();await db.commit();return {'saved':True,'name':name}
