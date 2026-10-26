"""Five competency recipes per full agent, without new tables or permissions.

The shared specialist catalog contains instructional profiles, not running
agents or executable tools. Automatic defaults are derived locally and never
misrepresented as a model's choice. An agent can persist its own five choices
through the registered tool; enabled tools and account grants remain separate.
"""
import hashlib

from sqlalchemy import select

from app.db.tenancy import current_tenant_id
from app.models.bot import Bot
from app.models.workspace import WorkspaceSetting
from app.services.specialist_catalog import compact_skill_card, eligible_catalog_size, fallback_skill_ids, get_skill, search_skills

SKILL_COUNT = 5
MAX_PROMPT_CHARS = 6000
_FALLBACK_IDS = (
    'general-work.execution-plan',
    'general-work.fact-check',
    'general-work.quality-review',
    'general-work.summary',
    'general-work.handoff-plan',
)


def _tenant():
    return current_tenant_id.get() or 'legacy-owner'


async def _owned_bot(db, bot_or_id):
    # Explicit ownership also protects callers that pass an ORM instance already
    # present in an unfiltered session's identity map.
    bot_id = str(getattr(bot_or_id, 'id', bot_or_id))
    bot = await db.scalar(select(Bot).where(
        Bot.id == bot_id, Bot.tenant_id == _tenant(), Bot.status != 'deleted',
    ).execution_options(populate_existing=True))
    if bot is None:
        raise ValueError('Agent not found in this workspace.')
    return bot


def _key(bot_id):
    # Tenant IDs may themselves be 255 characters. Hash only the namespace;
    # neither instructions nor user task text enter the settings key.
    namespace = hashlib.sha256(_tenant().encode()).hexdigest()
    return f'agent-skills:v1:{namespace}:{bot_id}'


def _validate_ids(skill_ids):
    if not isinstance(skill_ids, list) or len(skill_ids) != SKILL_COUNT:
        raise ValueError('Choose exactly five distinct skill IDs from the catalog.')
    if any(not isinstance(item, str) or get_skill(item) is None for item in skill_ids):
        raise ValueError('Use exact skill IDs returned by the skill catalog.')
    if len(set(skill_ids)) != SKILL_COUNT:
        raise ValueError('Choose five different skills; duplicate IDs are not allowed.')
    return list(skill_ids)


def _automatic_ids(bot):
    query = f'{bot.role or ""}\n{bot.system_prompt or ""}'[:2000]
    # A narrow query can return fewer than five combinations. Deterministic
    # general-work recipes fill the remainder without a model/provider call.
    candidates = [card['id'] for card in search_skills(query, limit=8)]
    eligible = [item for item in [*candidates, *_FALLBACK_IDS] if get_skill(item) is not None]
    selected = list(dict.fromkeys([*eligible, *fallback_skill_ids(10)]))[:SKILL_COUNT]
    return _validate_ids(selected) if len(selected) == SKILL_COUNT else []


def _profile(bot, ids, selected_by, persisted):
    return {
        'bot_id': str(bot.id),
        'skill_ids': list(ids),
        'skills': [get_skill(skill_id) for skill_id in ids],
        'selected_by': selected_by,
        'persisted': persisted,
        'selection_count': SKILL_COUNT,
        'catalog_size': eligible_catalog_size(),
        'permissions_unchanged': True,
    }


async def get_agent_skills(db, bot_or_id):
    """Return five skills for an owned live bot; reading defaults does not write."""
    bot = await _owned_bot(db, bot_or_id)
    row = await db.scalar(select(WorkspaceSetting).where(
        WorkspaceSetting.id == _key(bot.id), WorkspaceSetting.tenant_id == _tenant(),
    ).execution_options(populate_existing=True))
    value = row.value if row is not None and isinstance(row.value, dict) else {}
    if value.get('selected_by') in {'agent', 'owner'}:
        try:
            ids = _validate_ids(value.get('skill_ids'))
        except ValueError:
            pass  # Corrupt/retired selections recover to truthful automatic defaults.
        else:
            return _profile(bot, ids, value['selected_by'], True)
    ids = _automatic_ids(bot)
    if not ids:
        return {'bot_id': str(bot.id), 'skill_ids': [], 'skills': [], 'selected_by': 'automatic',
                'persisted': False, 'selection_count': 0, 'required_selection_count': SKILL_COUNT,
                'catalog_size': eligible_catalog_size(), 'permissions_unchanged': True,
                'availability': 'primary_agent_fallback'}
    return _profile(bot, ids, 'automatic', False)


async def select_agent_skills(db, bot_or_id, skill_ids, *, selected_by='agent'):
    """Persist one complete valid selection; concurrent updates cannot mix lists.

    Existing SQLite/PostgreSQL upserts serialize creation of the same namespaced
    row. Concurrent choices use last-completed-write semantics, not partial
    updates. This changes only agent-skill metadata, never tool permissions.
    """
    ids = _validate_ids(skill_ids)
    if selected_by not in {'agent', 'owner'}:
        raise ValueError('The selection must be made by the agent or its owner.')
    bot = await _owned_bot(db, bot_or_id)
    dialect = db.get_bind().dialect.name
    if dialect == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == 'sqlite':
        from sqlalchemy.dialects.sqlite import insert
    else:
        raise ValueError('Agent skill selection requires the configured PostgreSQL or SQLite store.')
    value = {'skill_ids': ids, 'selected_by': selected_by, 'version': 1}
    statement = insert(WorkspaceSetting).values(id=_key(bot.id), tenant_id=_tenant(), value=value)
    statement = statement.on_conflict_do_update(
        index_elements=['id'], set_={'value': value},
        where=WorkspaceSetting.tenant_id == _tenant(),
    )
    result = await db.execute(statement)
    if result.rowcount != 1:
        raise ValueError('Agent skills could not be saved in this workspace.')
    await db.commit()
    return _profile(bot, ids, selected_by, True)


def skill_prompt(profile, *, compact=False):
    """Bounded supplemental instructions; the bot's own system prompt stays intact."""
    if not profile:
        return ''
    if not profile.get('skills'):
        return '\nInternal skill recipes are unavailable. Complete the task with your own instructions, authorized tools and supplied evidence. Do not ask the customer to install or configure internal agents; never invent specialist findings.'
    automatic = profile.get('selected_by') == 'automatic'
    intro = (
        '\nYour five skill recipes (automatic initial choices, not a prior model decision). '
        'These are ready to use; do not delay customer work for skill setup. '
        'Use choose_agent_skills only for a useful, authorized change of all five; '
        'search_agent_skills can find exact IDs. '
        if automatic else
        '\nYour five selected skill recipes. Keep them when useful; use '
        'choose_agent_skills to replace all five when a different selection fits better. '
    )
    text = intro + (
        'These supplement your individual instructions. They are competency guidance, '
        'not completed work, external access, tools, or permission grants. Use only '
        'your enabled tools and authorized connected accounts for actual execution. '
        'You remain the full agent: references in a recipe to the main agent mean you, '
        'not a reason to defer work you can perform with your own authorized tools.\n'
    )
    if compact:
        # Keep all five choices visible without resending every generic recipe
        # on every turn. Full eligible guidance remains in both discovery tools
        # and the API; task_skill_prompt separately supplies relevant recipes.
        text += 'Ready profile directory (load guidance with search_agent_skills only when useful; no setup round is required):\n'
        text += '\n'.join(f"{card['id']}: {card['name']}" for card in profile['skills'])
    else:
        text += '\n'.join(f"{card['id']}: {card['instructions']}" for card in profile['skills'])
    return text[:MAX_PROMPT_CHARS]


async def prompt_for_bot(db, bot_id, *, compact=False):
    return skill_prompt(await get_agent_skills(db, bot_id), compact=compact)


def register_agent_skill_tools(registry, session_factory):
    """Register catalog discovery and a trusted-self-only selection tool."""
    async def search(arguments, bot_id):
        query = arguments.get('query')
        if not isinstance(query, str) or not query.strip():
            return {'error': 'Describe the skills you need to find.'}
        return {
            'skills': [compact_skill_card(card) for card in search_skills(query[:2000], limit=5)],
            'catalog_size': eligible_catalog_size(),
            'selection_count': SKILL_COUNT,
            'instruction': 'Choose exactly five distinct IDs with choose_agent_skills. Skills do not grant tools or account access.',
        }

    async def choose(arguments, bot_id):
        try:
            if set(arguments) - {'skill_ids'}:
                raise ValueError('Choose skills only for yourself; supply skill_ids without another agent ID.')
            async with session_factory() as db:
                profile = await select_agent_skills(db, bot_id, arguments.get('skill_ids'))
                return {key: value for key, value in profile.items() if key != 'skills'}
        except ValueError as error:
            return {'error': str(error)}

    registry.register(
        'search_agent_skills',
        'Find instructional skills in the local catalog. Returns exact IDs, not executable tools or account grants.',
        {'type': 'object', 'properties': {'query': {'type': 'string', 'minLength': 1, 'maxLength': 2000}},
         'required': ['query'], 'additionalProperties': False}, search,
    )
    registry.register(
        'choose_agent_skills',
        'Choose and remember exactly five distinct catalog skills for yourself. Replaces your previous selection only; never changes tools or account access.',
        {'type': 'object', 'properties': {'skill_ids': {'type': 'array', 'items': {'type': 'string', 'maxLength': 120},
         'minItems': SKILL_COUNT, 'maxItems': SKILL_COUNT, 'uniqueItems': True}},
         'required': ['skill_ids'], 'additionalProperties': False}, choose,
    )
