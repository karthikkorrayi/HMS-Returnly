# FoundOra service redesign

Patch ID: foundora-service-v1-ac967b8

The patch extends the existing Railway application. It adds theme-specific
platform assets, default and optional dark hotel logos, guest guidance editing,
2.4-second pending indicators, response reveals, compact staff help, updated
hotel-service copy, split light/dark emails, and real-event notification toasts.
Notification history remains in Postgres. A single visible-tab poller refreshes
within five seconds and after successful actions; history refreshes while open.
Guidance is explicitly a local rule-based form, not live staff or AI chat.
Editing a previous answer discards subsequent questions and answers so stale
item details cannot be submitted. Booking fields remain editable.

## Apply and deploy

The supplied Bash script validates the correct GitHub repository and logo files,
pulls railway with fast-forward-only, checks patch applicability, preserves the
starting commit in a backup branch, and applies the code directly. It never
invokes an AI tool, pushes, deploys, or connects to a remote database.
Logo files are copied to public/branding with extensions selected from their
actual image signatures. They are the two files supplied by the operator.

Review the diff, then use the normal CI and Railway deployment process.
Railway must retain `node db/migrate.mjs --apply` as its pre-deploy command;
the additive migration 20261105000021_dark_hotel_logo.sql must run before the
new application serves requests. The existing migration runner applies it once.
For an independently managed deployment, use the existing documented migration
process with the app_owner connection. Do not change already-applied migrations.

Existing Postgres, Better Auth, S3, and email-worker configuration is retained.
Hotel uploads require the existing private photo bucket credentials. Brevo
sending still uses the existing email worker; this patch does not send email.
Logo management is at Settings → Branding and is restricted to managers.
Default uploads back transparent images with white; dark uploads use navy.
Both are processed as metadata-stripped JPEGs using the existing storage pipeline.

## Validation

Run npm ci, npm run lint, npm run typecheck, npm test, npm run test:db,
and npm run build. The script runs these commands, stopping on failure.
Without TEST_DATABASE_URL, database tests use PGlite and report skipped checks.
With a local PostgreSQL TEST_DATABASE_URL, the full role/pool/auth suite runs.
Never point tests at a live hotel database.

Validation during preparation: production build and type checking passed;
101 unit tests passed; full PostgreSQL 18 database suite passed, including eleven
new dark-logo persistence, cache version, authorization and isolation assertions.
Lint passed with two pre-existing database-test warnings. Chromium checks passed
for theme switching, guest guidance edits, enquiry rewind, typing states, mobile
overflow, staff login/help, real report notification toasts, live history updates,
and dark-logo preview/cancel, with no browser page errors in those checks.
Browser image checks used temporary local fixtures; supply the actual FoundOra
assets when applying the script. S3 uploads were exercised through the existing
mocked-store database tests, not against the Railway bucket. Email templates were
tested without delivery; rendering in individual mail clients still needs a
staging check. No production records or external emails were used.

For local testing, use the same hostname in BETTER_AUTH_URL and your browser.
Mixing localhost and 127.0.0.1 can make the existing Next.js rewrite perform a
second request and lose hotel routing metadata. No authentication rules were
weakened to work around this.
