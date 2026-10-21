# Better Auth spike — report

Date: 2026-10-22 · Better Auth **1.7.12** (MIT) · Next.js 16.4.2 · Postgres 17.10
Branch: `spike/better-auth` (throwaway, never merged) · Plan approved 2026-10-22 (criteria S1–S12)

## Verdict

**PASS — adopt Better Auth (decision D2), with the eight conditions in §3.**
All twelve criteria passed on real Postgres 17 after two configuration fixes and one
code-level mitigation for a library gap (§2). Design question 1 → **Option 2**
(internal adapter + `public.staff`, no admin plugin). Design question 2 → **extend
`auth.users`** (one user table; `staff.user_id` keeps its foreign key).

## 1. Results (automated, `spike/better-auth/run.mjs`)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| S1 | Next.js 16.4 + `pg` on a plain Node server | PASS | `next build` + `next start`; sign-in over HTTP 200; protected route 401 signed out, correct role signed in; cross-site sign-in 403 (with our route check) |
| S2 | Username sign-in; public sign-up impossible; server-side creation only | PASS | `POST /sign-up/email` → 400; server `auth.api.signUpEmail` → refused; no user created; app's username rule (incl. `-`) enforced |
| S3 | UUID ids; `staff.user_id` / `auth.uid()` unchanged | PASS | id is a UUID in `auth.users`; staff FK accepted; `withStaff(session.user.id)` → RLS sees the right role |
| S4 | Deactivation ends sessions on the next request; manager reset | PASS | same cookie → no session after `deleteUserSessions`; reset ends sessions, old password fails, new works |
| S5 | Sign-in rate limiting | PASS | 5 failed tries per IP per minute, 6th → 429; changing `X-Forwarded-For` does not escape; survives restart (stored in `auth.rate_limit`) |
| S6 | MIT; no Vercel dependency | PASS | licence MIT; no `@vercel/*` in the tree; telemetry off by default and disabled explicitly |
| S7 | Auth tables outside `public`; app roles cannot read them | PASS | tables in schema `auth`; `anon`/`authenticated`/`app_user` have no privilege; `auth_service` cannot read hotel data |
| S8 | Hashes never reach browser or logs | PASS | stored value is a scrypt hash; sign-in/session responses and server logs contain no password or hash |
| S9 | Cookie flags | PASS | `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax` (https) |
| S10 | Same error for wrong password and unknown user | PASS | both 401 with identical body; median timing 144 vs 132 ms |
| S11 | Login cost | PASS | 30 sequential sign-ins 3.6 s (≈122 ms each); 30 simultaneous 2.0 s, all succeeded; memory +5 MB |
| S12 | Runtime `npm audit` clean | PASS | 0 vulnerabilities |

## 2. What the spike found (and fixed in spike code)

1. **`generateId: "uuid"` leaves ids to Postgres defaults.** Our `auth.users.id` has no
   default, so inserts failed. Fix: `generateId: () => crypto.randomUUID()` (the app
   generates every auth id).
2. **The app's proxy redirected Better Auth's endpoints to `/login`.** API routes must
   bypass the redirect and answer 401 themselves; the proxy now skips `/api/*`.
3. **Library gap — login CSRF on username sign-in.** In 1.7.12 `/sign-in/email` applies
   the built-in login-CSRF check but the username plugin's `/sign-in/username` does
   not: Better Auth alone accepted a cross-origin sign-in (200). Mitigation in our
   route handler: every `POST /api/auth/*` must carry our own `Origin`, or (without
   `Origin`) must not be marked `Sec-Fetch-Site: cross-site` → 403 otherwise. Tested.
   Worth reporting upstream.
4. **Rate limits only apply to HTTP calls**, not server-side `auth.api.*` calls. So
   staff sign-in must go through the `/api/auth/sign-in/username` endpoint (rate
   limited), not a server action calling `auth.api` (not limited).
5. **Server logs say "Invalid password" vs "User not found".** Not visible to
   visitors (S10 passes) and no usernames/IPs are logged; acceptable, or lower the
   log level.
6. **Telemetry package is a dependency** but is opt-in and does nothing without an
   endpoint; disabled explicitly in config.
7. **Option 2 uses Better Auth's internal adapter** (`createUser`, `linkAccount`,
   `updatePassword` — takes a hash —, `deleteUserSessions`). Internal APIs can change
   between versions → pin the exact version and keep these tests.
8. The source-scan test (task 5) correctly flagged `pg` imported outside
   `src/lib/db` — the auth pool must live under `src/lib/db/`.

## 3. Conditions for the implementation (on branch `railway`)

1. Auth tables in schema `auth`, owned by `app_owner`, used only by a dedicated
   `auth_service` login (`search_path = auth`); no privileges for `anon`,
   `authenticated` or `app_user`; extend `auth.users` (no second user table).
   This is a Railway-only migration, so `tests/migrations-sync.test.mjs` needs an
   explicit rule for files that exist only in `db/migrations`.
2. `generateId` returns `crypto.randomUUID()`.
3. Route handler origin check on every `POST /api/auth/*` (finding 3), with tests.
4. Proxy skips `/api/*`; pages keep `requireSession()` as the real check.
5. Cookie cache **off**; sessions 12 h with hourly refresh (proposal — confirm the
   shift length with the hotel).
6. Rate limits stored in the database; the client-IP header must be **the one header
   Railway's proxy sets and overwrites** — verify on staging (Phase 7) before launch,
   otherwise limits can be spoofed.
7. Staff management via the internal adapter (Option 2); deactivation sets
   `staff.active = false` **and** deletes sessions; reset ends sessions.
8. Exact version pin (`better-auth@1.7.12`), `BETTER_AUTH_SECRET` ≥ 32 random
   characters from the environment, telemetry off, auth pool under `src/lib/db/`.

## 4. Not covered here

Railway's real proxy header (Phase 7); load at the Phase 8 targets on Railway
hardware; Android device testing of the sign-in page (comes with the port).

## 5. Noted for later (owner request, no app change now)

A hotel **onboarding/setup flow** for an admin to register a hotel: name and
details, staff-size range (e.g. "10–25"), and accommodation details (rooms, floors,
spaces such as pool, restaurant, music/event venues). Relevant when more hotels are
added (Pro plan, per-hotel agreements, a platform-level admin above hotel managers —
which needs its own careful access-control design).
