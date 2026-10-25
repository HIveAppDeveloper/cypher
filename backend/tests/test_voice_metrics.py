import asyncio
import pytest
from app.services import voice_metrics


@pytest.mark.asyncio
async def test_audio_metrics_are_monotonic_numeric_and_do_not_collect_content(monkeypatch):
    ticks=iter([1.,2.,3.,4.,5.,6.])
    monkeypatch.setattr(voice_metrics,'perf_counter',lambda:next(ticks))
    class Runner:
        saved=None
        @voice_metrics.audio_task
        async def run(self, attachments=None):
            with voice_metrics.stage('normalize'):
                pass
            return 'private transcript must not enter metrics'
        async def _persist_voice_metrics(self, metrics): self.saved=dict(metrics)
    runner=Runner()
    result=await runner.run(attachments=[{'mime':'audio/webm','data':'private source audio'}])
    assert result.startswith('private transcript')
    assert runner.saved=={'normalize_ms':1000.,'normalize_calls':1,'worker_total_ms':3000.}
    assert all(isinstance(value,(int,float)) for value in runner.saved.values())
    assert voice_metrics._current.get() is None


@pytest.mark.asyncio
async def test_concurrent_audio_turns_do_not_share_or_leak_metrics():
    class Runner:
        def __init__(self): self.saved=None
        @voice_metrics.audio_task
        async def run(self, attachments=None, marker=0):
            voice_metrics.note('marker',marker)
            await asyncio.sleep(0)
            with voice_metrics.stage('provider'): await asyncio.sleep(0)
        async def _persist_voice_metrics(self, metrics): self.saved=dict(metrics)
    one,two=Runner(),Runner()
    await asyncio.gather(one.run(attachments=[{'mime':'audio/webm'}],marker=1),two.run(attachments=[{'mime':'audio/webm'}],marker=2))
    assert one.saved['marker']==1 and two.saved['marker']==2
    assert one.saved['provider_calls']==two.saved['provider_calls']==1
    assert voice_metrics._current.get() is None


@pytest.mark.asyncio
async def test_text_tasks_do_not_persist_voice_metrics():
    class Runner:
        @voice_metrics.audio_task
        async def run(self, attachments=None): return 'normal text'
        async def _persist_voice_metrics(self, metrics): raise AssertionError('unexpected persistence')
    assert await Runner().run(attachments=[{'mime':'text/plain'}])=='normal text'


@pytest.mark.asyncio
async def test_metrics_failure_never_replaces_success_or_task_error():
    class Runner:
        @voice_metrics.audio_task
        async def run(self, attachments=None, fail=False):
            if fail: raise ValueError('original task failure')
            return 'complete'
        async def _persist_voice_metrics(self, metrics): raise RuntimeError('metrics store unavailable')
    runner=Runner()
    assert await runner.run(attachments=[{'mime':'audio/mpeg'}])=='complete'
    with pytest.raises(ValueError,match='original task failure'):
        await runner.run(attachments=[{'mime':'audio/mpeg'}],fail=True)
    assert voice_metrics._current.get() is None


@pytest.mark.asyncio
async def test_voice_continuation_and_opaque_job_correlations_are_scoped_without_changing_numeric_metrics():
    from uuid import uuid4
    one_id, two_id = str(uuid4()), str(uuid4())
    class Runner:
        @voice_metrics.audio_task
        async def run(self, attachments=None, enabled=False, job_id=None):
            with voice_metrics.voice_continuation(enabled):
                await asyncio.sleep(0)
                assert voice_metrics.is_voice_continuation() is enabled
                voice_metrics.remember_gateway_job('/chat/completions', job_id)
                voice_metrics.remember_gateway_job('/chat/completions', job_id)
                for bad in ('private provider body', None, 'not-a-uuid', '{'+job_id+'}'):
                    voice_metrics.remember_gateway_job('/chat/completions', bad)
                voice_metrics.remember_gateway_job('/models', str(uuid4()))
        async def _persist_voice_metrics(self, metrics):
            assert all(isinstance(value,(int,float)) for value in metrics.values())
            self.jobs = voice_metrics.gateway_jobs()
    one,two=Runner(),Runner()
    await asyncio.gather(one.run(attachments=[{'mime':'audio/webm'}],enabled=True,job_id=one_id),
                         two.run(attachments=[{'mime':'audio/webm'}],enabled=False,job_id=two_id))
    assert one.jobs == [{'job_id':one_id,'stage':'model'}]
    assert two.jobs == [{'job_id':two_id,'stage':'model'}]
    assert not voice_metrics.is_voice_continuation() and voice_metrics.gateway_jobs() == []
    with pytest.raises(ValueError):
        with voice_metrics.voice_continuation(True):
            raise ValueError('original error')
    assert not voice_metrics.is_voice_continuation()
