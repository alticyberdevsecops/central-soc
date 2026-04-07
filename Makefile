.PHONY: up down build logs seed reset ps

up:
	cp -n .env.example .env 2>/dev/null || true
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build --no-cache

logs:
	docker compose logs -f

seed:
	docker compose exec normalization-service python /app/scripts/seed.py

reset:
	docker compose down -v
	docker compose up -d --build

ps:
	docker compose ps

shell-db:
	docker compose exec postgres psql -U soc_admin -d central_soc
