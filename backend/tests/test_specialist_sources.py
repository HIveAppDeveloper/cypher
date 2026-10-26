"""Every executable profile needs relevant reviewed, pinned, eligible sources."""
import copy
from datetime import datetime, timedelta, timezone
import json

import pytest

from app.services import specialist_sources as provenance
from app.services.specialist_catalog import DOMAINS, PROCEDURES, get_skill, search_skills, eligible_catalog_size
from app.services.fleet import ModelFleet, LLMGateway
from .test_workspace_workflows import workspace, room


@pytest.fixture
def source_store(tmp_path, monkeypatch):
    data = copy.deepcopy(provenance.manifest())
    path = tmp_path/'sources.json'
    path.write_text(json.dumps(data))
    monkeypatch.setattr(provenance, 'MANIFEST_PATH', path)
    provenance.clear_source_caches()
    def save(updated):
        path.write_text(json.dumps(updated))
        provenance.clear_source_caches()
    try:
        yield data, save
    finally:
        provenance.clear_source_caches()


def test_all_10000_profiles_have_reviewed_eligible_primary_source_mappings():
    data = provenance.manifest()
    assert set(data['domain_sources']) == {d.id for d in DOMAINS}
    assert set(data['procedure_sources']) == {p.id for p in PROCEDURES}
    assert eligible_catalog_size() == 10000
    observed = datetime.fromisoformat(data['checked_at'].replace('Z', '+00:00'))
    for source in data['sources'].values():
        assert provenance.source_is_eligible(source, data['repositories'][source['repository']], data['checked_at'], now=observed)
    for domain in DOMAINS:
        for procedure in PROCEDURES:
            card = get_skill(domain.id+'.'+procedure.id)
            assert card and card['eligibility']['eligible'] is True
            assert 1 <= len(card['sources']) <= 2
            assert 'Reviewed upstream workflow:' in card['instructions']
            assert all(s['stars'] >= 10000 and s['adaptation_scope'] == 'workflow_adaptation' for s in card['sources'])
    assert get_skill('agriculture.summary') is None
    assert get_skill('mathematics.summary') is None
    assert get_skill('public-policy.summary') is None
    for procedure in ('execution-plan', 'fact-check', 'quality-review', 'summary', 'handoff-plan'):
        assert get_skill('general-work.'+procedure)


@pytest.mark.parametrize('mutation', ['stars', 'archived', 'license', 'pin', 'url', 'review', 'hash', 'future', 'stale'])
def test_unqualified_sources_are_rejected_not_decorated(source_store, mutation):
    data, save = source_store
    source = data['sources']['backend']
    repo = data['repositories'][source['repository']]
    if mutation == 'stars': repo['stars'] = 9999
    if mutation == 'archived': repo['archived'] = True
    if mutation == 'license': repo['license'] = None
    if mutation == 'pin': source['commit'] = 'main'
    if mutation == 'url': source['url'] = 'https://example.test/unreviewed'
    if mutation == 'review': source['reviewed'] = False
    if mutation == 'hash': source['content_sha256'] = ''
    if mutation == 'future': data['checked_at'] = (datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    if mutation == 'stale': data['checked_at'] = (datetime.now(timezone.utc)-timedelta(days=31)).isoformat()
    save(data)
    assert get_skill('python.concurrency-review') is None
    assert eligible_catalog_size() < 10000
    assert all(not card['id'].startswith('python.') for card in search_skills('Python concurrency review'))


@pytest.mark.asyncio
async def test_explicit_and_legacy_specialists_cannot_bypass_source_gate(source_store, monkeypatch):
    data, save = source_store
    for repository in data['repositories'].values(): repository['stars'] = 9999
    save(data)
    async def forbidden(**kwargs):
        pytest.fail('An ineligible recipe must never reach a model')
    monkeypatch.setattr(LLMGateway, 'complete', forbidden)
    fleet = ModelFleet()
    for args in ({'skill_id':'python.concurrency-review','task':'Check evidence'}, {'specialty':'review','task':'Check evidence'}):
        assert 'error' in await fleet.consult(args, 'bot')
    assert fleet.used == 0
    assert eligible_catalog_size() == 0 and search_skills('Python review') == []
    assert (await fleet.search({'query':'Python review'}, 'bot'))['catalog_size'] == 0


@pytest.mark.asyncio
async def test_primary_chat_continues_without_customer_setup_when_catalog_unavailable(workspace, source_store, monkeypatch):
    import litellm
    from app.db.tenancy import current_tenant_id
    from app.services.orchestrator import AgentOrchestrator
    from app.services.agent_skills import get_agent_skills
    data, save = source_store
    for repository in data['repositories'].values(): repository['archived'] = True
    save(data)
    client, sessions = workspace
    cid = await room(client, 'fallback-source-owner')
    bot = (await client.get('/api/bots', headers={'x-grokbot-user-id':'fallback-source-owner'})).json()[0]['id']
    incoming = (await client.post(f'/api/conversations/{cid}/messages', headers={'x-grokbot-user-id':'fallback-source-owner'},
        json={'sender_type':'user','content':'Summarize the supplied fact: revenue increased from 10 to 12.'})).json()
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        assert 'Do not ask the customer to install or configure internal agents' in kwargs['messages'][0]['content']
        return litellm.ModelResponse(choices=[{'message':{'role':'assistant','content':'Revenue increased by 20%.'}}])
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    token = current_tenant_id.set('fallback-source-owner')
    try:
        async with sessions() as db:
            profile = await get_agent_skills(db, bot)
            assert profile['skills'] == [] and profile['catalog_size'] == 0
            assert profile['availability'] == 'primary_agent_fallback'
        answer = await AgentOrchestrator().process_message(cid, 'Summarize the supplied fact: revenue increased from 10 to 12.',
            incoming_message_id=incoming['message_id'])
    finally:
        current_tenant_id.reset(token)
    assert len(calls) == 1 and answer[-1]['content'] == 'Revenue increased by 20%.'


def test_corrupt_manifest_and_wrong_types_fail_closed_without_crashing(source_store):
    data, save = source_store
    data['sources']['backend'] = ['not a reviewed record']
    save(data)
    assert get_skill('python.summary') is None
    save({'repositories':None})
    assert eligible_catalog_size() == 0


@pytest.mark.asyncio
async def test_cached_unreviewed_receipt_cannot_bypass_current_eligibility(monkeypatch):
    from types import SimpleNamespace
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        assert 'Reviewed upstream workflow:' in kwargs['messages'][0]['content']
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Checked evidence',tool_calls=None))], usage=None, _hidden_params={})
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    fleet = ModelFleet()
    args = {'specialty':'review','task':'Check supplied evidence'}
    first = await fleet.consult(args, 'bot')
    assert all(source['stars'] >= 10000 for source in first['sources'])
    cache_key = next(iter(fleet.results))
    fleet.results[cache_key]['sources'] = [{'url':'https://example.test/unreviewed'}]
    reused = await fleet.consult(args, 'bot')
    assert 'findings' not in reused and 'approved sources' in reused['error']
    assert len(calls) == 1


def test_catalog_search_is_local_and_model_receipts_are_compact(monkeypatch):
    import urllib.request
    from app.services.specialist_catalog import compact_skill_card
    def forbidden(*args, **kwargs):
        pytest.fail('Customer catalog lookup must not query GitHub')
    monkeypatch.setattr(urllib.request, 'urlopen', forbidden)
    card = get_skill('python.concurrency-review')
    compact = compact_skill_card(card)
    assert 'content_sha256' in card['sources'][0] and 'content_sha256' not in compact['sources'][0]
    assert len(json.dumps(compact)) < len(json.dumps(card))
    assert len(search_skills('Python concurrency review')) > 0
