# Staging Config Checklist

This checklist is for the first real staging environment for `daily3dmaze`.

Use this before setting up CI/CD deployment steps. The goal is to prove that the app works with real domains, HTTPS, OAuth callbacks, SMTP delivery, and a worker process before production.

## Recommended Staging Shape

- Web app at a real HTTPS host, for example:
  - `https://staging.daily3dmaze.com`
- API at a real HTTPS host, for example:
  - `https://api-staging.daily3dmaze.com`
- Dedicated staging Postgres database
- Dedicated staging OAuth credentials
- Real SMTP provider or sandbox SMTP account
- Separate worker process connected to the same staging database

## 1. Staging Environment Variables

Populate these values in the staging environment.

### API / Worker

- [ ] `DATABASE_URL`
  - Example: `postgres://staging_user:staging_password@db-host:5432/daily3dmaze_staging?sslmode=require`
- [ ] `APP_ENV=production`
- [ ] `API_BASE_URL=https://api-staging.daily3dmaze.com`
- [ ] `WEB_BASE_URL=https://staging.daily3dmaze.com`
- [ ] `WEB_ALLOWED_ORIGINS=https://staging.daily3dmaze.com`
- [ ] `TRUST_PROXY_HEADERS=true` only if the platform terminates TLS and rewrites forwarded IP headers correctly
- [ ] `SMTP_HOST`
- [ ] `SMTP_PORT`
- [ ] `SMTP_FROM_EMAIL`
- [ ] `SMTP_USERNAME`
- [ ] `SMTP_PASSWORD`
- [ ] `GITHUB_OAUTH_CLIENT_ID`
- [ ] `GITHUB_OAUTH_CLIENT_SECRET`
- [ ] `GOOGLE_OAUTH_CLIENT_ID`
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET`

### Web

- [ ] `NEXT_PUBLIC_API_BASE_URL=https://api-staging.daily3dmaze.com`
- [ ] `NEXT_PUBLIC_GITHUB_OAUTH_ENABLED=true` if GitHub OAuth is enabled in staging
- [ ] `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` if Google OAuth is enabled in staging
- [ ] Leave `NEXT_DEV_ALLOWED_ORIGINS` unset or empty in staging

## 2. OAuth Callback Setup

Register staging-only OAuth apps or staging credentials.

### GitHub

- [ ] Homepage URL:
  - `https://staging.daily3dmaze.com`
- [ ] Callback URL:
  - `https://api-staging.daily3dmaze.com/api/auth/oauth/github/callback`

### Google

- [ ] Authorized JavaScript origin:
  - `https://staging.daily3dmaze.com`
- [ ] Authorized redirect URI:
  - `https://api-staging.daily3dmaze.com/api/auth/oauth/google/callback`

### Rule

- [ ] Do not reuse production OAuth credentials in staging
- [ ] Do not leave localhost or LAN-IP callback URLs in staging OAuth configs

## 3. Email / Recovery Setup

- [ ] SMTP is configured with a real sender identity usable from staging
- [ ] Verification emails arrive successfully
- [ ] Password reset emails arrive successfully
- [ ] Reset or verification links are not written to logs in staging
- [ ] `SMTP_FROM_EMAIL` matches the provider’s allowed sender configuration

## 4. Security Checks

- [ ] The staging site is served only over HTTPS
- [ ] Session cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`
- [ ] API responses include:
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `X-Frame-Options: DENY`
  - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
  - [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [ ] Web responses include a CSP without `unsafe-eval`
- [ ] Only staging origins are present in `WEB_ALLOWED_ORIGINS`
- [ ] `TRUST_PROXY_HEADERS` behavior matches the deployment platform
- [ ] Password reset only works for verified recovery emails
- [ ] Local email verification works before reset is allowed

## 5. Database and Migrations

- [ ] Run all migrations in staging before routing traffic
- [ ] Confirm schema includes the newest auth/recovery changes
- [ ] Verify the worker can read and update runs in staging
- [ ] Verify the API can read and write all required tables
- [ ] Confirm a rollback/backups plan exists for the staging database too

## 6. Process Layout

- [ ] Web process is running from the production build
- [ ] API process is running with staging env vars
- [ ] Worker process is running with the same staging DB/env
- [ ] `/health` responds on the API host

## 7. Staging QA Checklist

Run these checks on the actual staging URLs.

### Auth

- [ ] Register a local account with email
- [ ] Verify email from the delivered link
- [ ] Log in and log out
- [ ] Request password reset
- [ ] Reset password with the delivered link
- [ ] Confirm old password no longer works
- [ ] Confirm new password works

### OAuth

- [ ] Sign in with GitHub
- [ ] Sign in with Google
- [ ] Confirm linked accounts get expected usernames/emails
- [ ] Confirm verified OAuth emails can be used for password reset

### Roles

- [ ] Confirm normal user sees only normal-user UI
- [ ] Confirm moderator sees moderator tools
- [ ] Confirm admin sees admin-only controls
- [ ] Confirm banned users lose access appropriately

### Gameplay

- [ ] Start and finish a run
- [ ] Confirm run submission succeeds
- [ ] Confirm verification state updates from `pending`
- [ ] Confirm the worker processes the run
- [ ] Confirm fullscreen works on supported browsers
- [ ] Confirm swipe controls work on mobile

### Locale / Accessibility

- [ ] Verify English SSR renders correctly
- [ ] Verify Spanish SSR renders correctly
- [ ] Verify `<html lang>` changes correctly by locale
- [ ] Check keyboard navigation on main routes
- [ ] Check reduced-motion behavior on `/play`

## 8. Performance / Monitoring

- [ ] Run Lighthouse against the staging production build
- [ ] Check `/` and `/play`
- [ ] Confirm `/health` is suitable for uptime probes
- [ ] Confirm logs do not contain secrets, tokens, reset links, or OAuth codes

## 9. Exit Criteria Before Production

Do not move to production until staging has:

- [ ] working local signup, verification, login, and reset
- [ ] working GitHub and Google OAuth
- [ ] worker verification flow operating correctly
- [ ] correct security headers and HTTPS-only traffic
- [ ] successful Lighthouse checks on the production build
- [ ] role/admin flows verified
- [ ] no token leakage in logs
