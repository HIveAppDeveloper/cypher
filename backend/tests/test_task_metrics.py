"""Population definitions, tail resolution, bounded reads and tenant isolation."""
from datetime import datetime, timedelta
import json

import pytest

from app.services.task_metrics import aggregate, distribution, task_metrics
from .test_workspace_workflows import workspace, room


def test_percentiles_use_nearest_rank_and_hide_unresolved_tails():
    assert distribution([])['p99_ms'] is None
    assert distribution([1, 2, True, -3, float('inf'), float('nan')])['count'] == 2
    assert distribution(list(range(1, 100)))['p99_ms'] is None
    result = distribution(list(range(1, 101)))
    assert (result['p50_ms'], result['p90_ms'], result['p95_ms'], result['p99_ms']) == (50, 90, 95, 99)
    assert result['mean_ms'] == 50.5
    assert distribution([1]*9)['p90_ms'] is None
    assert distribution([1]*19)['p95_ms'] is None


def test_lifecycle_excludes_nonterminal_bad_order_future_and_missing_times():
    now = datetime(2026, 10, 26, 12)
    created = now-timedelta(minutes=10)
    good = {'status': 'completed', 'created_at': created, 'started_at': created+timedelta(seconds=3),
            'completed_at': created+timedelta(seconds=8), 'attempts': 2, 'recoveries': 1,
            'voice_timings': {'model_gateway_ms': 4000, 'tool_ms': 9999, 'PRIVATE': 'never return this'}}
    rows = [good, {**good, 'status': 'failed'}, {**good, 'status': 'running'},
            {**good, 'started_at': None}, {**good, 'started_at': now},
            {**good, 'completed_at': now+timedelta(seconds=1)}]
    result = aggregate(rows, now=now, since=created, cap=100, has_more=False)
    assert result['sample']['excluded_from_lifecycle'] == {'nonterminal': 1, 'missing_or_invalid_lifecycle': 3}
    assert result['latency_by_status']['completed']['queue_ms']['mean_ms'] == 3000
    assert result['latency_by_status']['completed']['runtime_ms']['mean_ms'] == 5000
    assert result['latency_by_status']['failed']['total_ms']['count'] == 1
    assert result['latency_by_status']['cancelled']['total_ms']['count'] == 0
    assert result['measured_audio_stages_by_status']['completed']['model_gateway_ms']['count'] == 1
    assert 'PRIVATE' not in json.dumps(result) and 'tool_ms' not in json.dumps(result)


@pytest.mark.asyncio
async def test_metrics_http_is_read_only_tenant_scoped_capped_and_content_free(workspace):
    from app.models.task import Task
    from app.models.message import Message
    from app.models.execution import TaskExecution
    from app.db.tenancy import current_tenant_id
    from sqlalchemy import select, func
    client, sessions = workspace
    now = datetime.utcnow()
    for tenant, count in [('metrics-owner', 100), ('foreign-owner', 10)]:
        cid = await room(client, tenant)
        bot = (await client.get('/api/bots', headers={'x-grokbot-user-id': tenant})).json()[0]['id']
        token = current_tenant_id.set(tenant)
        try:
            async with sessions() as db:
                for i in range(count):
                    mid, tid = f'{tenant}-message-{i}', f'{tenant}-task-{i}'
                    created = now-timedelta(minutes=30, seconds=i)
                    db.add(Message(id=mid, conversation_id=cid, sender_type='user', content='PRIVATE MESSAGE',
                                   metadata_json={'voice_timings': {'model_provider_ms': 100+i}}))
                    db.add(Task(id=tid, bot_id=bot, conversation_id=cid, title='PRIVATE TITLE', description='PRIVATE TASK',
                                status='completed', created_at=created, started_at=created+timedelta(seconds=1),
                                completed_at=created+timedelta(seconds=i+2),
                                result={'request': {'incoming_message_id': mid}, 'secret': 'PRIVATE RESULT'}))
                    db.add(TaskExecution(task_id=tid, attempts=1, recoveries=0))
                # Outside window and missing timing; neither may distort tails.
                db.add(Task(bot_id=bot, conversation_id=cid, title='PRIVATE OLD', description='PRIVATE',
                            status='completed', created_at=now-timedelta(days=8)))
                await db.commit()
        finally:
            current_tenant_id.reset(token)
    path = '/api/workspace/runs/metrics'
    assert (await client.get(path)).status_code == 401
    headers = {'x-grokbot-user-id': 'metrics-owner'}
    assert (await client.get(path+'?cap=10001', headers=headers)).status_code == 422
    assert (await client.get(path+'?hours=169', headers=headers)).status_code == 422
    response = await client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'private, no-store'
    data = response.json()
    assert data['sample']['count'] == 100 and data['sample']['truncated'] is False
    assert data['latency_by_status']['completed']['runtime_ms']['p99_ms'] == 99000
    assert data['measured_audio_stages_by_status']['completed']['model_provider_ms']['count'] == 100
    assert data['attempts'] == 100
    assert all(word not in response.text for word in ('PRIVATE', 'metrics-owner', 'foreign-owner', cid, bot))
    capped = (await client.get(path+'?cap=9', headers=headers)).json()
    assert capped['sample']['count'] == 9 and capped['sample']['truncated'] is True
    assert capped['latency_by_status']['completed']['runtime_ms']['p90_ms'] is None
    assert capped['measured_audio_stages_by_status']['completed']['model_provider_ms']['mean_ms'] == 104
    empty = (await client.get(path, headers={'x-grokbot-user-id': 'empty-owner'})).json()
    assert empty['sample']['count'] == 0
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(Task)) == 112
        with pytest.raises(ValueError, match='signed-in'):
            await task_metrics(db, None)
