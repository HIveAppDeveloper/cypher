"""Snapshot a requested sandbox deliverable into an authenticated chat attachment."""
import asyncio
import base64
import json
import mimetypes
from app.services.sandbox import SandboxManager

MAX_FILE_BYTES = 5 * 1024 * 1024

# Execute in the sandbox: never read server files, follow escapes, or load an
# unbounded file. The snapshot survives sandbox restarts and later file edits.
EXPORT_SCRIPT = '''
import base64,json,pathlib,sys
try:
    root=pathlib.Path('/workspace').resolve()
    path=pathlib.Path(sys.argv[1]).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Choose a regular file inside /workspace.')
    with path.open('rb') as stream:
        data=stream.read(int(sys.argv[2])+1)
    if len(data)>int(sys.argv[2]):
        raise ValueError('File exceeds the 5 MB attachment limit. Split or compress the deliverable.')
    print(json.dumps({'name':path.name,'data':base64.b64encode(data).decode()}))
except (OSError,ValueError) as error:
    print(json.dumps({'error':str(error)}))
'''


async def publish_file(arguments, bot_id):
    path = arguments.get('path', '')
    if not isinstance(path, str) or not path.startswith('/workspace/') or len(path) > 1000:
        return {'success': False, 'error': 'Choose an absolute file path inside /workspace.'}
    try:
        # This output can be larger than normal terminal output. Use a dedicated
        # bounded read instead of the terminal tool's 10 KB display truncation.
        result = await asyncio.to_thread(SandboxManager.read_artifact, bot_id, EXPORT_SCRIPT, path, MAX_FILE_BYTES)
        if result.get('exit_code') != 0:
            return {'success': False, 'error': 'The sandbox could not export this file. Check that it exists.'}
        item = json.loads(result['output'])
        if 'error' in item:
            return {'success': False, 'error': item['error']}
        data = base64.b64decode(item['data'], validate=True)
        if len(data) > MAX_FILE_BYTES:
            raise ValueError('File exceeds the attachment limit.')
        name = item['name'][:160]
        mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        return {'success': True, 'name': name, 'size_bytes': len(data),
                '_attachments': [{'name': name, 'mime': mime, 'data': item['data'], 'disposition': 'attachment'}]}
    except (OSError, ValueError, KeyError, TypeError):
        return {'success': False, 'error': 'The sandbox file could not be exported. No download was created.'}
