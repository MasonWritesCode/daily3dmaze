# daily3dmaze

`daily3dmaze` is an open-source fullstack showcase project built around a retro-inspired daily 3D maze challenge.

The goal is to create a small but serious product:
- a browser-based first-person maze experience
- daily seeded challenges
- authenticated runs and leaderboards
- room for streaks, achievements, validation, and admin tooling

## Planned Stack

- `web/`: Next.js frontend
- `api/`: Go backend and background workers
- Postgres for relational data
- Redis for caching, queues, and rate limiting

## Local Development

The local development setup will start small:
- Postgres and Redis run through Docker Compose
- the frontend and backend applications will run directly on the host during development
- the frontend uses `pnpm` as its package manager

Planned local ports:
- `3000`: Next.js web app
- `8080`: Go API
- `5432`: Postgres
- `6379`: Redis

Current helper commands:
- `make infra-up`
- `make infra-down`
- `make infra-logs`
- `make dev-web`

At this stage, Compose is only responsible for local infrastructure services.
