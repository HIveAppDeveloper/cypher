"""Reviewed GitHub provenance; runtime is local and never executes upstream code."""
from datetime import datetime, timezone
from functools import lru_cache
import json
from pathlib import Path
import re
from time import time

MINIMUM_STARS = 10000
MAX_SNAPSHOT_DAYS = 30
ALLOWED_LICENSES = {'MIT', 'Apache-2.0'}
MANIFEST_PATH = Path(__file__).with_name('data') / 'specialist_sources.json'


@lru_cache(maxsize=1)
def manifest():
    try:
        data = json.loads(MANIFEST_PATH.read_text())
        return data if (isinstance(data, dict) and all(isinstance(data.get(key), dict) for key in
                       ('repositories', 'sources', 'domain_sources', 'procedure_sources'))) else {}
    except (OSError, ValueError):
        return {}


def _checked_at(value):
    try:
        observed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return observed.astimezone(timezone.utc) if observed.tzinfo else None
    except (AttributeError, TypeError, ValueError):
        return None


def source_is_eligible(source, repository, checked_at, *, now=None):
    """Star counts are dated evidence, not a quality or performance guarantee."""
    if not isinstance(source, dict) or not isinstance(repository, dict):
        return False
    stars = repository.get('stars')
    repo = repository.get('full_name')
    commit, path = source.get('commit'), source.get('path')
    observed = _checked_at(checked_at)
    now = now or datetime.now(timezone.utc)
    age = (now-observed).total_seconds() if observed else None
    return bool(
        isinstance(stars, int) and not isinstance(stars, bool) and stars >= MINIMUM_STARS
        and repository.get('archived') is False and isinstance(repository.get('license'), str)
        and repository['license'] in ALLOWED_LICENSES
        and isinstance(repo, str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo)
        and source.get('repository') == repo and source.get('reviewed') is True
        and isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit)
        and repository.get('sha') == commit
        and repository.get('license_url') == f'https://github.com/{repo}/blob/{commit}/LICENSE'
        and re.fullmatch(r'[0-9a-f]{40}', str(repository.get('license_blob_sha', '')))
        and re.fullmatch(r'[0-9a-f]{64}', str(repository.get('license_sha256', '')))
        and isinstance(path, str) and path.endswith('.md') and not path.startswith('/')
        and all(part not in {'', '.', '..'} for part in path.split('/')) and '\\' not in path
        and source.get('url') == f'https://github.com/{repo}/blob/{commit}/{path}'
        and re.fullmatch(r'[0-9a-f]{40}', str(source.get('blob_sha', '')))
        and re.fullmatch(r'[0-9a-f]{64}', str(source.get('content_sha256', '')))
        and isinstance(source.get('guidance'), str) and 30 <= len(source['guidance']) <= 240
        and _checked_at(source.get('reviewed_at')) is not None
        and age is not None and -300 <= age <= MAX_SNAPSHOT_DAYS*86400
    )


@lru_cache(maxsize=2)
def _eligible_sources(minute):
    data = manifest()
    now = datetime.fromtimestamp(minute*60, timezone.utc)
    return frozenset(key for key, source in data.get('sources', {}).items()
                     if isinstance(source, dict) and source_is_eligible(source, data.get('repositories', {}).get(source.get('repository')),
                                           data.get('checked_at'), now=now))


def source_for(axis, item_id):
    data = manifest()
    mapping = data.get(axis+'_sources', {}).get(item_id)
    if not isinstance(mapping, dict) or mapping.get('scope') != 'workflow_adaptation':
        return None
    key = mapping.get('source_id')
    if not isinstance(key, str) or key not in _eligible_sources(int(time()//60)):
        return None
    source = data['sources'][key]
    repository = data['repositories'][source['repository']]
    return {
        'repository': source['repository'], 'url': source['url'],
        'commit': source['commit'], 'path': source['path'],
        'stars': repository['stars'], 'checked_at': data['checked_at'],
        'license': repository['license'], 'blob_sha': source['blob_sha'],
        'content_sha256': source['content_sha256'], 'adaptation_scope': mapping['scope'],
        'guidance': source['guidance'],
    }


def clear_source_caches():
    manifest.cache_clear()
    _eligible_sources.cache_clear()
