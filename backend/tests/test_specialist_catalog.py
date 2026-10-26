from app.services.specialist_catalog import (
    CATALOG_SIZE, DOMAINS, PROCEDURES, get_skill, search_skills, task_skill_prompt,
)


def test_ten_thousand_distinct_profiles_are_valid_and_lazy():
    assert len(DOMAINS) == len(PROCEDURES) == 100
    profiles = [get_skill(domain.id+'.'+procedure.id) for domain in DOMAINS for procedure in PROCEDURES]
    assert CATALOG_SIZE == len({p['id'] for p in profiles}) == len({p['instructions'] for p in profiles}) == 10000
    assert all(p['mode'] == 'tool_free_advice' and len(p['instructions']) < 1200 for p in profiles)
    assert get_skill('unknown.summary') is None
    assert get_skill('../../secret') is None
    assert get_skill(None) is None


def test_retrieval_finds_specific_recipes_and_does_not_echo_prompt_data():
    for query, expected in [
        ('Python concurrency race review', 'python.concurrency-review'),
        ('postgres database migration plan', 'databases.migration-plan'),
        ('email rewrite', 'email-writing.rewrite'),
        ('budget cost review', 'budgeting.cost-review'),
    ]:
        assert expected in [p['id'] for p in search_skills(query)]
    assert search_skills('zxyq987654') == []
    assert search_skills('') == []
    assert len(search_skills('Python review', 10000)) == 8
    prompt = task_skill_prompt('Python concurrency race review PRIVATE-PROMPT-CONTENT')
    assert 'python.concurrency-review' in prompt
    assert 'PRIVATE-PROMPT-CONTENT' not in prompt
    assert len(prompt) <= 2400
    assert task_skill_prompt('Hello') == ''


def test_skill_search_does_not_grow_the_model_tool_list():
    from types import SimpleNamespace
    from app.services.fleet import ModelFleet
    from app.services.tools.registry import ToolRegistry
    registry = ToolRegistry()
    ModelFleet().register(registry)
    definitions = registry.get_tools_for_bot(SimpleNamespace(tools_enabled=['browser']))
    assert {t['function']['name'] for t in definitions} == {
        'consult_specialist', 'consult_specialists', 'search_specialist_skills'}
    assert all(registry.replay_safe(t['function']['name'], {}) for t in definitions)
    import jsonschema
    for tool in definitions:
        jsonschema.Draft202012Validator.check_schema(tool['function']['parameters'])


def test_automatic_full_recipes_require_a_named_domain_but_discovery_stays_broad():
    arithmetic = 'Report revenue and profit growth: Q1 revenue 100 cost 80; Q2 revenue 120 cost 90.'
    assert any(card['id'].startswith('cost-optimization.') for card in search_skills(arithmetic))
    assert task_skill_prompt(arithmetic) == ''
    assert task_skill_prompt('Python') == ''
    assert 'python.concurrency-review' in task_skill_prompt('Python concurrency race review')
    assert 'cost-optimization.cost-review' in task_skill_prompt('Review cost optimization savings')
