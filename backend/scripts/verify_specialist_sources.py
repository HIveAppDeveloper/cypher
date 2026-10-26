"""Release-time source eligibility verification; never run in a customer turn.

Default is offline. --check-live additionally checks public GitHub metadata.
--refresh-stars updates only repository star/archive snapshots after all reads
succeed. It never changes pinned commits, source text, reviews or model routes.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import specialist_sources as sources
from app.services.specialist_catalog import DOMAINS, PROCEDURES, eligible_catalog_size


def fetch_repository(repo):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid reviewed repository name')
    request = Request('https://api.github.com/repos/'+repo,
                      headers={'Accept':'application/vnd.github+json', 'User-Agent':'Cypher-source-release-check'})
    with urlopen(request, timeout=15) as response:
        data = json.loads(response.read(1024*1024))
    if data.get('full_name', '').casefold() != repo.casefold():
        raise ValueError('Repository identity changed; review required')
    stars = data.get('stargazers_count')
    if not isinstance(stars, int) or isinstance(stars, bool):
        raise ValueError('GitHub star metadata unavailable')
    return repo, {'stars':stars, 'archived':data.get('archived')}


def verify_structure():
    data = sources.manifest()
    if set(data.get('domain_sources', {})) != {item.id for item in DOMAINS}:
        raise ValueError('Every domain needs a reviewed source mapping')
    if set(data.get('procedure_sources', {})) != {item.id for item in PROCEDURES}:
        raise ValueError('Every procedure needs a reviewed source mapping')
    if eligible_catalog_size() != 10000:
        raise ValueError('Fewer than 10000 profiles currently satisfy the reviewed-source policy')
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-live', action='store_true')
    parser.add_argument('--refresh-stars', action='store_true')
    args = parser.parse_args(argv)
    try:
        data = sources.manifest()
        if args.check_live or args.refresh_stars:
            repos = list(data['repositories'])
            with ThreadPoolExecutor(max_workers=4) as pool:
                observations = dict(pool.map(fetch_repository, repos))
            if any(item['stars'] < sources.MINIMUM_STARS or item['archived'] is not False for item in observations.values()):
                raise ValueError('A reviewed upstream repository no longer meets the star/archive requirement')
            if args.refresh_stars:
                for repo, values in observations.items():
                    data['repositories'][repo].update(values)
                data['checked_at'] = datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
                sources.MANIFEST_PATH.write_text(json.dumps(data,indent=2)+'\n')
                sources.clear_source_caches()
        data = verify_structure()
        print(json.dumps({'eligible_profiles':eligible_catalog_size(), 'minimum_repository_stars':sources.MINIMUM_STARS,
                          'checked_at':data['checked_at'], 'reviewed_source_files':len(data['sources']),
                          'repositories':[{key:repo[key] for key in ('full_name','stars','license','sha')}
                                          for repo in data['repositories'].values()],
                          'mode':'live_metadata_checked' if args.check_live or args.refresh_stars else 'offline_snapshot_check'}, indent=2))
        return 0
    except Exception as error:
        # No credentials, source content, response bodies or URLs in failures.
        print(json.dumps({'eligible':False,'error_type':type(error).__name__,
                          'message':'Source eligibility verification failed. Review upstream metadata and pinned mappings before publishing.'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
