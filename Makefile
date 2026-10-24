.PHONY: up down build logs reset backend-shell migrate sandbox-build

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

reset:
	docker compose down -v
	docker compose up -d

backend-shell:
	docker compose exec backend bash

migrate:
	docker compose exec backend alembic upgrade head

sandbox-build:
	docker build -t open-grokbot-sandbox:latest ./sandbox
