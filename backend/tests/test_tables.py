"""Real parsing, arithmetic, limits, chart export and original-upload isolation."""
import asyncio
import base64
import io
import math
import threading
from uuid import uuid4

from PIL import Image
import pytest

from app.services.tools.tables import analyze_table
from .test_workspace_workflows import workspace, room


def request(**changes):
    return {'rows': [{'team': 'A', 'amount': '0.1'}, {'team': 'A', 'amount': '0.2'},
                     {'team': 'B', 'amount': None}, {'team': 'B', 'amount': 'not a number'}],
            'data_origin': 'user_provided', 'group_by': 'team',
            'metrics': [{'column': 'amount', 'operation': 'sum', 'name': 'total'}], **changes}


def run(**changes):
    return asyncio.run(analyze_table(request(**changes), 'analyst'))


def test_decimal_totals_preserve_missingness_and_report_exclusions():
    result = run()
    assert result['success'] and result['row_count'] == 4
    assert result['groups'][0]['metrics']['total'] == {
        'value': .3, 'numeric_count': 2, 'missing_count': 0, 'non_numeric_count': 0}
    assert result['groups'][1]['metrics']['total'] == {
        'value': None, 'numeric_count': 0, 'missing_count': 1, 'non_numeric_count': 1}


def test_csv_bom_quoted_commas_and_newlines_and_explicit_tsv():
    result = run(rows=None, csv_text='\ufeffteam,amount\r\n"A, Inc",2\r\n"A, Inc",3\r\n"B\nLtd",4\r\n')
    assert [g['group'] for g in result['groups']] == ['A, Inc', 'B\nLtd']
    assert result['groups'][0]['metrics']['total']['value'] == 5
    result = run(rows=None, csv_text='team\tamount\nA\t2\nA\t3\n', delimiter='\t')
    assert result['groups'][0]['metrics']['total']['value'] == 5


@pytest.mark.parametrize('changes', [
    {'rows': None, 'csv_text': 'team,team\nA,B'},
    {'rows': None, 'csv_text': 'team,amount\nA,2,extra'},
    {'rows': None, 'csv_text': 'team,amount\n"unterminated'},
    {'rows': [{'team': 'A', 'amount': {'nested': 3}}]},
    {'rows': [{'team': 'A', 'amount': float('nan')}]},
    {'rows': [{'team': 'A', 'amount': 1}], 'csv_text': 'team,amount\nA,1'},
    {'rows': [{'team': 'A', 'amount': 1}], 'attachment_index': 0},
    {'rows': None, 'csv_text': 'team,amount\n' + 'A,1\n' * 10001},
    {'rows': None, 'csv_text': 'x' * (1024 * 1024 + 1)},
    {'group_by': 'missing-column'},
    {'rows': [{'team': 'A', 'amount': 1, **{f'c{i}': 0 for i in range(39)}}]},
    {'limit': 101}, {'attachment_index': True}, {'data_origin': 'tool_result'},
])
def test_invalid_or_over_limit_data_never_produces_partial_results(changes):
    result = run(**changes)
    assert result['success'] is False and 'groups' not in result
    assert 'attachments' not in result


@pytest.mark.parametrize('operation,expected', [('count', 5), ('sum', 2), ('mean', 1),
    ('median', 1), ('min', 0), ('max', 2)])
def test_operations_do_not_treat_booleans_as_numbers_or_empty_as_zero(operation, expected):
    result = run(rows=[{'x': value} for value in [0, '2', '', None, True, 'N/A', '=2+2']], group_by=None,
                 metrics=[{'column': 'x', 'operation': operation, 'name': 'result'}])
    metric = result['groups'][0]['metrics']['result']
    assert metric == {'value': expected, 'numeric_count': 2, 'missing_count': 2, 'non_numeric_count': 3}


def test_tail_percentiles_use_whole_population_nearest_rank_and_minimum_samples():
    for count in [9, 19, 99, 100]:
        result = run(rows=[{'x': i} for i in range(1, count + 1)], group_by=None,
            metrics=[{'column': 'x', 'operation': p, 'name': p} for p in ['p90', 'p95', 'p99']])
        metrics = result['groups'][0]['metrics']
        assert metrics['p90']['value'] == (None if count < 10 else math.ceil(count * .9))
        assert metrics['p95']['value'] == (None if count < 20 else math.ceil(count * .95))
        assert metrics['p99']['value'] == (None if count < 100 else 99)


def test_typed_groups_stay_distinct_and_sorting_keeps_null_last():
    result = run(rows=[{'team': g, 'amount': v} for g, v in [(1, 3), ('1', 2), (True, 1), (None, ''), ('', 4)]],
                 order_by='total', descending=False, limit=3)
    assert result['group_count'] == 5 and result['groups_truncated'] is True
    assert [(type(g['group']), g['group']) for g in result['groups']] == [(bool, True), (str, '1'), (int, 1)]


def test_currency_percent_and_formula_strings_are_counted_as_non_numeric():
    result = run(rows=[{'x': v} for v in ['$1,000', '10%', '=2+2', 'Infinity', '1e999999999', '1e-99999999', '1_000', '2.5e2']],
                 group_by=None, metrics=[{'column': 'x', 'operation': 'sum', 'name': 'total'}])
    assert result['groups'][0]['metrics']['total'] == {
        'value': 250, 'numeric_count': 1, 'missing_count': 0, 'non_numeric_count': 7}


def test_real_chart_and_exact_csv_are_returned_in_same_tool_result():
    result = run(chart_type='bar', chart_metric='total', title='Actual supplied totals')
    assert result['success']
    files = {f['mime']: base64.b64decode(f['data']) for f in result['_attachments']}
    assert Image.open(io.BytesIO(files['image/png'])).size == (1280, 820)
    assert b'A,0.3' in files['text/csv']
    assert b'B,\r\n' in files['text/csv']
    assert b'<svg' in files['image/svg+xml']


def test_chart_cannot_merge_typed_groups_with_identical_display_labels():
    result = run(rows=[{'team': 1, 'amount': 2}, {'team': '1', 'amount': 3}], chart_type='bar', chart_metric='total')
    assert result['success'] and 'ambiguous' in result['chart_error']
    assert '_attachments' not in result


@pytest.mark.asyncio
async def test_analysis_runs_off_event_loop(monkeypatch):
    import app.services.tools.tables as tables
    original = tables.analyze
    main_thread = threading.get_ident()
    observed = []
    def analyze(*args):
        observed.append(threading.get_ident())
        return original(*args)
    monkeypatch.setattr(tables, 'analyze', analyze)
    result = await tables.analyze_table(request(), 'analyst')
    assert result['success'] and observed and observed[0] != main_thread


@pytest.mark.asyncio
async def test_original_upload_is_bound_to_active_task_tenant_and_conversation(workspace):
    from app.services.usage import active
    from app.db.tenancy import current_tenant_id
    from app.models.task import Task
    from app.models.message import Message
    from app.models.conversation import Conversation
    from sqlalchemy import select
    client, sessions = workspace
    tasks = {}
    for tenant, amount in [('table-owner', 3), ('foreign-owner', 999)]:
        cid = await room(client, tenant)
        headers = {'x-grokbot-user-id': tenant}
        accepted = await client.post(f'/api/conversations/{cid}/messages', headers=headers, json={
            'content': 'Analyze this CSV.', 'sender_type': 'user', 'attachments': [{
                'name': 'actual.csv', 'mime': 'text/plain',
                'data': base64.b64encode(f'team,amount\nA,{amount}\n'.encode()).decode()}]})
        assert accepted.status_code == 202
        tasks[tenant] = (await client.get(f'/api/conversations/{cid}/tasks', headers=headers)).json()[0]['id']
    usage_token = active.set((tasks['table-owner'], sessions))
    tenant_token = current_tenant_id.set('table-owner')
    args = request(rows=None, attachment_index=0)
    try:
        result = await analyze_table(args, 'analyst')
        assert result['success'] and result['groups'][0]['metrics']['total']['value'] == 3
        active.set((tasks['foreign-owner'], sessions))
        assert (await analyze_table(args, 'analyst'))['success'] is False
        active.set((tasks['table-owner'], sessions))
        async with sessions() as db:
            task = await db.scalar(select(Task).where(Task.id == tasks['table-owner']))
            other_cid = str(uuid4())
            db.add(Conversation(id=other_cid, title='Other conversation'))
            # Even a same-tenant reference must remain in the current conversation.
            foreign_message = Message(id='wrong-room-upload', conversation_id=other_cid,
                sender_type='user', content='PRIVATE', metadata_json={'attachments': []})
            db.add(foreign_message)
            task.result = {'request': {'incoming_message_id': foreign_message.id}}
            await db.commit()
        assert (await analyze_table(args, 'analyst'))['success'] is False
    finally:
        active.reset(usage_token)
        current_tenant_id.reset(tenant_token)

