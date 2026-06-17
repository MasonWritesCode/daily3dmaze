# Hosting daily3dmaze

`daily3dmaze` is best deployed as a small multi-service stack:

- `daily3dmaze-web`: Next.js production server
- `daily3dmaze-api`: Go API
- `daily3dmaze-worker`: background verification worker
- `daily3dmaze-postgres`: internal Postgres only
- `cloudflared`: publishes the web and API through Cloudflare Tunnel

## Recommended public hostnames

This app already assumes separate web and API origins in its staging docs, so the clean production shape is:

- `https://daily3dmaze.masonwritescode.com` -> `daily3dmaze-web:3000`
- `https://daily3dmaze-api.masonwritescode.com` -> `daily3dmaze-api:8080`

That keeps the current app configuration model intact and avoids adding another reverse-proxy layer.

Use a single-label API hostname like `daily3dmaze-api.masonwritescode.com` instead of a multi-level host like `api.daily3dmaze.masonwritescode.com` so you stay within the simpler certificate shape.

## 1. Prepare the environment file

Copy [hosting.env.example](/Users/mason/git/daily3dmaze/hosting.env.example) to `.env` in the deployed stack directory.

At minimum, set:

- `POSTGRES_PASSWORD`
- `TUNNEL_TOKEN`
- `WEB_BASE_URL`
- `API_BASE_URL`
- `WEB_ALLOWED_ORIGINS`
- `NEXT_PUBLIC_API_BASE_URL`

Recommended defaults to keep:

- `APP_ENV=production`
- `TRUST_PROXY_HEADERS=true`
- `WEB_BIND_IP=127.0.0.1`
- `API_BIND_IP=127.0.0.1`
- `POSTGRES_BIND_IP=127.0.0.1`
- `POSTGRES_HOST_PORT=5433`

## Local smoke testing on a laptop

For a local Docker-based hosting check before you ship to Dockge or Cloudflare, start from [.env.localhost.example](/Users/mason/git/daily3dmaze/.env.localhost.example).

Important local values:

- `WEB_BASE_URL=http://localhost:3001`
- `API_BASE_URL=http://localhost:8081`
- `POSTGRES_HOST_PORT=5433`
- `WEB_ALLOWED_ORIGINS=http://localhost:3001`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8081`
- `TRUST_PROXY_HEADERS=false`

Then run:

```bash
cp .env.localhost.example .env.localhost
docker compose -f docker-compose.hosting.yml --env-file .env.localhost up --build daily3dmaze-postgres daily3dmaze-api daily3dmaze-worker daily3dmaze-web
```

Why the ports matter: the hosting compose stack publishes the web app on `3001` and the API on `8081`. If you leave `NEXT_PUBLIC_API_BASE_URL` set to `http://localhost:8080`, the browser will call the wrong port even if the API container is healthy.

The stack also publishes Postgres on `127.0.0.1:5433` by default. That keeps the database off your LAN and WAN while still allowing host-local tools such as DBeaver to connect.

## 2. Cloudflare Tunnel routes

In the Cloudflare Zero Trust tunnel, add these public hostnames:

- `daily3dmaze.masonwritescode.com` -> `http://daily3dmaze-web:3000`
- `daily3dmaze-api.masonwritescode.com` -> `http://daily3dmaze-api:8080`

## 3. Build and run the stack

```bash
docker compose -f docker-compose.hosting.yml up --build -d
```

In Dockge, paste the stack YAML from [docker-compose.hosting.yml](/Users/mason/git/daily3dmaze/docker-compose.hosting.yml), place the repo contents in the stack directory, and store the environment variables in `.env`.

## 4. Local smoke tests on the server

```bash
curl http://127.0.0.1:3001
curl http://127.0.0.1:8081/health
pg_isready -h 127.0.0.1 -p 5433 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

If you change any `NEXT_PUBLIC_*` value, rebuild `daily3dmaze-web`. Those values are baked into the Next.js build output.

Then verify the public hosts:

- `https://daily3dmaze.masonwritescode.com`
- `https://daily3dmaze-api.masonwritescode.com/health`

## 5. Private DBeaver access on TrueNAS

Use DBeaver through an SSH tunnel over Tailscale rather than publishing Postgres on your WAN IP or putting it behind Cloudflare Tunnel.

### Server-side expectations

- `POSTGRES_BIND_IP=127.0.0.1`
- `POSTGRES_HOST_PORT=5433`
- no pfSense port forward for `5432` or `5433`
- no Cloudflare public hostname for Postgres
- SSH enabled on the TrueNAS host
- Tailscale running on the TrueNAS host and on the client machine

With that setup, Postgres only listens on the TrueNAS host loopback interface, so it is reachable from:

- containers in the compose network via `daily3dmaze-postgres:5432`
- the TrueNAS host itself via `127.0.0.1:5433`
- remote admin machines only through an authenticated SSH tunnel

### DBeaver connection settings

Main PostgreSQL tab:

- Host: `127.0.0.1`
- Port: `5433`
- Database: your `POSTGRES_DB` value
- Username: your `POSTGRES_USER` value
- Password: your `POSTGRES_PASSWORD` value

SSH tab:

- Host/IP: your TrueNAS Tailscale IP or MagicDNS hostname
- Port: `22`
- Username: your TrueNAS admin user
- Authentication: SSH key preferred

### Security notes

- Keep SSH key-based if possible.
- Restrict SSH to Tailscale or management VLAN access in pfSense where practical.
- Use a dedicated Postgres user for day-to-day DB inspection instead of a superuser if you do not need schema-changing access.
- Leave `POSTGRES_BIND_IP` on `127.0.0.1` unless you have a very specific reason to widen it.

## 6. App-specific production notes

- The API already runs embedded migrations on startup.
- The worker must be deployed alongside the API or runs will stay in `pending`.
- `NEXT_PUBLIC_*` values are baked into the Next.js build, so changing them requires rebuilding `daily3dmaze-web`.
- If SMTP is not configured in production, local signup can still create accounts, but password reset and email verification delivery will not function.
- OAuth should stay disabled until callback URLs and credentials are configured for the deployed hosts.

## 7. Rollout checklist

After the stack is live, work through:

- [docs/staging-config-checklist.md](/Users/mason/git/daily3dmaze/docs/staging-config-checklist.md)
- [docs/pre-deploy-checklist.md](/Users/mason/git/daily3dmaze/docs/pre-deploy-checklist.md)
