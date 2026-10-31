# Railway runbook

Every Railway setting for HMS Returnly, in one place. Railway's settings live
in its dashboard (its `railway.json` "config as code" is deprecated and stops
being read on 2026-12-01), so **this file is the record**: change a setting in
Railway → change it here in the same pull request.

Secrets are never written here or anywhere in the repository. Only variable
**names** appear below; values live in Railway.

## Deployment model (agreed 2026-10-27)

| Environment | Branch | Deploys when | Data |
|---|---|---|---|
| `staging` | `railway` | automatically after a merge, **only once CI is green** (Wait for CI) | synthetic only |
| `production` | `production` (created in Phase 8) | automatically after a release PR `railway → production` is merged by the owner, once CI is green | real, only after the Phase 14 sign-off |

The database is updated before each deploy by the migration runner (pre-deploy
command). It refuses destructive changes unless run with
`--allow-destructive`, which the pre-deploy command never uses: a refused
migration fails the deploy and the previous version keeps running.

Nothing launches automatically: production exists only from Phase 8, after the
release gates in `docs/MIGRATION_PLAN.md`.

## Account and workspace

- Plan: Hobby. Two-factor on.
- Usage limits: hard limit **$25**, email alert **$12** (raise only deliberately).
- Railway's GitHub app: access to **`karthikkorrayi/HMS-Returnly` only**.

## Project

- Name: `hms-returnly`
- Region for every service and volume: **EU West (Amsterdam)**. Personal data
  of UK hotel guests stays in Europe. A volume can't move region without
  downtime, so choose it at creation.
- Environments: `staging` (Phase 7). `production` is left empty until Phase 8.

## Services (per environment)

### Postgres

- **PostgreSQL 18** (Railway's default for new databases in October 2026).
  Staging: `PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)`, recorded 2026-10-27.
  CI tests on `postgres:18` so it matches. Local development may stay on 17
  (the whole suite passes on both). Never `:latest`; a later major goes through
  Railway's Database → Config → Major Version Upgrade.
- Application database: **`returnly`** (Railway's own `railway` database is
  left unused).
- Volume at `/var/lib/postgresql/data`, EU West.
- **No public TCP proxy** (only the private network reaches it). If one is
  ever enabled for a one-off task, remove it straight after.
- Backups (Phase 6/7): Railway volume backups daily + weekly (needs the Hobby
  plan; **not on yet**, staging runs on trial credits), **and** an
  encrypted off-platform `pg_dump` (Railway backups can only be restored inside
  the same project and environment).
- One-time setup as the `postgres` superuser, done for staging on 2026-10-27
  with the owner's `railway-db-setup.bash`: database `returnly`,
  `db/bootstrap/000_platform.sql`, and random passwords for `app_owner`,
  `app_user`, `auth_service` (generated on the owner's computer; only SCRAM
  verifiers sent; public networking switched on for the run and off after).

### Shared variables (per environment)

Set once in the environment's Shared Variables; services refer to them as
`${{shared.NAME}}`. Values are never written anywhere else.

| Name | What |
|---|---|
| `APP_OWNER_PASSWORD` | `app_owner` login (migrations) |
| `APP_USER_PASSWORD` | `app_user` login (the web app) |
| `AUTH_SERVICE_PASSWORD` | `auth_service` login (sign-in) |
| `BETTER_AUTH_SECRET` | signs sessions; different per environment |

### Bucket (photos)

- Railway Storage Bucket named **`photos`**, EU West, private (Railway buckets
  cannot be public). Endpoint `https://t3.storageapi.dev`, virtual-hosted
  addresses (new buckets' default) → `S3_PATH_STYLE=false`.
- No versioning or backups on Railway's side, and a deleted bucket is
  recoverable for only 52 hours: the daily off-platform photo copy (Phase 6)
  is required before real data.

### web (the Next.js app)

| Setting | Value |
|---|---|
| Source | GitHub `karthikkorrayi/HMS-Returnly` |
| Branch | `railway` (staging) / `production` (production) |
| Wait for CI | **on** (CI workflow `CI` runs on push to these branches) |
| Builder | Railpack (default). Node **22** from `.nvmrc` |
| Build command | default (`npm run build`) |
| Start command | default (`npm run start` → `next start`, listens on `$PORT`) |
| Pre-deploy command | `node db/migrate.mjs --apply` |
| Pre-deploy timeout | 300 seconds |
| Health check path | `/api/health` (200 only when the database answers within 2 s) |
| Restart policy | on failure |
| Public domain | Railway-provided `*.up.railway.app` (custom domain in Phase 8) |

Variables on **web** (Raw Editor). These are references, not secrets: the
values are filled in by Railway from the shared variables and the other
services.

```
DATABASE_URL=postgresql://app_user:${{shared.APP_USER_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/returnly
MIGRATION_DATABASE_URL=postgresql://app_owner:${{shared.APP_OWNER_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/returnly
AUTH_DATABASE_URL=postgresql://auth_service:${{shared.AUTH_SERVICE_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/returnly
BETTER_AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
BETTER_AUTH_SECRET=${{shared.BETTER_AUTH_SECRET}}
AUTH_IP_HEADER=x-real-ip
STAFF_EMAIL_DOMAIN=staff.invalid
S3_ENDPOINT=${{photos.ENDPOINT}}
S3_BUCKET=${{photos.BUCKET}}
S3_ACCESS_KEY_ID=${{photos.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{photos.SECRET_ACCESS_KEY}}
S3_REGION=${{photos.REGION}}
S3_PATH_STYLE=false
```

- Each database line has **its own user** (`app_user` / `app_owner` /
  `auth_service`), the host `postgres.railway.internal` and port **5432**.
  5433 is only the port on the owner's Mac (two local PostgreSQL servers);
  it never belongs in Railway.
- `BETTER_AUTH_URL` must be the exact public address people use, or sign-in
  is refused as cross-site (403). Change it when a custom domain is added.
- `S3_BUCKET` uses the bucket's `BUCKET` variable, not `RAILWAY_BUCKET_NAME`.
- `AUTH_IP_HEADER`: Railway's edge overwrites `X-Real-IP`, so visitors can't
  fake it (Railway staff, 2026). Still checked on staging.

`MIGRATION_DATABASE_URL` sits on the web service because Railway's pre-deploy
command only sees that service's variables. The app itself never reads it
(only `db/migrate.mjs` does). Known trade-off; revisit if a separate migration
job becomes possible.

(`Postgres` and `photos` are the service names on the canvas; adjust the
references if they are named differently.)

### daily-cleanup (scheduled job)

Replaces Supabase's `pg_cron`. Once a night it runs `run_daily_cleanup()`
(migration 014): removes stays past the stay retention, closed enquiries past
the enquiry retention, expired sign-in sessions and tokens, and day-old
sign-in counters. Lost items and photos are never removed. Every run, also a
failed one, is recorded in `ops.job_runs`; managers see the last successful run
under Settings → "How long records are kept", with a warning after 36 hours.

| Setting | Value |
|---|---|
| Source | the same repository and branch as `web` |
| Wait for CI | **on** |
| Region | EU West |
| Build command | default |
| Start command | `node scripts/daily-cleanup.mjs` |
| Pre-deploy command | **none** (only `web` migrates) |
| Cron schedule | `30 3 * * *` (03:30 UTC = 03:30 in winter / 04:30 in summer, UK) |
| Health check | none (it is not a web server) |
| Restart policy | never (a failed night is retried by the next night; the warning shows it) |
| Public domain | none |

Variables on **daily-cleanup** (one only):

```
MIGRATION_DATABASE_URL=postgresql://app_owner:${{shared.APP_OWNER_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/returnly
```

- It logs in as `app_owner` because only the owner may run the clean-up; it
  refuses any other login. Same credential and private network as `web`'s
  pre-deploy; a dedicated, smaller role is a possible later improvement.
- The job exits after each run (Railway skips the next run while one is still
  active). Exit 0 = done, 1 = failed (logged with an error code only), 2 =
  variable missing or wrong. The URL is never printed.
- Log of a good run: `removed: stays 0, closed enquiries 0, sessions …` then `✓ done`.
- Run it by hand: Railway CLI `railway cron run`; without the CLI, set the
  schedule to `*/5 * * * *`, wait for one run in the log, set it back to
  `30 3 * * *`. Running it more than once is harmless.

## First-time setup (once per environment)

The full install, a local rehearsal, the after-install checklist and how to
reinstall safely are in [INSTALL.md](INSTALL.md).

Each environment has its own database, so each is set up exactly once: staging
with a made-up hotel, production with the real one at launch. Deploys never
repeat it: the database records that setup is done (`installation`) and
`complete_initial_setup()` refuses a second run.

1. Generate a setup key on your computer: `openssl rand -hex 24`.
2. Add it to the **web** service of that environment as `SETUP_TOKEN` and
   deploy. (Without it, or if it is shorter than 24 characters, `/setup` says
   "Setup is locked".)
3. Open `https://<domain>/` → it goes to `/setup`. Enter the key, the hotel,
   floors and rooms (`101-120` adds every room in between), areas, storage
   places, guest support details and the first administrator.
4. Complete setup → sign-in page → sign in as that administrator → add staff
   on the Staff page.
5. **Delete `SETUP_TOKEN`** from the variables. Setup is refused by the
   database anyway; removing the key closes the page for good.

A setup that fails part-way leaves nothing behind (the administrator's login is
removed again) and can simply be repeated.

## Rolling back

- **Code**: in the web service's Deployments list, redeploy the previous
  successful deployment. Takes effect in about a minute.
- **Database**: migrations are not undone by a code rollback. Every migration
  must keep working with the previous app version (additive changes only),
  so a code rollback is always safe. A bad data change is fixed forward with a
  new migration, or by restoring a backup (restore drill: Phase 6/7).

## Checks after each deploy (staging)

1. `https://<domain>/api/health` → `{"status":"ok"}`
2. Sign in as a synthetic manager; open Dashboard, Requests, Staff, Settings.
3. Log an item with a photo from a phone; open the photo.
4. Public page: submit a synthetic enquiry, then follow it on `/track`.
5. Settings → "Daily clean-up: Last ran … hours ago" (no warning).
