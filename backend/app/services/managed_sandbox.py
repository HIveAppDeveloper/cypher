"""Vercel Sandbox broker. Project secrets stay outside the agent VM."""
from contextlib import contextmanager
from uuid import UUID

@contextmanager
def computer(bot_id):
    from vercel.sandbox.sync import SyncSandboxClient
    client = SyncSandboxClient.create()
    try:
        box, created = client.get_or_create_sandbox(name='grokbot-' + str(UUID(bot_id)), persistent=True, execution_time_limit=600, env={})
        if created:
            box.run_process('mkdir', ['-p', '/workspace'], sudo=True, check=True, capture_output=True)
            box.run_process('chmod', ['777', '/workspace'], sudo=True, check=True, capture_output=True)
        yield box
    finally:
        client.close()

def start(bot_id):
    with computer(bot_id) as box:
        return box.id

def stop(bot_id):
    from vercel.sandbox.sync import SyncSandboxClient
    client = SyncSandboxClient.create()
    try:
        client.get_sandbox(name='grokbot-' + str(UUID(bot_id))).stop()
    finally:
        client.close()

def execute(bot_id, command):
    argv = command if isinstance(command, list) else ['bash', '-lc', command]
    with computer(bot_id) as box:
        result = box.run_process(argv[0], argv[1:], cwd='/workspace', capture_output=True, kill_after=300)
        return {'exit_code': result.returncode, 'output': ((result.stdout or '') + (result.stderr or ''))[:50000]}
