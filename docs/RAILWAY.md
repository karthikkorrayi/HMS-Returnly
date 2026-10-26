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

- Source image pinned to a **PostgreSQL 17** image (Railway's default is 16).
  Must be set **before** any data exists: changing it later means wiping the
  volume. Record `select version()` here: `…`
- Volume at `/var/lib/postgresql/data`, EU West.
- **No public TCP proxy** (only the private network reaches it). If one is
  ever enabled for a one-off task, remove it straight after.
- Backups (Phase 6/7): Railway volume backups daily + weekly, **and** an
  encrypted off-platform `pg_dump` (Railway backups can only be restored inside
  the same project and environment).
- One-time setup as the `postgres` superuser: `db/bootstrap/000_platform.sql`,
  then passwords for `app_owner`, `app_user`, `auth_service` (generated on the
  owner's computer, never in chat or in the repository).

### Bucket (photos)

- Railway Storage Bucket, EU West, private (Railway buckets cannot be public).
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

Variables on **web** (names only; values in Railway):

| Name | Value / source |
|---|---|
| `DATABASE_URL` | `postgresql://app_user:<password>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/<db>` |
| `MIGRATION_DATABASE_URL` | same, as `app_owner` (used only by the pre-deploy command) |
| `AUTH_DATABASE_URL` | same, as `auth_service` |
| `BETTER_AUTH_URL` | `https://<this environment's public domain>` |
| `BETTER_AUTH_SECRET` | 32+ random bytes, **different per environment** |
| `AUTH_IP_HEADER` | `x-real-ip` (Railway's edge overwrites it; verify on staging) |
| `STAFF_EMAIL_DOMAIN` | `staff.invalid` |
| `S3_ENDPOINT` | `${{Bucket.ENDPOINT}}` |
| `S3_BUCKET` | `${{Bucket.BUCKET}}` (not `RAILWAY_BUCKET_NAME`) |
| `S3_ACCESS_KEY_ID` | `${{Bucket.ACCESS_KEY_ID}}` |
| `S3_SECRET_ACCESS_KEY` | `${{Bucket.SECRET_ACCESS_KEY}}` |
| `S3_REGION` | `${{Bucket.REGION}}` |
| `S3_PATH_STYLE` | `false` unless the bucket's Credentials tab says path-style |

`MIGRATION_DATABASE_URL` sits on the web service because Railway's pre-deploy
command only sees that service's variables. The app itself never reads it
(only `db/migrate.mjs` does). Known trade-off; revisit if a separate migration
job becomes possible.

(`Postgres` and `Bucket` are the service names on the canvas; adjust the
references if they are named differently.)

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
