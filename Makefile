-include .env
export

.PHONY: infra-up infra-down infra-logs

infra-up:
	docker compose up -d postgres redis

infra-down:
	docker compose down

infra-logs:
	docker compose logs -f postgres redis
