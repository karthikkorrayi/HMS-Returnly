# Interactive hotel workspace

Patch ID: foundora-workspace-v3-fdd552f
Base reviewed: railway at fdd552fcb1c2b46801100762f65110ebd9cbbbf4.

## Behaviour

Hotel branding and details move to the header. The desktop sidebar supports
labelled and icon-only states, with accessible names in either state. Its footer
shows only the independently uploaded hotel mark. Without a mark, the hotel
initial is shown; a full wordmark is never automatically cropped. Company
branding and details appear in the page footer. Sign-in uses the same separation.
On mobile the header branding is the hotel logo, with navigation in a drawer.
The top-right profile opens account details, role permissions, password change,
and sign-out. Notifications open an authorised live list and link to history.
Roles that do not receive request notifications see that explained, without
receiving private request data. Support retains its own authorised request
dashboard; other staff land on the item dashboard. Explicit sign-in return
addresses and all server-side role checks remain intact.

Metric buttons load hotel-wide details independently of board filters. They show
the count, up to ten matching items, and an explicit link to the full list.
Opening a metric never changes the action board. Metrics sit above the board;
guidance remains separately available beneath it. Category and value-tier filters
are applied in SQL before counting/pagination; hotel-wide metrics stay unchanged.
Existing status, search and request filters remain in use. Staff have name,
username, role and access filters. Notification history, email logs and access
logs have search/type/status/date filters where applicable. Those record filters
operate on the explicitly labelled loaded windows (50 notifications, 50 emails,
100 access records), not an unbounded historical search. Dates are labelled UTC.

Staff creation opens in a dialog. Staff rows open IAM-style profiles containing
available identity fields, hotel scope, active status, assigned permissions and
existing management actions. Passwords/hashes are never listed. No unsupported
last-login or audit metadata is fabricated. Own-role/self-deactivation controls
and cross-hotel boundaries remain enforced by the existing backend.

Settings, branding, rooms and storage start read-only. Edit enables controls;
Cancel restores the current server values. Successful form saves close edit
mode; failures preserve edits and display the backend error. Uploads preview
before Save, lock editing while in flight, and leave edit mode only after a
confirmed save. Full, optional dark and standalone logo slots are independent.
Uploaded logos remain public branding assets; item photos stay private.

## Migration and use

The additive migration 20261106000022_hotel_standalone_mark.sql must be applied
before running the new server. It adds the standalone file pointer and scoped
manager/public branding functions. Existing applied migrations are unchanged.
Keep Railway's pre-deploy command: node db/migrate.mjs --apply.

The Bash script updates a clean checkout of the correct GitHub repository,
fetches/pulls railway with fast-forward-only, preserves the starting commit in a
backup branch, checks the complete patch, then applies it. It invokes no AI tool,
pushes nothing, changes no credentials and performs no remote database migration.
Existing platform and hotel logo assets are retained. Review changes before
using the existing CI/deployment workflow.

Optional --migrate-local loads the existing .env.local and applies pending
migrations only when DATABASE_URL and MIGRATION_DATABASE_URL identify the same
local TCP database and the owner URL uses app_owner. It refuses remote hosts and
host overrides. It never bootstraps/drops a database or uses destructive flags.
Without the option, migration execution is left to the documented deployment
process. Restart local servers after applying code and migrations.

## Validation

The implementation passed lint (two pre-existing database-test warnings), type
checking, the 101 existing unit tests, production build, and the full database
suite on both PGlite and isolated PostgreSQL 18. New database assertions exercise
standalone logo storage, removal, independence and tenant/role isolation, plus
combined parameterised item filters before pagination and count independence.
PGlite still reports explicit skips for checks that require real Postgres;
PostgreSQL-backed validation exercised those paths separately.

Chromium checks exercised desktop sidebar collapse/expand, independent metric
details, server-side tier filtering, profile and notification dialogs, settings
read-only/Edit/Cancel/persisted Save, staff creation/deactivation and directory
filters, both logo uploads through the app to a local S3 fixture, mobile
navigation, sign-in branding, company footer, metric dialogs in both themes,
keyboard Escape, filter reset and role-specific landing/access boundaries.
Those checks reported no browser page errors. Image fixtures and synthetic
accounts were used; no real hotel records, Railway bucket or external email was
touched. Staging should still verify the actual hotel assets and hosting setup.

The existing rate-limit unit test used to reject a valid random hex digest when
it happened to contain the substring 203. It now checks a deterministic HMAC
reference vector and retains the visitor/bucket/secret separation assertions.
The application rate limiter is unchanged.
