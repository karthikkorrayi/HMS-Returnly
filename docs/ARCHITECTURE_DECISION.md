# HMS Returnly — Architecture decision: Railway

Version 3 · 2026-10-18 · Replaces version 2 (pre-repo draft).
Status: **approved direction (H1); details below are inputs to Phase 3 onward.** Nothing in this file changes running code.
Where this file and `MIGRATION_PLAN.md` disagree, **this file wins.**

Every Railway fact below was checked against Railway's own docs, Terms or Central Station on 2026-10-18 (sources in §12). Items still unverified are marked **(verify in Phase N)**.

---

## 1. Starting point (verified in Phase 0)

| Item | State |
|---|---|
| Code | GitHub `main` = `579d945`, Next.js 16.4.2, React 19.2.4. Lint, typecheck, unit, DB tests and build pass locally and in CI (Node 22). |
| Runtime vulnerabilities | 0 (`npm audit --omit=dev`). 5 dev-only ESLint advisories remain (not shipped). |
| Hosting today | Vercel (production deploys on every push to `main`; branch previews are private). Preview gets the three non-secret variables; the service-role key is Production only. |
| Database today | Supabase, London (eu-west-2), **Postgres 17.6**. Migrations 01–08 all applied (by SQL editor; Supabase has no migration history table). RLS on, photo bucket private. |
| Data | **Test data only** (confirmed by the owner): 1 property `DEMO`, 4 staff, 5 items, 3 photos (0.6 MB), 1 stay, 1 enquiry. Nothing needs migrating. |
| Scheduled jobs | `pg_cron` jobs for both purges are active on Supabase (one schedule string has a harmless typo; it runs twice nightly). |

## 2. Constraints

- One pilot hotel in the UK; the design must allow more hotels later (the schema already scopes every row by `property_id`).
- The developer pays recurring costs; low cost matters, but not at the expense of security or recoverability.
- No pausing, low maintenance, real backups, portable design.
- Development and testing use **synthetic data only**. The Supabase project stays untouched until after launch and a stable period.

## 3. Decision H1 — Railway, everything on one platform (Option B)

```
 Custom domain (HTTPS via Railway)
        │
        ▼
 ┌─ Railway project "returnly" ── region: EU West (Amsterdam) ─────────────────┐
 │                                                                              │
 │  web (Next.js, standalone) ──private network──► Postgres ≥17 (+ volume)      │
 │     │                                               ▲                        │
 │     └──── S3 API ────► Storage bucket (private)     │                        │
 │                                                     │                        │
 │  cron service (UTC): retention purges, session cleanup, encrypted pg_dump,   │
 │                      photo copy  ───────────────────┴──► off-platform EU     │
 └──────────────────────────────────────────────────────────  backup bucket ───┘
 External: uptime monitor (free) checking /api/health
```

Why: cheapest option that does not pause, keeps every business rule in the database, and uses only portable pieces (plain Postgres, S3 API, open-source auth library), so moving off Railway later is a connection-string change, not a rewrite.

Rejected: Vercel Hobby + Supabase Free (non-commercial terms; Free pauses and has no automatic backups). Kept as fallbacks: **Option C** (Supabase Pro London + app on Railway, ≈ $30/month) if the hotel requires UK-resident data or you decide not to operate Postgres; **Option A** (Vercel Pro + Supabase Pro, ≈ $45/month) if budget stops mattering.

## 4. Railway facts that shape the design

| Fact (verified 2026-10-18) | Consequence |
|---|---|
| Regions: California, Virginia, **Amsterdam**, Singapore. **No UK region.** | Use EU West (Amsterdam) for every service and the bucket. Data moves UK → Netherlands; see §8. |
| Bucket region is **fixed at creation**. | Create the bucket in EU West; never "default". |
| Standard Postgres template ships **no extra extensions** and Railway "does not plan to add" any. **No `pg_cron`.** | Purges and backups run from a Railway **cron service** (§6). |
| Docs don't state the template's Postgres major version; major upgrades support sources 14–17, so newer majors exist. | Pin a major tag **≥ 17** (current data is 17.6; a 17 dump cannot restore into 16). Check `select version()` on first creation **(verify in Phase 7)**. CI and local use Postgres 17. |
| Cron jobs: UTC, ≥ 5 minutes between runs, the process must exit; an overlapping run is **skipped**. | Jobs must be idempotent, close DB connections and exit; alert when a run is missing, not only when it fails. |
| Native Postgres backups: daily (kept 6 days), weekly (1 month), monthly (3 months); restore only within the same project/environment; **deleting the volume deletes its backups**. Plan availability not stated. | Useful extra layer if available on Hobby **(verify in Phase 6)**; never the only copy. |
| Buckets: S3-compatible, private, presigned URLs, $0.015/GB-month, free bucket egress and API calls; **no server-side encryption, no versioning, no backups**; deleted bucket restorable for 52 hours only. Hobby cap 1 TB. | Photos need their own off-platform copy (§7). Uploads from the app to the bucket count as service egress. |
| Plans: Hobby $5/month incl. $5 usage; Pro $20 incl. $20. Hobby volume 5 GB per service. | Hobby is enough for one hotel (DB < 100 MB/year). |
| Hard usage limit available on all subscription plans, minimum $10; reaching it **takes workloads offline**. | Hard limit ≈ $25, email alert ≈ $12 on Hobby. |
| **Workspace members are Pro/Enterprise only.** | On Hobby only the owner can sign in to Railway (continuity risk, §9). |

## 5. Plan and account decision (H2) — resolved for the pilot

- **Account:** the developer's individual Railway account, free plan, nothing created yet. Two-factor enabled on Railway and GitHub.
- **Railway's written answer** (Central Station, 2026-10-18, Railway's support bot): the Terms' "internal, personal, and/or business use" clause applies the same on every plan, so Hobby is not ruled out for an internal staff tool; workspace members are a Pro feature; the DPA applies to every plan as published. Offering the app to **other** hotels was left to the customer's own advisers (Terms: not "on behalf of or for the benefit of a third party"; AUP: no reselling of compute). Evidence (PDF of the thread and the Terms version, effective 2026-04-20) is kept outside this repo.
- **Pilot hotel management has approved** hosting on this account; a written record is kept outside this repo.
- **Upgrade to Hobby only at Phase 7** (first time anything runs on Railway). Phases 3–6 run locally.
- **Move to Pro before:** a second hotel goes live; anyone else needs Railway access; or usage regularly approaches $20/month. Take advice on the third-party clause before onboarding a second hotel.

## 6. Application design decisions

**D1 — Keep the database rules; replace the gateway (unchanged).**
The app connects as `app_user` (not the owner) and runs each request in a transaction:

```sql
BEGIN;
SET LOCAL ROLE authenticated;                          -- or anon for public pages
SELECT set_config('request.jwt.claim.sub', $1, true);  -- staff user id
-- queries / workflow functions
COMMIT;
```

Only `SET LOCAL`, never session-level `SET`. A separate owner role is used only by the migration runner and the cron service. `auth.uid()` is a shim reading `request.jwt.claim.sub`, exactly as the PGlite tests already do, so migrations 01–08 keep working and the `current_user in ('authenticated','anon')` trigger guards keep firing.

**D2 — Better Auth, subject to a spike (Phase 4); small custom auth as fallback.**
Better Auth is open source, runs inside the Next.js app and stores users and sessions in our Postgres. Auth.js is now part of the Better Auth project, and Better Auth joined Vercel in July 2026 with a stated commitment to stay framework- and platform-agnostic. That is intent, not a license guarantee: the spike re-checks the license and that nothing depends on Vercel. Its username plugin supports username + password sign-in (docs show v1.7.x). The spike must prove, with tests:

1. works with Next.js 16.4 and the plain `pg` driver, deployed on a non-Vercel Node server;
2. username sign-in; **public sign-up impossible** (endpoint disabled or blocked, tested); staff created only by a manager;
3. user IDs are UUIDs so `staff.user_id` and `auth.uid()` work unchanged (email, if required by the library, stays a synthetic internal address);
4. deactivation revokes all sessions immediately; manager password reset;
5. login rate limiting configured and tested (closes F1);
6. MIT (or equally permissive) license confirmed for the pinned version.

Fail any one → custom implementation from `MIGRATION_PLAN.md` §6 D2-fallback.

**D3 — Photos upload through the server, view through 30-minute signed links (unchanged).** Upload rules that today live in Supabase storage policies (migrations **04 and 08**) move into a SQL helper plus server checks.

**D5 — Plain SQL migrations with a ~40-line runner (unchanged)**, `schema_migrations` table and an advisory lock, run by the owner role as a pre-deploy step. This also gives us the migration history Supabase never had.

**D6 — Environments:** `staging` (only while testing; switched off otherwise) and `production`. Separate credentials; no shared secrets. Preview-style environments get no owner credentials.

**D7 — Runtime:** pin Node 22 (CI already uses it) for build and runtime **(verify Railway's Node selection in Phase 7)**.

## 7. Backups and recovery

| Layer | What | Where | Retention |
|---|---|---|---|
| 1 | Encrypted `pg_dump` every 6 hours (RPO ≈ 6 h) | Off-platform EU bucket (Cloudflare R2 or Backblaze B2; choose in Phase 6 after reading its DPA) | 14 days of 6-hourly + 12 monthly; never longer than the hotel's retention policy allows |
| 2 | Photo copy (new/changed objects, daily) | Same off-platform bucket, encrypted | Mirrors bucket deletions after the retention window |
| 3 | Railway native volume backups | Railway | If available on Hobby (verify); convenience only |

Restore drill before launch and every quarter; RTO measured in the drill. Encryption key is stored outside Railway and outside the backup bucket. **The hotel's management gets read-only access to the backup bucket and the decryption procedure**, so the data is recoverable without the developer (continuity, §9).

## 8. Data protection (engineering view, not legal advice)

- **Roles:** for the pilot the hotel is the controller. Railway, the backup provider and the uptime monitor are processors/sub-processors. If the app is later offered to other hotels, the developer becomes each hotel's processor and needs a written processing agreement with each.
- **Location:** data at rest in Amsterdam (EEA). Railway's DPA says its primary processing operations are in the United States; transfers are covered by the EU-U.S. Data Privacy Framework (UK Extension) and the EU SCCs with the UK Addendum. The DPA applies to every plan but is executed through Railway's DocuSign form (Phase 14).
- **Data minimisation already in place:** customers give only name + booking ID; items reference reservation numbers; sensitive items cannot be photographed; EXIF/GPS stripped; enquiries purge after closing; full audit trail.
- **Still open:** Q5 photo retention (30 days after an item closes is the proposal; **not enforced until the hotel approves**); hotel sign-off on EEA hosting with US processing; breach-notification contact and timing.

## 9. Known weaknesses we accept (and their mitigations)

| Weakness | Mitigation |
|---|---|
| Single Postgres container, no failover, no SLA on Hobby | 6-hourly off-platform dumps; tested restore; external uptime alert |
| Only the developer can access Railway (Hobby) | Hotel-accessible backups + written handover runbook; Pro when a second person needs access |
| You operate Postgres (minor updates, vacuum, upgrades) | ~1–2 h/month checklist in the ops runbook; pinned major version |
| Bucket has no versioning or backups | Off-platform photo copy; delete protection via app rules (manager-only delete) |
| Hard limit takes the site offline | Limit set well above expected usage, alerts at 75/90/100% |
| Bot answer on Hobby is not contractual | Saved evidence; re-check Terms before each plan decision |

## 10. Cost estimate (validate with a week of staging metrics)

| Component | Typical month |
|---|---|
| web (~0.3 GB RAM, ~0.03 vCPU) | ≈ $3.50 |
| Postgres (~0.25 GB RAM, ~0.02 vCPU, 1 GB volume) | ≈ $3 |
| cron runs, bucket (< 5 GB), egress | < $1 |
| **Railway total** | **≈ $6.50–8** → billed as $5 plan + overage |
| Off-platform backup bucket | $0–1 (free tiers) |
| Domain | ≈ £10–15/year |
| Staging while switched on | + a few dollars per active week |

Estimates, not quotes: per-unit prices are from Railway's plans page (RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB).

## 11. Decision log

| ID | Decision | Status |
|---|---|---|
| H1 | Railway all-in, portable design, EU West | **Approved** |
| H2 | Hobby for the single-hotel pilot; Pro before a second hotel or second operator | **Resolved** (evidence off-repo) |
| D1 | DB rules stay; `pg` + `SET LOCAL ROLE` gateway | Approved |
| D2 | Better Auth if the Phase 4 spike passes; custom fallback | Pending spike |
| D3 | Server-side photo upload, 30-min signed view links | Approved |
| D5 | Plain SQL migrations + small runner | Approved |
| D6 | staging + production, separate secrets | Approved |
| D7 | Node 22 pinned | Approved, verify on Railway |
| Q5 | Photo deletion 30 days after item closes | **Open — hotel approval required before enforcement** |
| Q7 | Single hotel first; multi-hotel later on Pro with per-hotel agreements | Direction set |

## 12. Sources (checked 2026-10-18)

- Railway plans and pricing — https://docs.railway.com/pricing/plans
- Regions — https://docs.railway.com/deployments/regions
- PostgreSQL template — https://docs.railway.com/databases/postgresql
- Postgres major upgrades — https://docs.railway.com/databases/postgresql-major-upgrade
- Postgres backups — https://docs.railway.com/guides/postgres-backups-restores
- Storage buckets / billing — https://docs.railway.com/storage-buckets , https://docs.railway.com/storage-buckets/billing
- Cron jobs — https://docs.railway.com/cron-jobs
- Cost control — https://docs.railway.com/pricing/cost-control
- Terms (effective 2026-04-20) — https://railway.com/legal/terms
- Acceptable use — https://railway.com/legal/acceptable-use
- DPA — https://railway.com/legal/dpa
- Railway answer — https://station.railway.com/questions/is-hobby-allowed-for-an-internal-busines-08463624
- Better Auth username plugin — https://better-auth.com/docs/plugins/username
- Auth.js joins Better Auth — https://www.better-auth.com/blog/authjs-joins-better-auth
- Better Auth joins Vercel — https://better-auth.com/blog/better-auth-joins-vercel
