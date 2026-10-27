#!/usr/bin/env python3
"""Cypher self-host setup. Generates a private configuration; never migrates cloud data."""
import argparse
import getpass
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

REPOSITORY = 'https://github.com/HIveAppDeveloper/cypher.git'

COMPOSE = '''name: ${CYPHER_PROJECT_NAME}
services:
  backend:
    build: ./source/backend
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: [CMD, python, -c, "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5)"]
      interval: 15s
      timeout: 8s
      start_period: 60s
      retries: 10
  worker:
    build: ./source/backend
    env_file: .env
    command: [python, -m, app.worker_main]
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
  frontend:
    build:
      context: ./source/frontend
      args:
        NEXT_PUBLIC_SELF_HOSTED_ORIGIN: ${GROKBOT_PUBLIC_URL}
    environment:
      BACKEND_INTERNAL_URL: http://backend:8000
      GROKBOT_BACKEND_API_TOKEN: ${BACKEND_API_TOKEN}
      AUTH_SESSION_SECRET: ${AUTH_SESSION_SECRET}
      REQUIRE_USER_AUTH: ${REQUIRE_USER_AUTH}
      GROKBOT_PUBLIC_URL: ${GROKBOT_PUBLIC_URL}
    ports: ["127.0.0.1:3000:3000"]
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
  https:
    image: caddy:2-alpine
    profiles: [cloud]
    environment:
      CYPHER_DOMAIN: ${CYPHER_DOMAIN}
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [frontend]
    restart: unless-stopped
volumes:
  caddy-data:
  caddy-config:
'''

def https_origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.port not in (None, 443):
        raise ValueError('Enter an HTTPS origin, for example https://models.example.com.')
    if parsed.hostname in ('localhost', '127.0.0.1'):
        raise ValueError('Use local mode for a computer-only installation.')
    if not re.fullmatch(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', parsed.hostname):
        raise ValueError('Use a DNS hostname for HTTPS.')
    return 'https://' + parsed.hostname

def database_url(value):
    parsed = urlsplit(value)
    if parsed.scheme not in ('postgres', 'postgresql', 'postgresql+asyncpg') or not parsed.hostname or not parsed.username or not parsed.password or not parsed.path.strip('/'):
        raise ValueError('Use the direct PostgreSQL connection URL from a database you control; Prisma Accelerate URLs are not PostgreSQL URLs.')
    return value

def env_value(value):
    if any(char in value for char in '\r\n\x00'):
        raise ValueError('Configuration values cannot contain line breaks.')
    return "'" + value.replace("'", "\\'") + "'"

def configuration(target, origin, database, gateway, gateway_key, owner='', mail_key='', sender=''):
    cloud = target != 'local'
    origin = https_origin(origin) if cloud else 'http://localhost:3000'
    database_url(database)
    gateway = https_origin(gateway)
    if not gateway_key or any(char.isspace() for char in gateway_key):
        raise ValueError('Enter a nonempty gateway inference key without whitespace.')
    if cloud and (not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', owner) or not mail_key or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', sender)):
        raise ValueError('Cloud hosting requires your email address, Resend key, and a verified sender email.')
    installation = secrets.token_hex(6)
    return {
        'CYPHER_PROJECT_NAME': 'cypher-' + installation,
        'GROKBOT_PUBLIC_URL': origin, 'CYPHER_DOMAIN': urlsplit(origin).hostname,
        'GROKBOT_DATABASE_URL': database, 'DATABASE_SCHEMA': 'cypher_' + installation,
        'BACKEND_API_TOKEN': secrets.token_urlsafe(48),
        'AUTH_SESSION_SECRET': secrets.token_urlsafe(48), 'SECRET_KEY': secrets.token_urlsafe(48),
        'REQUIRE_USER_AUTH': 'true' if cloud else 'false', 'CORS_ORIGINS': origin,
        'OMNIROUTE_URL': gateway + '/v1', 'OMNIROUTE_API_KEY': gateway_key,
        'LEGACY_OWNER_EMAIL': owner.lower(), 'GROKBOT_RESEND_API_KEY': mail_key,
        'GROKBOT_AUTH_FROM': sender, 'REDIS_URL': '', 'SANDBOX_BACKEND': 'docker',
    }

def write_configuration(directory, values):
    # Never overwrite another checkout or an existing secret file.
    directory = Path(directory)
    directory.mkdir(mode=0o700)
    os.chmod(directory, 0o700)
    fd = os.open(directory / '.env', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write('\n'.join(key+'='+env_value(value) for key, value in values.items())+'\n')
    (directory / 'compose.yaml').write_text(COMPOSE)
    (directory / 'Caddyfile').write_text('{$CYPHER_DOMAIN} {\n  reverse_proxy frontend:3000\n}\n')
    (directory / '.gitignore').write_text('.env\nsource/\n')
    (directory / 'README.txt').write_text(
        'Cypher self-host installation\n\n'
        'Your existing cloud database and accounts are not copied or changed.\n'
        'Use a dedicated PostgreSQL database for this installation. The app creates\n'
        'its own uniquely named schema on startup. Back up your database.\n\n'
        'Cloud: point your domain at this machine; allow HTTP 80 and HTTPS 443.\n'
        'The API and worker have no public port; local mode binds only localhost.\n'
        'Cloud sign-in uses your own Resend key and verified sender.\n'
        'Email delivery and model access must be verified after installation.\n\n'
        'Review: docker compose config --quiet\n'
        'Local start: docker compose up -d --build\n'
        'Cloud start: docker compose --profile cloud up -d --build\n'
        'Logs: docker compose logs --tail 100\n'
        'Stop: docker compose --profile cloud down\n\n'
        'The .env contains secrets. Do not share it.\n'
        'No Docker socket is granted. Agent-managed Docker computers need a\n'
        'separate operator-reviewed sandbox setup; ordinary model tasks work\n'
        'through your configured gateway. Add provider accounts in the app only\n'
        'when this installed release supports their connection methods.\n')

def ask(prompt, validate=None, hidden=False):
    while True:
        value = (getpass.getpass(prompt) if hidden else input(prompt)).strip()
        try:
            return validate(value) if validate else value
        except (ValueError, TypeError):
            # Do not echo validation errors that could contain a credential.
            print('That value could not be used. Check the requested format and try again.')

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=['local', 'aws', 'azure'], default='local')
    parser.add_argument('--directory', default='cypher-selfhost')
    args = parser.parse_args(argv)
    if not shutil.which('docker') or not shutil.which('git'):
        parser.error('Install Docker (with Compose) and Git, then run this setup again. Nothing was created.')
    try:
        subprocess.run(['docker', 'compose', 'version'], check=True, stdout=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        parser.error('Docker Compose is required. Nothing was created.')
    destination = Path(args.directory).resolve()
    if destination.exists():
        parser.error('Choose a new empty installation directory. Existing files were not changed.')
    print('Cypher self-host setup — '+args.target)
    print('Uses your own PostgreSQL and model gateway. No cloud data is migrated.')
    print('Cloud machines and provider requests may incur charges in your account.')
    origin = 'http://localhost:3000' if args.target == 'local' else ask('Your app HTTPS origin: ', https_origin)
    database = ask('Dedicated PostgreSQL URL (hidden): ', database_url, hidden=True)
    gateway = ask('Gateway HTTPS origin, without /v1: ', https_origin)
    key = ask('Gateway inference key (hidden): ', hidden=True)
    owner = mail_key = sender = ''
    if args.target != 'local':
        owner = ask('Your sign-in email: ')
        mail_key = ask('Your Resend API key (hidden): ', hidden=True)
        sender = ask('Verified sender email: ')
    try:
        values = configuration(args.target, origin, database, gateway, key, owner, mail_key, sender)
    except ValueError:
        parser.error('Configuration was incomplete. Nothing was created; check the requested formats.')
    if input('Write a new private installation directory? Type yes: ').strip() != 'yes':
        print('Cancelled. Nothing was created.'); return 0
    write_configuration(destination, values)
    print('Cloning the canonical Cypher source. No secrets are sent to GitHub.')
    try:
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', 'main', REPOSITORY, str(destination/'source')], check=True)
    except subprocess.CalledProcessError:
        print('Source download failed. Your private configuration is retained. Retry the clone in README.txt after checking GitHub access.');return 1
    source = (destination/'source/frontend/src/lib/canonical-app.ts').read_text()
    if 'NEXT_PUBLIC_SELF_HOSTED_ORIGIN' not in source:
        print('The canonical release does not include self-host origin support yet. Configuration is saved, but nothing was started. Update to a supported release before deploying.');return 1
    profile = [] if args.target == 'local' else ['--profile', 'cloud']
    try:
        subprocess.run(['docker', 'compose', *profile, 'config', '--quiet'], cwd=destination, check=True)
    except subprocess.CalledProcessError:
        print('Compose could not validate this configuration. Nothing was started. Review your local files.');return 1
    print('Configuration ready. Your .env is private; keep it out of chat and source control.')
    if input('Build and start this installation now? Type yes: ').strip() != 'yes':
        print('Saved. Start it later with the commands in README.txt.');return 0
    result = subprocess.run(['docker', 'compose', *profile, 'up', '-d', '--build'], cwd=destination)
    if result.returncode:
        print('Startup did not complete. Inspect docker compose logs on this machine.');return result.returncode
    print('Containers started. Open '+values['GROKBOT_PUBLIC_URL']+' and verify sign-in, worker health, and model access.')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError):
        print('\nSetup stopped. Any files already written are retained privately.')
        raise SystemExit(1)
