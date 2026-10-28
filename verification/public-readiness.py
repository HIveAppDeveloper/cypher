"""Strict public-only HTTP acceptance. Every run writes a fresh report, including failures."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

PUBLIC_PATHS = ['/', '/about', '/contact', '/privacy', '/docs', '/docs/api', '/docs/auth', '/docs/mcp']
RSC_TOKENS = {'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch'}


def vary_tokens(value):
    return {part.strip().lower() for part in (value or '').split(',') if part.strip()}


def vary_header(headers):
    return ', '.join(headers.get_all('Vary') or [])


def protection_headers(value):
    if not isinstance(value, dict) or len(value) != 1:
        raise ValueError('Use one deployment-protection header only.')
    name, content = next(iter(value.items()))
    if not isinstance(name, str) or not isinstance(content, str) or not content or re.search(r'[\x00-\x20\x7f]', content) and name.lower() != 'cookie':
        raise ValueError('Invalid deployment-protection header.')
    if re.search(r'[\x00-\x1f\x7f]', content):
        raise ValueError('Control characters are not permitted in protection headers.')
    if name.lower() == 'x-vercel-protection-bypass':
        return {'x-vercel-protection-bypass': content}
    if name.lower() != 'cookie':
        raise ValueError('Only deployment-protection headers are permitted.')
    cookies, seen = [], set()
    for pair in content.split(';'):
        if '=' not in pair:
            raise ValueError('Invalid deployment-protection cookie pair.')
        key, item = pair.strip().split('=', 1)
        if not re.fullmatch(r"_vercel[!#$%&'*+\-.^_`|~0-9A-Za-z]*", key) or key in seen or not re.fullmatch(r'[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*', item):
            raise ValueError('Only valid, distinct _vercel-prefixed cookies are permitted.')
        cookies.append(key + '=' + item)
        seen.add(key)
    return {'Cookie': '; '.join(cookies)}


def normalized_url(value):
    url = urllib.parse.urlsplit(value)
    return url.scheme.lower(), url.netloc.lower(), url.path or '/', url.query, url.fragment


class HTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text, self.meta, self.links, self.headings = [], {}, [], []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.headings.append(int(tag[1]))
        if tag == 'meta':
            self.meta[attrs.get('property') or attrs.get('name') or attrs.get('http-equiv')] = attrs.get('content')
        if tag == 'link':
            self.links.append(attrs)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, text):
        if not self.skip:
            self.text.append(text)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a deployment-protection header to another origin.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:3196')
    parser.add_argument('--canonical', default='https://cypher-agent.vercel.app')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--protection-headers-file', type=Path, help='Optional private JSON with x-vercel-protection-bypass OR Cookie containing only _vercel-prefixed cookies. Never printed or forwarded across redirects.')
    args = parser.parse_args()
    base = urllib.parse.urlsplit(args.base)
    if base.scheme not in ('http', 'https') or not base.netloc or base.username or base.password or base.path not in ('', '/') or base.query or base.fragment:
        parser.error('--base must be an HTTP(S) origin without credentials, query, or path')
    headers = {}
    if args.protection_headers_file:
        try:
            headers = protection_headers(json.loads(args.protection_headers_file.read_text()))
        except (ValueError, TypeError):
            parser.error('protection header file must contain one valid deployment-protection header; app sessions and authorization are not permitted')
    origin = args.base.rstrip('/')
    canonical = args.canonical.rstrip('/')
    opener = urllib.request.build_opener(NoRedirect())
    report = {'status': 'running', 'base': origin, 'started_at': datetime.now(timezone.utc).isoformat(), 'requests': [], 'failures': []}
    try:
        report['source_commit'] = subprocess.check_output(['git', '-C', str(Path(__file__).resolve().parents[1]), 'rev-parse', 'HEAD'], text=True).strip()
        for path, accept, method in (
            [(path, accept, 'GET') for path in PUBLIC_PATHS for accept in ('text/html', 'text/markdown')]
            + [(('/index.md' if path == '/' else '/docs/index.md' if path == '/docs' else path + '.md'), 'text/html', 'GET') for path in PUBLIC_PATHS]
            + [('/__readiness-missing-20261028', accept, 'GET') for accept in ('text/html', 'text/markdown')]
            + [(path, '*/*', 'GET') for path in ('/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap.xml', '/openapi.json', '/.well-known/mcp', '/server.json', '/cipher-logo.png')]
            + [('/', 'text/markdown', 'HEAD')]
        ):
            row = {'path': path, 'accept': accept, 'method': method, 'failures': []}
            report['requests'].append(row)

            def check(condition, message):
                if not condition:
                    row['failures'].append(message)
                    report['failures'].append({'path': path, 'accept': accept, 'method': method, 'issue': message})

            try:
                req = urllib.request.Request(origin + path, method=method, headers={**headers, 'Accept': accept})
                try:
                    response = opener.open(req, timeout=15)
                except urllib.error.HTTPError as error:
                    response = error
                data = response.read(2_000_001)
                content_type = response.headers.get('Content-Type', '')
                row.update(status=response.status, content_type=content_type, vary=vary_header(response.headers), vercel_id=response.headers.get('x-vercel-id'), bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                check(len(data) <= 2_000_000, 'response_size')
                text = data.decode('utf-8', 'replace')
                tokens = vary_tokens(row['vary'])
                missing = path.startswith('/__readiness-missing-')
                check(response.status == (404 if missing else 200), 'status')
                if missing:
                    check(accept in content_type, '404_content_type')
                    check('/docs' in text and len(text) > 20, '404_recovery')
                    check('accept' in tokens, '404_vary_accept')
                elif path in PUBLIC_PATHS:
                    check(accept in content_type, 'document_content_type')
                    check('accept' in tokens, 'html_vary_accept' if accept == 'text/html' else 'markdown_vary_accept')
                    if method == 'HEAD':
                        check(not data, 'head_body_empty')
                    elif accept == 'text/markdown':
                        check(text.startswith('# ') and len(text) > 500, 'markdown_content')
                    else:
                        html = HTML()
                        html.feed(text)
                        row['text_characters'] = len(' '.join(html.text).strip())
                        check(row['text_characters'] > 500, 'raw_html_content')
                        check(html.headings.count(1) == 1 and all(b <= a + 1 for a, b in zip(html.headings, html.headings[1:])), 'heading_sequence')
                        check('refresh' not in html.meta, 'no_meta_refresh')
                        check(any(link.get('rel') == 'canonical' and normalized_url(link.get('href', '')) == normalized_url(canonical + path) for link in html.links), 'canonical')
                        check(html.meta.get('og:type') == 'website' and html.meta.get('og:image', '').endswith('/cipher-logo.png'), 'open_graph')
                        check('noindex' not in html.meta.get('robots', ''), 'public_indexable')
                        check(RSC_TOKENS.issubset(tokens), 'framework_vary_tokens')
                elif path.endswith('.md'):
                    check(content_type.startswith('text/markdown') and text.startswith('# ') and len(text) > 500, 'markdown_alias')
                elif path == '/sitemap.xml':
                    xml = ET.fromstring(text)
                    entries = list(xml)
                    check(len(entries) == len(PUBLIC_PATHS) and '/api/' not in text and all(entry.find('{http://www.sitemaps.org/schemas/sitemap/0.9}lastmod') is not None for entry in entries), 'sitemap')
                elif path == '/openapi.json':
                    spec = json.loads(text)
                    check(spec.get('openapi') == '3.1.0' and '/mcp' in spec.get('paths', {}) and not any(key.startswith('/api/') for key in spec['paths']), 'public_openapi')
                elif path in ('/.well-known/mcp', '/server.json'):
                    manifest = json.loads(text)
                    check(manifest['remotes'] == [{'type': 'streamable-http', 'url': canonical + '/mcp'}], 'manifest_endpoint')
                elif path == '/cipher-logo.png':
                    check(content_type.startswith('image/png') and len(data) > 0, 'original_logo')
                elif path == '/llms.txt':
                    check('## When to use Cypher' in text and '/docs/auth.md' in text, 'agent_guidance')
                else:
                    check(len(text) > 100, 'machine_readable_content')
            except Exception as error:
                check(False, 'request_or_parse_error:' + type(error).__name__)
        report['status'] = 'failed' if report['failures'] else 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['failures'].append({'issue': 'verification_error:' + type(error).__name__})
    finally:
        report['completed_at'] = datetime.now(timezone.utc).isoformat()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'requests': len(report['requests']), 'failures': len(report['failures']), 'report': str(args.report)}))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
