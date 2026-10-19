# Database for plain Postgres (Railway)

This folder holds the database setup for running HMS Returnly on plain Postgres 17+
instead of Supabase. Supabase production is unchanged until launch.

| Path | What | Run as | When |
|---|---|---|---|
| `bootstrap/000_platform.sql` | Roles `anon`, `authenticated`, `app_user`, `app_owner`; `auth.users`; `auth.uid()`; Supabase's default grants | a superuser | once per new database (safe to repeat) |

## Roles

| Role | Logs in | Used by | Can do |
|---|---|---|---|
| `app_owner` | yes | migration runner, scheduled jobs | owns every table and function; not a superuser; no BYPASSRLS |
| `app_user` | yes | the web app | nothing by itself; each request runs `SET LOCAL ROLE authenticated` or `anon` inside a transaction |
| `authenticated` | no | signed-in staff requests | what row-level security and the workflow functions allow |
| `anon` | no | public customer pages | the four public functions only |

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
