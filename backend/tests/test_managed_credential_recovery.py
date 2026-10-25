"""Managed account matching remains isolated from damaged neighboring rows."""
from types import SimpleNamespace

from cryptography.fernet import InvalidToken
import pytest

from app.config import settings
from app.models.plugin import Plugin, PluginAuthorization
from app.services import managed_connections as managed
from app.services.plugins import reveal, seal


class SavedRows:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class LocalSession:
    """Only the row-matching/save operations under test; no database or network."""
    def __init__(self, rows):
        self.rows = rows
        self.statements = []
        self.added = []
        self.commits = 0

    async def execute(self, statement):
        self.statements.append(statement)
        return SavedRows(self.rows)

    async def get(self, model, identity):
        return None

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        pass

    async def commit(self):
        self.commits += 1


@pytest.fixture
def synthetic_key(monkeypatch):
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'synthetic-managed-reference-key-over-thirty-two')


@pytest.mark.asyncio
async def test_managed_save_skips_damaged_neighbor_and_updates_exact_account(synthetic_key, monkeypatch):
    url = 'https://provider.example/mcp'
    damaged = Plugin(id='damaged', name='Preserve this account', url=url,
                     credential='not-a-valid-fernet-token', enabled=False,
                     tools=[{'name': 'private_tool', 'enabled': False}])
    other = Plugin(id='other', name='Other managed account', url=url,
                   credential=seal('grokbot-connect:other'), enabled=True, tools=[])
    healthy = Plugin(id='healthy', name='Old name', url=url,
                     credential=seal('grokbot-connect:target'), enabled=True,
                     tools=[{'name': 'read', 'enabled': False}])
    session = LocalSession([damaged, other, healthy])
    original_damaged = (damaged.name, damaged.credential, damaged.enabled, damaged.tools.copy())
    original_other = (other.name, other.credential, other.enabled, other.tools.copy())
    calls = []

    async def discovery(endpoint, access):
        calls.append((endpoint, access))
        return [{'name': 'read', 'description': 'Read records', 'schema': {}, 'read_only': True},
                {'name': 'list', 'description': 'List records', 'schema': {}, 'read_only': True}]

    monkeypatch.setattr(managed, 'discover', discovery)
    row = PluginAuthorization(id='new-flow', name='Target account', url=url,
                              plugin_id=None, status='discovering')
    result = await managed.save_connection(session, row, {'id': 'target'}, 'synthetic-access')

    assert result['plugin_id'] == 'healthy'
    assert session.added == []  # Never create a duplicate healthy connection.
    assert calls == [(url, 'synthetic-access')]
    assert (damaged.name, damaged.credential, damaged.enabled, damaged.tools) == original_damaged
    assert (other.name, other.credential, other.enabled, other.tools) == original_other
    assert healthy.name == 'Target account'
    assert reveal(healthy.credential) == 'grokbot-connect:target'
    assert [tool['enabled'] for tool in healthy.tools] == [False, True]
    assert row.plugin_id == 'healthy' and row.status == 'connected'
    assert session.commits == 1
    assert session.statements[0].compile().params['url_1'] == url
    assert session.statements[1].compile().params['plugin_id_1'] == 'healthy'


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [InvalidToken(), ValueError('unreadable synthetic value')])
async def test_matching_skips_only_unreadable_rows_without_matching_another_account(monkeypatch, failure):
    damaged = SimpleNamespace(credential='broken')
    other = SimpleNamespace(credential='grokbot-connect:other')
    session = LocalSession([damaged, other])

    def decrypt(value):
        if value == 'broken':
            raise failure
        return value

    monkeypatch.setattr(managed, 'reveal', decrypt)
    assert await managed.matching_connection(session, 'https://provider.example/mcp', {'id': 'target'}) is None
    assert session.added == [] and session.commits == 0


@pytest.mark.asyncio
async def test_matching_does_not_swallow_system_or_database_failures(monkeypatch):
    session = LocalSession([SimpleNamespace(credential='saved')])

    def decrypt(value):
        raise RuntimeError('synthetic system failure')

    monkeypatch.setattr(managed, 'reveal', decrypt)
    with pytest.raises(RuntimeError, match='synthetic system failure'):
        await managed.matching_connection(session, 'https://provider.example/mcp', {'id': 'target'})

    async def failed_query(statement):
        raise RuntimeError('synthetic database failure')

    monkeypatch.setattr(session, 'execute', failed_query)
    with pytest.raises(RuntimeError, match='synthetic database failure'):
        await managed.matching_connection(session, 'https://provider.example/mcp', {'id': 'target'})
