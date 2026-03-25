# Pre-Deploy Checklist

This checklist is for taking `daily3dmaze` from local development to a real deployed environment.

For the first real hosted environment, start with the staging-specific checklist at [`docs/staging-config-checklist.md`](/Users/mason/git/daily3dmaze/docs/staging-config-checklist.md).

## 1. Secrets and Environment

- [ ] Use a dedicated production Postgres database and credentials.
- [ ] Confirm no real secrets are committed in [`.env`](/Users/mason/git/daily3dmaze/.env) or any tracked file.
- [ ] Populate production values for:
  - [ ] `DATABASE_URL`
  - [ ] `APP_ENV=production`
  - [ ] `API_BASE_URL`
  - [ ] `WEB_BASE_URL`
  - [ ] `WEB_ALLOWED_ORIGINS`
  - [ ] `TRUST_PROXY_HEADERS` only if behind a trusted proxy that rewrites forwarded headers
  - [ ] `SMTP_HOST`
  - [ ] `SMTP_PORT`
  - [ ] `SMTP_FROM_EMAIL`
  - [ ] `SMTP_USERNAME`
  - [ ] `SMTP_PASSWORD`
  - [ ] `GITHUB_OAUTH_CLIENT_ID`
  - [ ] `GITHUB_OAUTH_CLIENT_SECRET`
  - [ ] `GOOGLE_OAUTH_CLIENT_ID`
  - [ ] `GOOGLE_OAUTH_CLIENT_SECRET`
  - [ ] `NEXT_PUBLIC_API_BASE_URL`
  - [ ] `NEXT_PUBLIC_GITHUB_OAUTH_ENABLED`
  - [ ] `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`
- [ ] Leave `NEXT_DEV_ALLOWED_ORIGINS` empty outside local development.

## 2. Security

- [ ] Confirm the site is served over HTTPS only.
- [ ] Confirm cookies are `Secure`, `HttpOnly`, and `SameSite=Lax` in production.
- [ ] Confirm API responses include:
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `X-Frame-Options: DENY`
  - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
  - [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [ ] Confirm web responses include a production CSP without `unsafe-eval`.
- [ ] Confirm `WEB_ALLOWED_ORIGINS` contains only real deployed web origins.
- [ ] Confirm `TRUST_PROXY_HEADERS=false` unless the deployment platform sanitizes and rewrites forwarded headers.
- [ ] Confirm reset and verification links are never logged in production.
- [ ] Confirm password reset only works for verified recovery emails.
- [ ] Confirm local-account email verification works end to end.
- [ ] Confirm Google and GitHub OAuth apps use production callback URLs only.
- [ ] Confirm staging and production use separate OAuth credentials.

## 3. Background Processing

- [ ] Ensure the worker process is deployed alongside the API.
- [ ] Confirm new runs move from `pending` to verified states in the deployed environment.
- [ ] Confirm worker logs do not contain replay payloads, session secrets, or reset/verify tokens.

## 4. Database and Migrations

- [ ] Run migrations before serving traffic.
- [ ] Confirm migrations `000015` and `000016` are applied in the target environment.
- [ ] Verify the production DB user can read/write required tables but does not have unnecessary privileges.
- [ ] Confirm backups or snapshots exist before first public rollout.

## 5. QA

- [ ] Manual auth QA:
  - [ ] register local account
  - [ ] verify email
  - [ ] log in / log out
  - [ ] forgot password
  - [ ] reset password
  - [ ] GitHub login
  - [ ] Google login
- [ ] Manual role QA:
  - [ ] anonymous user
  - [ ] normal user
  - [ ] moderator
  - [ ] admin
  - [ ] banned user
- [ ] Manual gameplay QA:
  - [ ] start run
  - [ ] finish run
  - [ ] verification status updates after finish
  - [ ] fullscreen enter/exit
  - [ ] mobile swipe controls
- [ ] Manual locale QA in English and Spanish.
- [ ] Manual accessibility QA:
  - [ ] keyboard navigation
  - [ ] focus visibility
  - [ ] reduced-motion behavior

## 6. Performance and Monitoring

- [ ] Run Lighthouse against the production build, not dev mode.
- [ ] Confirm `/` and `/play` are still within acceptable performance targets.
- [ ] Confirm `/health` is reachable for uptime checks.
- [ ] Decide on privacy-respecting analytics before adding any tracking.

## 7. CI/CD

- [ ] CI should run:
  - [ ] `go test ./...`
  - [ ] `pnpm test`
  - [ ] `pnpm build`
- [ ] Add deployment steps only after staging is stable.
- [ ] Deploy to staging first, then repeat the QA checklist before production.

## 8. Rollout

- [ ] Start with a staging environment that matches production domains and OAuth callbacks.
- [ ] Verify email delivery from the real SMTP provider.
- [ ] Verify role management and admin actions in staging.
- [ ] Verify password reset and email verification in staging.
- [ ] Promote to production only after the above checks pass.
