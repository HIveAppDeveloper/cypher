"""Read and seed the packaged, tested MCP Registry directory snapshot."""

import gzip
import json
import time
from functools import lru_cache
from pathlib import Path
from datetime import datetime, timezone

from sqlalchemy import delete, func, select

from app.models.mcp_directory import McpDirectoryEntry

SNAPSHOT_PATH = Path(__file__).parents[1] / 'data' / 'mcp_directory.json.gz'
PREVIEW_TTL_SECONDS = 180
_preview_cache = {}


@lru_cache(maxsize=1)
def read_snapshot():
    if not SNAPSHOT_PATH.exists():
        return {'entries': [], 'source': 'https://registry.modelcontextprotocol.io/'}
    with gzip.open(SNAPSHOT_PATH, 'rt', encoding='utf-8') as handle:
        snapshot = json.load(handle)
    return snapshot if isinstance(snapshot, dict) and isinstance(snapshot.get('entries'), list) else {'entries': []}


async def seed_directory_rows(connection):
    """Seed or refresh the shared index from the versioned, tested snapshot."""
    snapshot = read_snapshot()
    rows = snapshot['entries']
    if not rows:
        return 0
    table = McpDirectoryEntry.__table__
    fetched_at = snapshot.get('fetched_at')
    try:
        snapshot_at = datetime.fromisoformat(fetched_at.replace('Z', '+00:00')).replace(tzinfo=None)
    except (AttributeError, ValueError):
        snapshot_at = datetime.now(timezone.utc).replace(tzinfo=None)
    latest = await connection.scalar(select(func.max(table.c.snapshot_at)))
    if latest and latest >= snapshot_at:
        return 0
    columns = {column.name for column in table.columns}
    values = []
    for row in rows:
        value = {key: item for key, item in row.items() if key in columns}
        value['snapshot_at'] = snapshot_at
        value.setdefault('domains', [])
        for field in ('registry_updated_at', 'tested_at'):
            stamp = value.get(field)
            if isinstance(stamp, str):
                try:
                    value[field] = datetime.fromisoformat(stamp.replace('Z', '+00:00')).replace(tzinfo=None)
                except ValueError:
                    value[field] = None
        values.append(value)
    if connection.dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    elif connection.dialect.name == 'sqlite':
        from sqlalchemy.dialects.sqlite import insert
    else:
        insert = None
    for offset in range(0, len(values), 500):
        batch = values[offset:offset + 500]
        if insert:
            statement = insert(table).values(batch)
            updates = {column.name: getattr(statement.excluded, column.name) for column in table.columns if column.name != 'id'}
            await connection.execute(statement.on_conflict_do_update(index_elements=[table.c.id], set_=updates))
        else:
            await connection.execute(table.insert(), batch)
    await connection.execute(delete(table).where(table.c.snapshot_at < snapshot_at))
    return len(values)


def directory_snapshot_info():
    snapshot = read_snapshot()
    return {
        'source': snapshot.get('source', 'https://registry.modelcontextprotocol.io/'),
        'fetched_at': snapshot.get('fetched_at'),
        'count': len(snapshot['entries']),
    }


async def preview_directory_tools(entry):
    """List a few live tool names without executing any MCP tool."""
    if not entry.url:
        return {'status': 'needs_endpoint', 'message': 'This listing does not publish a hosted MCP endpoint.', 'tools': [], 'tool_count': 0}
    if entry.test_status == 'auth_required':
        return {'status': 'auth_required', 'message': 'Sign in to this service to see its available tools.', 'tools': [], 'tool_count': None}
    if entry.test_status != 'protocol_verified':
        return {'status': 'unavailable', 'message': entry.test_message or 'This endpoint has not passed the read-only MCP check.', 'tools': [], 'tool_count': entry.tool_count}

    now = time.monotonic()
    cached = _preview_cache.get(entry.id)
    if cached and now - cached[0] < PREVIEW_TTL_SECONDS:
        return cached[1]

    from app.services.plugins import authentication_failure, discover

    try:
        tools = await discover(entry.url)
    except Exception as error:
        if authentication_failure(error):
            return {'status': 'auth_required', 'message': 'Sign in to this service to see its available tools.', 'tools': [], 'tool_count': None}
        return {'status': 'unavailable', 'message': 'Cypher could not load the tool preview. You can retry or connect the server.', 'tools': [], 'tool_count': None}

    result = {
        'status': 'ready',
        'message': '',
        'tool_count': len(tools),
        'tools': [
            {'name': tool['name'][:120], 'description': tool.get('description', '')[:240], 'read_only': bool(tool.get('read_only'))}
            for tool in tools[:5]
        ],
    }
    _preview_cache[entry.id] = (now, result)
    if len(_preview_cache) > 512:
        oldest = sorted(_preview_cache, key=lambda key: _preview_cache[key][0])[:128]
        for key in oldest:
            _preview_cache.pop(key, None)
    return result
