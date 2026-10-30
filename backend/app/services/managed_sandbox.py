"""Vercel Sandbox broker. Project secrets stay outside the agent VM."""
from contextlib import contextmanager
from uuid import UUID

@contextmanager
def computer(bot_id):
    from vercel.sandbox.sync import SyncSandboxClient
    client = SyncSandboxClient.create()
    try:
        box, _created = client.get_or_create_sandbox(name='grokbot-' + str(UUID(bot_id)), persistent=True, execution_time_limit=600, env={})
        # Persistent sandboxes may survive an interrupted first setup, and a
        # user command can remove /workspace. Re-establish it before every use
        # so an existing sandbox is always ready for commands using cwd below.
        box.run_process('mkdir', ['-p', '/workspace'], sudo=True, check=True, capture_output=True)
        box.run_process('chmod', ['777', '/workspace'], sudo=True, check=True, capture_output=True)
        yield box
    finally:
        client.close()

def start(bot_id):
    with computer(bot_id) as box:
        return box.name

def stop(bot_id):
    from vercel.sandbox.sync import SyncSandboxClient
    from vercel.sandbox import SandboxApiError
    client = SyncSandboxClient.create()
    try:
        client.get_sandbox(name='grokbot-' + str(UUID(bot_id))).stop()
    except SandboxApiError as error:
        # A plugin-only agent may never have needed a computer. Repeated Stop
        # must also succeed after a sandbox has expired or already stopped.
        if error.status_code not in (404,410):raise
    finally:
        client.close()

def execute(bot_id, command, max_output=50000):
    argv = command if isinstance(command, list) else ['bash', '-lc', command]
    with computer(bot_id) as box:
        result = box.run_process(argv[0], argv[1:], cwd='/workspace', capture_output=True, kill_after=300)
        return {'exit_code': result.returncode, 'output': ((result.stdout or '') + (result.stderr or ''))[:max_output]}
