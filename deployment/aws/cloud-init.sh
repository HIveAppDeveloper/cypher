#!/bin/bash
set -euo pipefail
# Supplied by CloudFormation, without embedding model credentials.
GROKBOT_DOMAIN='__DOMAIN__'
GROKBOT_STACK='__STACK__'
GROKBOT_REGION='__REGION__'
GROKBOT_MODEL_PARAMETER='__MODEL_PARAMETER__'
trap 'result=$?; /opt/aws/bin/cfn-signal -e "$result" --stack "$GROKBOT_STACK" --resource Host --region "$GROKBOT_REGION"' EXIT

dnf install -y docker git aws-cfn-bootstrap
systemctl enable --now docker
install -d -m 755 /usr/local/lib/docker/cli-plugins
curl --fail --location --silent --show-error https://github.com/docker/compose/releases/download/v2.39.2/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose
git clone --depth 1 https://github.com/HIveAppDeveloper/open-grokbot.git /opt/grokbot
cd /opt/grokbot
umask 077
GROKBOT_TOKEN=$(openssl rand -hex 32)
GROKBOT_PASSWORD=$(openssl rand -hex 16)
GROKBOT_MODEL_KEY=$(aws ssm get-parameter --name "$GROKBOT_MODEL_PARAMETER" --with-decryption --region "$GROKBOT_REGION" --query Parameter.Value --output text)
aws ssm put-parameter --name "/grokbot/$GROKBOT_STACK/login" --type SecureString --value "$GROKBOT_PASSWORD" --region "$GROKBOT_REGION" --overwrite >/dev/null
GROKBOT_PASSWORD_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$GROKBOT_PASSWORD")
cat > .env.aws <<EOF
GROKBOT_DATABASE_URL=postgresql+asyncpg://grokbot:$GROKBOT_TOKEN@database:5432/grokbot
POSTGRES_PASSWORD=$GROKBOT_TOKEN
BACKEND_API_TOKEN=$GROKBOT_TOKEN
GROKBOT_BACKEND_API_TOKEN=$GROKBOT_TOKEN
OPENAI_API_KEY=$GROKBOT_MODEL_KEY
GROKBOT_PUBLIC_URL=https://$GROKBOT_DOMAIN
CORS_ORIGINS=https://$GROKBOT_DOMAIN
REDIS_URL=redis://redis:6379/0
SANDBOX_BACKEND=docker
EOF
cat > Caddyfile <<EOF
$GROKBOT_DOMAIN {
  basic_auth {
    owner $GROKBOT_PASSWORD_HASH
  }
  reverse_proxy frontend:3000
}
EOF
cat > compose.aws.yml <<'EOF'
services:
  database:
    image: postgres:17-alpine
    env_file: .env.aws
    environment:
      POSTGRES_DB: grokbot
      POSTGRES_USER: grokbot
    volumes: [database:/var/lib/postgresql/data]
    healthcheck:
      test: [CMD-SHELL, pg_isready -U grokbot]
      interval: 5s
      retries: 20
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes: [redis:/data]
    restart: unless-stopped
  backend:
    build: ./backend
    env_file: .env.aws
    volumes: [/var/run/docker.sock:/var/run/docker.sock, uploads:/app/uploads]
    depends_on:
      database: {condition: service_healthy}
    restart: unless-stopped
  frontend:
    build: ./frontend
    env_file: .env.aws
    environment:
      GROKBOT_BACKEND_URL: http://backend:8000
    depends_on: [backend]
    restart: unless-stopped
  web:
    image: caddy:2-alpine
    ports: ['80:80', '443:443']
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy:/data]
    depends_on: [frontend]
    restart: unless-stopped
volumes:
  database:
  redis:
  uploads:
  caddy:
EOF
docker build -t open-grokbot-sandbox:latest ./sandbox
docker compose -f compose.aws.yml up -d --build
# Creation is successful only after the private API and database respond.
for attempt in $(seq 1 60); do
  if docker compose -f compose.aws.yml exec -T backend python -c 'import os,urllib.request; r=urllib.request.Request("http://127.0.0.1:8000/api/runtime",headers={"Authorization":"Bearer "+os.environ["BACKEND_API_TOKEN"]}); urllib.request.urlopen(r,timeout=5).read()'; then
    exit 0
  fi
  sleep 5
done
exit 1
