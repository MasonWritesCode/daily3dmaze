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

## Local Development

The local development setup will start small:
- Postgres runs through Docker Compose
- the frontend and backend applications will run directly on the host during development
- the frontend uses `pnpm` as its package manager

Planned local ports:
- `3000`: Next.js web app
- `8080`: Go API
- `5432`: Postgres

Local backend configuration:
- `DATABASE_URL` should point at the local Postgres instance
- `API_BASE_URL` and `WEB_BASE_URL` should match your local callback origins if using OAuth
- `WEB_ALLOWED_ORIGINS` controls which web origins may send credentialed API requests
- `TRUST_PROXY_HEADERS` should stay `false` unless the API is behind a trusted proxy that rewrites forwarded IP headers
- `NEXT_DEV_ALLOWED_ORIGINS` is only for local Next.js dev access from additional LAN origins; leave it empty in production

Password reset configuration:
- in development, reset links fall back to API log output when SMTP is not configured
- in production, configure:
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_FROM_EMAIL`
  - `SMTP_USERNAME`
  - `SMTP_PASSWORD`

Current helper commands:
- `make infra-up`
- `make infra-down`
- `make infra-logs`
- `make dev-web`

Optional OAuth configuration:
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `NEXT_PUBLIC_GITHUB_OAUTH_ENABLED=true`
- `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true`

At this stage, Compose is only responsible for the local Postgres service.

## Pre-Deploy Checklist

See [`docs/pre-deploy-checklist.md`](/Users/mason/git/daily3dmaze/docs/pre-deploy-checklist.md) for the production security, configuration, QA, and rollout checklist.

If you are setting up the first hosted environment, start with [`docs/staging-config-checklist.md`](/Users/mason/git/daily3dmaze/docs/staging-config-checklist.md).
