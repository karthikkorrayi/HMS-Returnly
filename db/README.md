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
| `migrations/20261030000012_hotel_setup.sql` | **Railway only.** First-time setup (`installation`, `setup_status()`, `complete_initial_setup()`: once only, all or nothing), `floors` + `rooms.floor_id`/`rooms.active`, `areas`, hotel contact and support details, `update_hotel_details()`, `update_staff_member()`. Additive; existing hotels get floors from their rooms, the default areas, and count as set up | `app_owner` | after 011 |
| `migrations/20261030000013_public_contacts.sql` | **Railway only.** `public_hotel_contacts()`: the hotel's phone, email, support hours and note for guests (no sign-in) | `app_owner` | after 012 |
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
