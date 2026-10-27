#!/usr/bin/env bash
# =============================================================================
# HMS Returnly — Phase 7, task 4a: CI on PostgreSQL 18 + runbook (branch railway)
#
#   bash phase7-postgres-18.bash                    # apply + check
#   bash phase7-postgres-18.bash --rollback-help
#
# Creates phase7/postgres-18 from origin/railway:
#   * CI tests on postgres:18, the major Railway staging runs (18.6);
#   * docs/RAILWAY.md records what was set up: PostgreSQL 18.6, database
#     "returnly", the four shared variable NAMES, bucket "photos"
#     (virtual-hosted), and the exact variable references for the web service;
#   * db/README.md notes 17+ locally, 18 on Railway and in CI.
# No code, migration or package changes. Never commits, pushes or deploys.
# =============================================================================
set -Eeuo pipefail
set -f   # no filename patterns: paths contain ( ) and [ ]
trap 'echo "✗ Stopped at line $LINENO (exit $?). Nothing was committed or pushed. Undo: bash $0 --rollback-help" >&2' ERR

BASE="railway"
BRANCH="phase7/postgres-18"
NEW_FILES=""
ok()  { printf '  ✓ %s\n' "$1"; }
die() { printf '  ✗ %s\n' "$1" >&2; exit 1; }

case "${1:-}" in
  "") ;;
  --rollback-help)
    cat <<'HELP'
ROLLBACK (before committing):
  git switch --discard-changes main      (drops this step's edits; your other branches are untouched)
  git branch -D phase7/postgres-18
  (this step adds no new files)
Backups of the replaced files are in .git/returnly-backup/<time>/.
After pushing: close the pull request; railway and main are untouched.
HELP
    exit 0 ;;
  *) die "Unknown option: $1" ;;
esac

echo "== Checks =="
for t in git node npm; do command -v "$t" >/dev/null 2>&1 || die "$t is not installed"; done
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node 22 or later needed"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "Not in a git repository"
[ "$(pwd -P)" = "$(cd "$ROOT" && pwd -P)" ] || die "Run this from the repo root: $ROOT"
grep -q '"name": "hms-returnly"' package.json || die "package.json is not hms-returnly"
sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }

CURRENT=$(git branch --show-current)
if [ "$CURRENT" = "$BRANCH" ] && grep -q "image: postgres:18" .github/workflows/ci.yml; then
  ok "Already on $BRANCH with the changes — re-running checks only"
  APPLY=0
else
  APPLY=1
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "Uncommitted changes to tracked files. Commit or stash them first (git status shows them)."
  git show-ref --verify --quiet "refs/heads/$BRANCH" && die "Branch $BRANCH already exists. Switch to it and re-run, or delete it."
  # Explicit refspec: also works in clones that only track main.
  git fetch --quiet origin "+refs/heads/$BASE:refs/remotes/origin/$BASE" || die "Could not fetch $BASE from GitHub"
  BASE_SHA=$(git rev-parse "origin/$BASE")
  [ "$(git ls-remote origin "refs/heads/$BASE" | awk '{print $1}')" = "$BASE_SHA" ] || die "origin/$BASE does not match GitHub; re-run this script"
  ok "origin/$BASE is $(git rev-parse --short "$BASE_SHA")"
  git cat-file -e "origin/$BASE:src/lib/health.ts" 2>/dev/null || die "Railway-ready (PR #21) is not on $BASE yet. Merge PR #21 first, then re-run."
  ok "PR #21 (railway-ready) is on $BASE"
  for f in $NEW_FILES; do
    git cat-file -e "origin/$BASE:$f" 2>/dev/null && die "$f already exists on $BASE — tell Claude"
    [ -e "$f" ] && die "$f already exists in your folder (untracked). Move it aside first — tell Claude"
  done
  while read -r path blob; do
    [ "$(git rev-parse "origin/$BASE:$path" 2>/dev/null)" = "$blob" ] || die "$path on $BASE differs from the version these changes were made against — tell Claude"
  done <<'BLOBS'
.github/workflows/ci.yml 61833b4009eb7ce070e71f0db736aff45d71c13b
db/README.md abba7609567817fb1e5f66516ce9d432361f7fa0
docs/RAILWAY.md 17e204646f02bca9d9a2c3a1d07826c9edfe8a0c
package-lock.json d1ab090cb31b2be1cec3e601ce523c1958cd3031
BLOBS
  ok "Files to be replaced or removed (and package-lock.json) match origin/$BASE"
fi

TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT

mkdir -p "$TMP/.github/workflows"
cat > "$TMP/.github/workflows/ci.yml" <<'RETURNLY_FILE_EOF'
name: CI

on:
  push:
    # railway is the long-lived integration branch for the migration.
    branches: [main, railway]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      # Throwaway Postgres 18 (the major Railway runs) that exists only for
      # this CI run. Trust auth on a private CI network means no password to
      # manage.
      postgres:
        image: postgres:18
        env:
          POSTGRES_HOST_AUTH_METHOD: trust
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - name: Unit tests
        run: npm test
      - name: Database rules on PGlite (migrations + RLS + workflow)
        run: npm run test:db
      # Photo store for the tests: versitygw (Apache-2.0), the same S3-compatible
      # server used on developers' Macs. Pinned version; the downloaded archive's
      # SHA-256 is printed so it can be compared with the release's checksums.
      - name: Start versitygw (S3-compatible photo store)
        env:
          GH_TOKEN: ${{ github.token }}
          VGW_VERSION: v1.10.0
        run: |
          set -euo pipefail
          mkdir -p /tmp/vgw-bin /tmp/vgw-data
          assets=$(gh release view "$VGW_VERSION" --repo versity/versitygw --json assets --jq '.assets[].name')
          echo "$assets"
          asset=$(echo "$assets" | grep -iE 'linux' | grep -iE 'x86_64|amd64' | grep -iE '\.tar\.gz$' | head -n1)
          [ -n "$asset" ] || { echo "No Linux x86_64 archive in $VGW_VERSION"; exit 1; }
          gh release download "$VGW_VERSION" --repo versity/versitygw --pattern "$asset" --dir /tmp/vgw-bin
          sha256sum "/tmp/vgw-bin/$asset"
          tar -xzf "/tmp/vgw-bin/$asset" -C /tmp/vgw-bin
          bin=$(find /tmp/vgw-bin -type f -name versitygw | head -n1)
          chmod +x "$bin"
          "$bin" --version || true
          # Throwaway keys made fresh for this run only (masked in the log).
          key=$(openssl rand -hex 12); secret=$(openssl rand -hex 24)
          echo "::add-mask::$secret"
          echo "S3_TEST_ACCESS_KEY_ID=$key" >> "$GITHUB_ENV"
          echo "S3_TEST_SECRET_ACCESS_KEY=$secret" >> "$GITHUB_ENV"
          ROOT_ACCESS_KEY="$key" ROOT_SECRET_KEY="$secret" nohup "$bin" posix /tmp/vgw-data > /tmp/vgw.log 2>&1 &
          for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:7070/ && break; sleep 1; done
          curl -s -o /dev/null -w "versitygw answered HTTP %{http_code}\n" http://127.0.0.1:7070/
      - name: Database rules on real Postgres 18 (+ photos on versitygw)
        env:
          TEST_DATABASE_URL: postgresql://postgres@localhost:5432/postgres
          S3_TEST_ENDPOINT: http://127.0.0.1:7070
          # S3_TEST_ACCESS_KEY_ID / S3_TEST_SECRET_ACCESS_KEY come from the step above.
        run: npm run test:db
      - name: versitygw log (on failure)
        if: failure()
        run: cat /tmp/vgw.log || true
      - run: npm run build
RETURNLY_FILE_EOF

mkdir -p "$TMP/db"
cat > "$TMP/db/README.md" <<'RETURNLY_FILE_EOF'
# Database for plain Postgres (Railway)

This folder holds the database setup for running HMS Returnly on plain Postgres 17+ (Railway runs 18; CI tests on 18)
instead of Supabase. Supabase production is unchanged until launch.

| Path | What | Run as | When |
|---|---|---|---|
| `bootstrap/000_platform.sql` | Roles `anon`, `authenticated`, `app_user`, `app_owner`, `auth_service`; `auth.users`; `auth.uid()`; Supabase's default grants | a superuser | once per new database (safe to repeat) |
| `migrations/*.sql` | The eight Supabase migrations, copied. `004` is empty and `008` lacks one block: both only configured Supabase Storage, whose photo rules move to the app in Phase 5 | `app_owner` | in filename order, after the bootstrap; `007` alone in its own transaction |
| `migrations/20261022000009_auth_tables.sql` | **Railway only.** Sign-in tables for Better Auth in schema `auth` (extends `auth.users`; adds `session`, `account`, `verification`, `rate_limit`), usable only by `auth_service` | `app_owner` | after re-running the bootstrap (it creates `auth_service`) |
| `migrations/20261024000010_staff_admin.sql` | **Railway only.** `add_staff_member()` and `set_staff_active()`: the only way the app can add a staff row or change access; each checks the caller is an active manager of the same hotel | `app_owner` | after 009 |
| `migrations/20261026000011_sign_in_guard.sql` | **Railway only.** `auth.sign_in_failures` (wrong-password lock per username) and `auth.users.blocked` (deactivated staff cannot sign in), kept in step by `set_staff_active()` | `app_owner` | after 010 |
| `migrate.mjs` | The runner: applies `migrations/` in order, one transaction per file, recording each file's SHA-256 in `ops.schema_migrations` | `app_owner` via `MIGRATION_DATABASE_URL` | every deploy (Phase 7 pre-deploy step) |

While `supabase/migrations/` still exists (until launch), change both folders together:
`tests/migrations-sync.test.mjs` fails if the copies drift from the originals. Railway-only files
must be listed in its `RAILWAY_ONLY` set. On Supabase the staff page wrote staff rows with the
service key (bypassing RLS); on Railway the app has no such key, so 010 moves that check into the database.

## Local development database

```bash
npm run db:local:setup          # creates returnly_dev on Postgres at localhost:5432
```

`scripts/local-db-setup.mjs` does what Railway will: the bootstrap as a superuser, every migration
as `app_owner` with the runner, then the DEMO seed (synthetic data only). It refuses anything that is
not on this computer, never drops or empties anything, and on an existing database only applies new
migrations, so run it again after pulling new ones. It prints the three connection strings for
`.env.local`. Then create a login with `npm run create-staff` (it asks for the password twice).
Set `LOCAL_PG_URL` if your local server is not `postgresql://localhost:5432/postgres`.

## Running migrations

```bash
MIGRATION_DATABASE_URL=… npm run db:migrate               # plan only: lists pending files, changes nothing
MIGRATION_DATABASE_URL=… npm run db:migrate -- --apply    # apply them
```

The runner stops **before changing anything** if it is connected as anything other than `app_owner`
(a superuser would end up owning the tables), if the bootstrap has not been run, if an applied file was
edited or removed, if a new file sorts before one already applied, or if another run holds the lock.
Files with statement-level `DROP`, `TRUNCATE`, `DELETE` or `RENAME` also need `--allow-destructive`.
A file that fails is rolled back and not recorded. Applied files are never edited: fix forward with a new file.

## App code: src/lib/db

All queries go through `withStaff(userId, tx => …)` or `withAnon(tx => …)` from `@/lib/db`. Each call runs in one
transaction as `authenticated` (with the staff user id) or `anon`, so row-level security applies exactly as on Supabase.

- `tx.query(sql, params)` for parameterised SQL; `tx.rpc(fn, { p_name: value })` for workflow functions.
- Statements starting with `SET`/`RESET`, `set_config()`, and transaction control are refused before reaching the database.
- On start-up the pool checks it is logged in as `app_user` (not a superuser) and refuses to serve requests otherwise.
- `tests/db-guard.test.mjs` fails if any file outside `src/lib/db` switches roles or imports `pg`.
- Sign-in uses its own pool (`src/lib/db/auth-pool.ts`) logged in as `auth_service`; it refuses to start as any other role.

## Roles

| Role | Logs in | Used by | Can do |
|---|---|---|---|
| `app_owner` | yes | migration runner, scheduled jobs | owns every table and function; not a superuser; no BYPASSRLS |
| `app_user` | yes | the web app | nothing by itself; each request runs `SET LOCAL ROLE authenticated` or `anon` inside a transaction |
| `authenticated` | no | signed-in staff requests | what row-level security and the workflow functions allow |
| `anon` | no | public customer pages | the four public functions only |
| `auth_service` | yes | Better Auth (sign-in, sessions) | only the sign-in tables in schema `auth`; no hotel tables or functions; cannot switch roles |

Rules for application code:

- Always `BEGIN; SET LOCAL ROLE …; SELECT set_config('request.jwt.claim.sub', $1, true); …; COMMIT;`
- Never a session-level `SET ROLE` or `set_config(..., false)`: on a pooled connection it leaks
  one user's identity into the next request. `supabase/tests/platform.test.mjs` proves `SET LOCAL`
  does not leak.

Passwords for `app_user` and `app_owner` are set by hand when a database is provisioned
(Phase 7), never in files.

## Tests

`npm run test:db` runs the bootstrap and every migration as `app_owner`; with
`TEST_DATABASE_URL` set it also logs in as `app_user` to prove the rules above.
RETURNLY_FILE_EOF

mkdir -p "$TMP/docs"
cat > "$TMP/docs/RAILWAY.md" <<'RETURNLY_FILE_EOF'
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
RETURNLY_FILE_EOF

EXPECTED_SHA="$TMP/expected.sha"
cat > "$EXPECTED_SHA" <<'RETURNLY_FILE_EOF'
028956dbac9b6af8b1f7cc8a80c9bbc68a04967b59a2379c5f3b48305a072d91 .github/workflows/ci.yml
77408a38551fa42c49ed311cde70bc87e5a11b9543a634d97892a65c769978c6 db/README.md
460b86e83041264fc6daf8e1d71d575fb3a31da2983f3f81894ff18c0d070af3 docs/RAILWAY.md
RETURNLY_FILE_EOF
LOCK_BLOB="d1ab090cb31b2be1cec3e601ce523c1958cd3031"

if [ "$APPLY" = 1 ]; then
  echo "== Branch =="
  git switch -c "$BRANCH" "origin/$BASE"
  echo "== Backup =="
  BK="$(git rev-parse --git-dir)/returnly-backup/phase7-pg18-$(date +%Y%m%d-%H%M%S)"
  while read -r path _; do
    [ "$path" = package-lock.json ] && continue
    mkdir -p "$BK/$(dirname "$path")"; cp -p -- "$path" "$BK/$path"
  done <<'BACKUP'
.github/workflows/ci.yml 61833b4009eb7ce070e71f0db736aff45d71c13b
db/README.md abba7609567817fb1e5f66516ce9d432361f7fa0
docs/RAILWAY.md 17e204646f02bca9d9a2c3a1d07826c9edfe8a0c
package-lock.json d1ab090cb31b2be1cec3e601ce523c1958cd3031
BACKUP
  ok "Backed up to $BK"
  echo "== Write files =="
  while read -r _ f; do mkdir -p "$(dirname "$f")"; cp -- "$TMP/$f" "$f"; ok "$f"; done < "$EXPECTED_SHA"
fi

echo "== Verify =="
while read -r want path; do
  [ "$(sha "$path")" = "$want" ] || die "$path does not match the tested version — tell Claude"
done < "$EXPECTED_SHA"
ok "All $(wc -l < "$EXPECTED_SHA" | tr -d ' ') files match Claude's tested versions"
[ "$(git hash-object package-lock.json)" = "$LOCK_BLOB" ] || die "package-lock.json changed — this step adds no packages; tell Claude"
ok "package-lock.json unchanged (no new packages)"
if [ ! -f node_modules/better-auth/package.json ] || [ "$(node -p 'require("./node_modules/better-auth/package.json").version')" != "1.7.12" ]; then
  echo "  installing packages exactly as locked (npm ci) …"; npm ci --no-audit --no-fund
fi
if [ "$APPLY" = 1 ]; then git --no-pager diff --stat HEAD; git status --short; fi

echo "== Checks =="
rm -rf -- "$ROOT/.next"
failed=0
for c in lint typecheck test test:db build; do
  printf '→ npm run %s … ' "$c"; log=$(mktemp)
  if npm run -s "$c" >"$log" 2>&1; then echo PASS; else echo FAIL; failed=1; tail -n 40 "$log"; fi
  grep -hE '^# (tests|pass|fail) ' "$log" | sed 's/^/     /' || true
  n=$(grep -c 'skip (' "$log" || true)
  if [ "$n" -gt 0 ]; then echo "     $n real-Postgres suites skipped here (CI runs them)"; fi
  rm -f -- "$log"
done

echo
if [ "$failed" = 0 ]; then
  echo "✓ All checks passed on $BRANCH (based on $BASE). Nothing was committed or pushed."
  echo "  The real-Postgres checks run in CI on the pull request."
else
  echo "✗ Some checks failed (above). Nothing was committed or pushed. Undo: bash $0 --rollback-help"; exit 1
fi