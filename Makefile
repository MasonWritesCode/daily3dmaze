-include .env
export

.PHONY: infra-up infra-down infra-logs dev-api dev-web dev-worker build-web prod-web

infra-up:
	docker compose up -d postgres redis

infra-down:
	docker compose down

infra-logs:
	docker compose logs -f postgres redis

dev-api:
	cd api && go run ./cmd/api

dev-web:
	cd web && pnpm dev

dev-worker:
	cd api && go run ./cmd/worker

build-web:
	cd web && pnpm build

prod-web:
	cd web && pnpm build && pnpm start
