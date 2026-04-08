# Detect if docker-compose or docker compose is available
DOCKER_COMPOSE := $(shell command -v docker-compose 2> /dev/null || echo "docker compose")

.PHONY: up down build logs seed reset ps

up:
	cp -n .env.example .env 2>/dev/null || true
	$(DOCKER_COMPOSE) up -d --build

down:
	$(DOCKER_COMPOSE) down

build:
	$(DOCKER_COMPOSE) build --no-cache

logs:
	$(DOCKER_COMPOSE) logs -f

seed:
	$(DOCKER_COMPOSE) exec normalization-service python /app/scripts/seed.py

reset:
	$(DOCKER_COMPOSE) down -v
	$(DOCKER_COMPOSE) up -d --build

ps:
	$(DOCKER_COMPOSE) ps

shell-db:
	$(DOCKER_COMPOSE) exec postgres psql -U soc_admin -d central_soc
