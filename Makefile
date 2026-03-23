-include .env
export

.PHONY: infra-up infra-down infra-logs dev-web dev-worker

infra-up:
	docker compose up -d postgres redis

infra-down:
	docker compose down

infra-logs:
	docker compose logs -f postgres redis

dev-web:
	cd web && pnpm dev

dev-worker:
	cd api && go run ./cmd/worker
