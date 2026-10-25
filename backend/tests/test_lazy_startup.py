"""Fresh-process import and lifecycle contracts; no DB or provider access."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


BACKEND = Path(__file__).resolve().parents[1]


def isolated(tmp_path, script):
    # Never inherit provider credentials or load a developer's dotenv files.
    env = {
        'PATH': os.defpath, 'TMPDIR': str(tmp_path),
        'GROKBOT_DATABASE_URL': 'sqlite+aiosqlite:///:memory:',
        'REDIS_URL': '', 'SANDBOX_BACKEND': 'vercel',
        'RUN_EMBEDDED_WORKER': 'false', 'GROKBOT_ATLAS_ENGINE_ENABLED': 'false',
        'LITELLM_LOCAL_MODEL_COST_MAP': 'True', 'DO_NOT_TRACK': '1',
    }
    bootstrap = f"import sys\nsys.path.insert(0, {str(BACKEND)!r})\n" + '''
import os
home = os.path.abspath(os.path.expanduser('~')) + os.sep
allowed = tuple(os.path.abspath(p) + os.sep for p in (sys.path[0], sys.prefix, sys.base_prefix))
def offline(event, args):
    if event in {'socket.connect', 'socket.bind', 'socket.getaddrinfo',
                 'socket.gethostbyname', 'socket.gethostbyaddr',
                 'socket.getnameinfo', 'socket.sendto', 'socket.sendmsg'}:
        raise PermissionError('Startup regression tests deny network access')
    if event == 'open' and isinstance(args[0], (str, bytes)):
        path = os.path.abspath(os.fsdecode(args[0]))
        if os.path.basename(path) in {'.env', '.env.vercel.local'} or (path.startswith(home) and not path.startswith(allowed)):
            raise PermissionError('Startup regression tests deny dotenv and home configuration reads')
sys.addaudithook(offline)
'''
    result = subprocess.run(
        [sys.executable, '-I', '-B', '-c', bootstrap + script],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_disabled_atlas_and_health_do_not_import_inference_or_worker(tmp_path):
    result = isolated(tmp_path, '''
import importlib.abc
import asyncio
import json
class NoOptionalModules(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {'litellm', 'app.services.llm_gateway', 'app.services.worker'}:
            raise AssertionError('Optional module imported: ' + fullname)
sys.meta_path.insert(0, NoOptionalModules())
from app.main import app, health_check
import httpx
async def check():
    assert (await health_check())['status'] == 'ok'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/api/integrations/atlas/v1/chat', json={})
    assert response.status_code == 503
    assert response.json()['code'] == 'engine_disabled'
    print(json.dumps({'health': 'ok', 'atlas': response.json()['code']}))
asyncio.run(check())
''')
    assert result == {'health': 'ok', 'atlas': 'engine_disabled'}


@pytest.mark.parametrize('embedded', [False, True])
def test_lifespan_only_imports_and_runs_explicit_embedded_worker(tmp_path, embedded):
    result = isolated(tmp_path, f'embedded = {embedded!r}\n' + '''
import asyncio
import importlib.abc
import importlib.util
import json
events = {'worker_imports': 0, 'worker_started': False, 'worker_stopped': False,
          'recovery_stopped': False, 'engine_disposed': False}
class WorkerLoader(importlib.abc.Loader):
    def create_module(self, spec): return None
    def exec_module(self, module):
        async def run_worker():
            events['worker_started'] = True
            try: await asyncio.Event().wait()
            finally: events['worker_stopped'] = True
        module.run_worker = run_worker
class WorkerFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'app.services.worker':
            events['worker_imports'] += 1
            return importlib.util.spec_from_loader(fullname, WorkerLoader())
sys.meta_path.insert(0, WorkerFinder())
from app import main
from app.services import database_health
async def initialize(app, engine):
    app.state.database_ready = True
    app.state.database_failure = None
    return True
async def recover(app, engine):
    try: await asyncio.Event().wait()
    finally: events['recovery_stopped'] = True
class LocalEngine:
    async def dispose(self): events['engine_disposed'] = True
main.engine = LocalEngine()
database_health.initialize = initialize
database_health.recover = recover
main.settings.RUN_EMBEDDED_WORKER = embedded
async def check():
    async with main.lifespan(main.app):
        await asyncio.sleep(0)
        assert main.app.state.database_ready is True
        assert events['worker_imports'] == int(embedded)
        assert events['worker_started'] is embedded
    assert events['worker_stopped'] is embedded
    assert events['recovery_stopped'] is True
    assert events['engine_disposed'] is True
    print(json.dumps(events))
asyncio.run(check())
''')
    assert result['worker_imports'] == int(embedded)
    assert result['worker_started'] is embedded
    assert result['worker_stopped'] is embedded
