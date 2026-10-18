# HMS Returnly — Railway migration plan

Version 2 · 2026-10-18 · Baseline commit `579d945` (Next.js 16.4.2).
Supporting document; **`ARCHITECTURE_DECISION.md` wins** where they differ.
Nothing here is applied until its phase is approved. Every phase ends with tests green, a short write-up, and a go/no-go.

---

## 1. Ground rules for every phase

- Work on branches; `main` keeps deploying to Vercel + Supabase until launch. No half-migrated production.
- **Synthetic data only** in development, CI and staging. No real hotel data is created or copied before Phase 8.
- The Supabase project is **not modified or deleted** during development.
- Scripts never commit, push, deploy, change DNS or delete cloud resources. The owner does those by hand after review.
- Destructive database changes need explicit confirmation, even on staging.
- Each script states purpose, files changed, prerequisites, command, expected output, verification, failure handling and rollback.

## 2. Current architecture (as found)

```
 Browser (staff)                       Browser (customer, no login)
   │  └── direct photo upload ──┐         │
   ▼                            ▼         ▼
 Vercel: Next.js 16.4 (App Router, Server Actions, src/proxy.ts)
   │ server client = staff session cookie      │ anon client
   ▼                                           ▼
 Supabase (London, Postgres 17.6)
   ├─ Auth      username → <username>@STAFF_EMAIL_DOMAIN, password, ban = deactivate
   ├─ PostgREST every .from() / .rpc()
   ├─ Postgres  16 tables, RLS, SECURITY DEFINER workflow functions, pg_cron purges
   └─ Storage   private bucket item-photos, policies on storage.objects
```

Authorization lives in the database (RLS + workflow functions + triggers + audit tables). The migration keeps it there.

### Supabase footprint on `579d945` (counted, not estimated)

| Touchpoint | Count | Where |
|---|---|---|
| Files importing Supabase | 26 | `src/**`, `scripts/create-staff.mjs` |
| Table queries `.from('table')` | 37 | across pages and actions |
| `.rpc()` calls | 20 calls, 18 functions | workflow + 4 public functions |
| Auth calls | 11 | `signInWithPassword` 1, `getUser` 2, `signOut` 2, admin `createUser` / `updateUserById` / `deleteUser` 2 each |
| Storage calls | 4 | `lib/photos.ts` (2), `lib/photo-urls.ts`, `items/[id]/actions.ts` |
| Direct writes | 4 insert, 1 update, 2 delete | everything else goes through functions |
| Browser Supabase client | 2 components | `LogItemForm.tsx`, `AddPhotos.tsx` (uploads) |
| Env vars | 4 (+ `DEV_LAN_HOST`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_EMAIL_DOMAIN` |

### Supabase-only SQL to replace

`auth.users` (FK from `staff`), `auth.uid()`, roles `anon` / `authenticated`, and **storage policies in migrations 04 and 08** (08 drops and recreates `item_photos_upload` to block the Support role). Everything else is plain Postgres.

## 3. Findings and status

| ID | Severity | Finding | Status / lands in |
|---|---|---|---|
| F1 | High (after move) | No app-level login throttling once Supabase Auth goes | Phase 4 |
| F2 | High (after move) | Storage rules (property folder, no photos on sensitive or closed items, 5 MB, JPEG/WebP, manager-only delete, Support blocked) must move into code; `storage_path` not validated against the item's property | Phase 5 |
| F3 | Medium | No HTTP security headers | Phase 6 |
| F4 | Medium | Purges not scheduled in the repo | Supabase: scheduled by hand (verified). Railway: Phase 6 cron service |
| F5 | Medium | `customer_request_status` has no rate limit | Phase 6 |
| F6 | Medium | Service-role key bypasses RLS for staff admin; replacement must use a narrow role | Phase 4 |
| F7 | Low | Unused rooms/stays functions still granted to `authenticated` | Phase 3 decision, separate reversible migration |
| F8 | Low | `create-staff` script rejects `support` | Phase 4 |
| F12 | Medium | Next.js 16.2.12 had critical/high advisories | **Fixed** in production (16.4.2, PR #1) |
| F13 | Info | Supabase has no migration history; state was established by inspection | Resolved by D5 runner on Railway |
| F14 | Info | Local Node 26 vs CI Node 22 | Phase 7 (pin Node 22) |

## 4. Phases

### Phase 3 — PostgreSQL layer (local only, synthetic data)

Goal: the app talks to plain Postgres through `pg`, with every RLS rule intact. Auth is stubbed for tests only.

1. **CI:** add a Postgres 17 service container; run the existing four DB suites against both PGlite and real Postgres.
2. **Bootstrap SQL** `db/bootstrap/000_platform.sql`: roles `anon`, `authenticated`, `app_user` (login, member of both, not owner), `app_owner`; `auth` schema with `auth.users(id uuid primary key)` and `auth.uid()` reading `request.jwt.claim.sub` (same definition as the PGlite stub).
3. **Migrations:** copy 01–08 into `db/migrations/`. Replace the storage parts of 04 and 08 with no-ops (rules move in Phase 5). Keep 07 alone (enum value).
4. **Runner** (D5): applies pending files in order inside transactions, records them in `schema_migrations`, holds an advisory lock, refuses edited already-applied files (checksum).
5. **Data layer** `src/lib/db/`: one `pg.Pool` singleton; `withStaff(userId, fn)` and `withAnon(fn)` using `SET LOCAL ROLE` + `set_config(..., true)`; a typed `rpc()` helper.
6. **Port** the 37 table queries and 20 RPC calls file by file, preserving SQL semantics.
7. **F7:** list unused rooms/stays functions; propose a separate revoke migration (applied only with approval).

Tests: all four suites on real Postgres; `SET LOCAL` does not leak across pooled connections; `app_user` cannot write audit tables or alter schema; trigger guards fire; cross-hotel isolation (`OTHER` fixture); anon can call only the four public functions.
Rollback: delete the branch.

### Phase 4 — Authentication (Better Auth spike, then implementation)

1. **Spike** on a throwaway branch against criteria 1–6 in `ARCHITECTURE_DECISION.md` §6 D2. Written pass/fail report before any adoption.
2. If pass: Better Auth tables in a new migration; map its user id to `staff.user_id` / `auth.users`; username plugin; sign-up disabled; manager-only creation, reset, deactivate (revokes sessions); login rate limit.
3. If fail — **D2-fallback (custom):** Argon2id hashes (`auth_credentials`), random 256-bit session token in an `HttpOnly; Secure; SameSite=Lax` cookie with only its SHA-256 stored (`auth_sessions`), idle + absolute expiry, per-username and per-IP throttling, generic errors.
4. Rewrite `login`, `signOut`, `getSession`, `proxy.ts` (cookie-presence check only; `requireSession()` stays the real check). Staff admin uses a narrow DB role (F6). Rewrite `create-staff` and allow `support` (F8). Remove `STAFF_EMAIL_DOMAIN` mapping only if the library no longer needs a synthetic email.

Tests: identical errors for wrong password / unknown user; lockout and recovery; session expiry and cookie flags; deactivated user loses access on the next request; sign-up endpoint unreachable; full role matrix (housekeeping, front office, Support, manager) end to end.

### Phase 5 — Private photo storage

Local S3-compatible target for development (e.g. MinIO in Docker — verify on the owner's Mac), Railway bucket only from Phase 7.

1. SQL helper `can_add_photo(item_id)` encoding the old storage rules (same property, tier not `sensitive`, item not returned/disposed/donated, role not Support).
2. Upload Route Handler: session + role check, `can_add_photo`, ≤ 5 MB, magic-byte check (JPEG/WebP), path `{property_id}/{item_id}/{uuid}.jpg`, then insert `item_photos`. Origin check on the handler.
3. View: presigned GET, 30 minutes, only for paths that start with the caller's `property_id` (closes F2).
4. Manager-only delete removes object and row. Remove the browser Supabase client.
5. **Q5 (30-day deletion after an item closes) is designed but switched off** until the hotel approves it in writing.

Tests: allowed/blocked per role, tier and status; other hotel's path cannot be signed; oversize, wrong type and spoofed headers rejected; link expiry.

### Phase 6 — Backups, security, operations

- Cron service (UTC, idempotent, exits, closes connections): `purge_expired_stays()`, `purge_closed_requests()`, expired-session cleanup, 6-hourly encrypted `pg_dump`, daily photo copy. Missing-run alert, not only failure alert.
- Off-platform EU bucket chosen after reading the provider's DPA; encryption key held outside Railway and the backup bucket; hotel read-only access + written restore procedure.
- Security headers (CSP, HSTS, `X-Content-Type-Options`, frame protection, `Referrer-Policy`, `Permissions-Policy`) (F3). Per-IP rate limits on `/track` lookups and enquiry submit (F5), trusting only Railway's last proxy hop for client IP.
- Health endpoint `/api/health` (`select 1` within ~2 s; no details). Structured JSON logs; no request bodies, passwords, names or booking IDs.
- Restore drill on a scratch database; record RTO.

### Phase 7 — Staging on Railway

- Upgrade to Hobby; set hard limit ≈ $25 and alert ≈ $12; confirm two-factor.
- Create project in **EU West**: Postgres (pinned major ≥ 17; record `select version()`), bucket (EU West), web, cron. Private networking; no public Postgres proxy.
- Install Railway's GitHub app for **this repository only**.
- Pin Node 22 for build and runtime. Pre-deploy step runs the migration runner as `app_owner`.
- Synthetic seed only. Full UAT per role on physical Android devices. Scripted smoke test. Restore drill from an off-platform dump.

### Phase 8 — Production readiness and launch

Release gates (all must pass; nothing launches automatically):

| Gate | Target |
|---|---|
| 30 concurrent staff, mixed actions | p95 < 500 ms, 0 errors |
| 30 logins in 60 s | all succeed, no memory spike |
| 10 simultaneous photo uploads | p95 < 3 s |
| 50 concurrent public enquiry operations | rate limits hold, 0 errors |
| 10× stress run | first bottleneck and cost at that load documented |
| One week of staging metrics | replaces every estimate in the cost table |
| Restore drill | succeeded, timed |
| Data protection (Phase 14) | hotel sign-off recorded |

Launch: fresh production environment from migrations; first manager created with the new `create-staff`; **no demo data**; domain switch; smoke test. Vercel + Supabase stay as they are (read-only) for an agreed rollback window, then the Supabase project is archived and deleted **only with explicit approval**.

### Phase 14 — Data-protection checklist (engineering input; the hotel decides)

1. Data held and retention per type (items become eligible for disposal after 90 days; enquiries purged 365 days after closing; stays per their retention setting; photos per Q5).
2. Location: Amsterdam (EEA) at rest; Railway primary processing in the US under DPF / SCCs + UK Addendum.
3. Roles: hotel = controller; Railway, backup provider, uptime monitor = (sub-)processors. Railway DPA executed via its form.
4. Backup retention ≤ data retention; encrypted; who holds the key.
5. Breach contact and how fast the hotel is told (it has 72 hours to report qualifying breaches to the ICO).
6. Access: roles, joiner/leaver process, who can reach Railway.
7. Before a second hotel: legal advice on Railway's third-party clause, Pro plan, processing agreement per hotel.

## 5. Data migration

None. Supabase holds test data only (confirmed 2026-10-18). Production on Railway starts empty from migrations. If that changes before launch, stop and plan a migration with rehearsals.

## 6. Configuration reference (names only, never values)

`DATABASE_URL` (app_user, private network), `MIGRATION_DATABASE_URL` (app_owner, runner and cron only), `APP_ORIGIN`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, auth secret, backup bucket credentials, backup encryption key (stored outside Railway too), `NODE_ENV=production`. Staging and production never share values. All four Supabase variables are removed at launch.

## 7. Risks

1. `SET LOCAL ROLE` misuse silently bypasses RLS → one helper, leak tests, review rule.
2. Auth library behaviour differs from assumptions → spike with written pass/fail before adoption.
3. Photo rules re-implemented incorrectly → negative tests per rule.
4. Postgres operations are ours → off-platform backups, drills, monthly checklist.
5. Single instance, no SLA → uptime alerts; expectations agreed with the hotel.
6. Usage-based billing → hard limit + alerts.
7. Single-operator account → hotel-accessible backups, handover runbook, Pro when needed.

## 8. Definition of done

- Runs on Railway with no Supabase or Vercel dependency; all four roles pass the UAT script on physical Android devices.
- All DB suites green on real Postgres in CI; auth, storage, header, rate-limit and isolation tests green.
- Migrations apply from empty; runner records history.
- Purges and backups run on schedule; missing-run alert works; a timed restore has succeeded.
- Alerts: downtime, backup missing/failed, volume > 70 %, spend.
- Runbooks: deploy, rollback, restore, secret rotation, staff joiner/leaver, incident contacts, handover.
- Supabase project archived and deleted only after approval at the end of the rollback window.
