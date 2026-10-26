from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.tenancy import current_tenant_id
from app.models.execution import TaskExecution
from app.models.task import Task
from app.models.workspace import UsageEvent
from app.services.task_observation import task_observation
from .test_workspace_workflows import workspace, room


@pytest.mark.asyncio
async def test_exact_task_metrics_are_content_free_read_only_and_isolated(workspace):
    client, sessions = workspace
    ids = {}
    for tenant in ('observation-owner', 'foreign-owner'):
        cid = await room(client, tenant)
        bot = (await client.get('/api/bots', headers={'x-grokbot-user-id': tenant})).json()[0]['id']
        token = current_tenant_id.set(tenant)
        try:
            async with sessions() as db:
                tid = ids[tenant] = str(uuid4())
                now = datetime.utcnow()-timedelta(minutes=1)
                db.add(Task(id=tid, bot_id=bot, conversation_id=cid, title='PRIVATE TITLE',
                            description='PRIVATE TASK', result={'secret': 'PRIVATE RESULT'},
                            status='completed', created_at=now,
                            started_at=now+timedelta(seconds=2), completed_at=now+timedelta(seconds=5)))
                db.add(TaskExecution(task_id=tid, attempts=2, recoveries=1, last_error='PRIVATE ERROR'))
                for input_tokens, cost in ((10, 0), (20, .003)):
                    db.add(UsageEvent(task_id=tid, provider='openai', model='test-model',
                                      input_tokens=input_tokens, output_tokens=5, estimated_cost=cost))
                # Other tasks must never contaminate this task's usage.
                db.add(UsageEvent(task_id=str(uuid4()), provider='openai', model='OTHER', input_tokens=999))
                await db.commit()
        finally:
            current_tenant_id.reset(token)
    path = f"/api/workspace/runs/{ids['observation-owner']}/metrics"
    assert (await client.get(path)).status_code == 401
    headers = {'x-grokbot-user-id': 'observation-owner'}
    response = await client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'private, no-store'
    data = response.json()
    assert data['latency'] == {'queue_ms': 2000, 'runtime_ms': 3000, 'total_ms': 5000}
    assert data['attempts'] == 2 and data['recoveries'] == 1 and data['lifecycle_valid']
    assert data['usage_by_model'] == [{'provider': 'openai', 'model': 'test-model',
                                     'recorded_usage_events': 2, 'input_tokens': 30,
                                     'output_tokens': 10, 'recorded_estimated_cost': .003}]
    assert data['billing_verified'] is False and data['cost_provenance'] == 'legacy_unqualified'
    assert 'PRIVATE' not in response.text and 'OTHER' not in response.text
    foreign = await client.get(f"/api/workspace/runs/{ids['foreign-owner']}/metrics", headers=headers)
    missing = await client.get(f'/api/workspace/runs/{uuid4()}/metrics', headers=headers)
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()
    token = current_tenant_id.set('observation-owner')
    try:
        async with sessions() as db:
            task = await db.get(Task, ids['observation-owner'])
            task.started_at = None
            await db.commit()
            invalid = await task_observation(db, 'observation-owner', task.id)
            assert not invalid['lifecycle_valid'] and set(invalid['latency'].values()) == {None}
            with pytest.raises(ValueError, match='signed-in'):
                await task_observation(db, None, task.id)
            assert await db.scalar(select(func.count()).select_from(UsageEvent)) == 3
    finally:
        current_tenant_id.reset(token)
