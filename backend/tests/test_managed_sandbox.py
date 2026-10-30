import pytest


def test_existing_sandbox_retries_workspace_setup_after_interrupted_bootstrap(monkeypatch):
    from uuid import uuid4

    from vercel.sandbox.sync import SyncSandboxClient
    from app.services.managed_sandbox import computer

    calls = []
    closed = []
    fail_first_chmod = True

    class Box:
        name = 'persistent-sandbox'

        def run_process(self, command, args, **kwargs):
            nonlocal fail_first_chmod
            calls.append((command, args, kwargs))
            if command == 'chmod' and fail_first_chmod:
                fail_first_chmod = False
                raise RuntimeError('temporary bootstrap failure')

    box = Box()

    class Client:
        def get_or_create_sandbox(self, **kwargs):
            # The sandbox persists even though setup failed on the first call.
            return box, False

        def close(self):
            closed.append(True)

    monkeypatch.setattr(SyncSandboxClient, 'create', lambda: Client())
    bot_id = str(uuid4())

    with pytest.raises(RuntimeError, match='temporary bootstrap failure'):
        with computer(bot_id):
            pytest.fail('sandbox must not be yielded before setup completes')

    with computer(bot_id) as reopened:
        assert reopened is box

    assert [command for command, _, _ in calls] == ['mkdir', 'chmod', 'mkdir', 'chmod']
    assert calls[0][1] == ['-p', '/workspace']
    assert calls[1][1] == ['777', '/workspace']
    assert calls[2][1] == ['-p', '/workspace']
    assert calls[3][1] == ['777', '/workspace']
    assert closed == [True, True]
