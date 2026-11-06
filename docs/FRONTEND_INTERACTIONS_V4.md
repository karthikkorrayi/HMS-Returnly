# FoundOra frontend interactions

Patch ID: foundora-interactions-v4-bdeba99
Reviewed Railway base: bdeba99c701146aaeb509b20cafb85950d21f616.
This update supersedes the theme and navigation-footer placement described in
the earlier workspace redesign document.

## Experience

A single root entry animation runs for 3.6 seconds on full document visits, with
a short exit transition and an accessible Continue now option. Client-side
navigation uses the lightweight route loading state, without replaying the
intro. Reduced-motion preferences are honoured. The underlying UI is inert only
while the JavaScript intro is active. A self-hosted no-script stylesheet removes
the overlay when JavaScript is disabled; it adds no inline CSP exemption.
Dark is the server-rendered and first-visit default, even on a light OS. A saved
Light or Dark preference remains authoritative across pages and tabs.

Desktop hotel branding appears once in the navigation header. The repeated
logo in the content header is removed; that header keeps hotel details and
account controls. Mobile uses one hotel logo beside navigation controls. The
application logo appears in the navigation footer and company page footer.
Existing uploaded hotel/standalone assets are retained. Centered dialogs have
explicit margins/insets and responsive height limits, with opening/closing
transitions; navigation remains a drawer rather than a centered modal.

The metrics selection has its own border and surface, separate from the action
board. Each metric keeps its existing independent detail dialog. The action
board has clearer hover/focus states and real work-group columns linking to the
management page. The item form has completion-aware section navigation, scoped
IDs, pending-state locking and a recovery message for an unconfirmed save. The
post-create item code is displayed once. Reusable dashboard, enquiry and email
confirmation IDs are generated per instance and associated labels/focus targets
are updated together.

## Work groups: /h/<hotel>/items/organise

Managers create, rename, delete and reorder columns. Item-management roles move
and reorder their own hotel's cards using mouse/touch grips, Move menus, and
arrow buttons. A property-scoped version check rejects stale concurrent edits;
Refresh board retrieves the current saved arrangement. Failed moves keep the
last confirmed data and show the backend error. Deleting a group returns cards
to Unassigned, never deleting lost items.

Groups are work organisation labels, not custody statuses. Moving a card does
not mark it stored, matched, shipped or returned, and never fabricates custody
events. Business status changes still use the existing item-record workflow,
with all role, secure-storage, witness and retention rules intact. Group tables
have RLS, read permissions for item-management roles, no guest access, and no
direct staff writes. The scoped RPC enforces permissions again.

The management view loads up to 1,000 ordered hotel items; if more exist it
explicitly shows the loaded/total limit. Group counters include all hotel items.
Search/status/group filters apply to that loaded view. The existing paginated
dashboard remains the way to browse older records beyond the loaded window.

## Apply

Use the supplied checksum-verified Bash script from a clean checkout. It fetches
and fast-forwards railway, makes a local backup branch, verifies the embedded
payload, checks the entire Git patch, then installs dependencies and runs the
checks. It never resets work, pushes, deploys or changes credentials.

Migration 20261106000023_action_groups.sql must run before the updated server.
Railway pre-deploy remains: node db/migrate.mjs --apply.
The optional --migrate-local flag loads existing .env.local and accepts only
matching local application/migration TCP databases with app_owner for migrations.
It refuses remote destinations and never uses destructive override flags.

## Evidence

The production build, lint (two existing database-test warnings), type checking
and all 101 existing unit tests pass. The complete database suite passes against
isolated PostgreSQL 18. New action-group tests also pass with PGlite and exercise
persistence, ordering, duplicate names, stale updates, tenant isolation, roles,
direct-write denial, deletion without item loss, and unchanged custody data.

Chromium verified a roughly four-second first-visit intro, default dark on a
light OS, saved Light persistence, centered desktop/mobile dialogs, actual
pointer dragging, persistence after reload, accessible Move controls, stale-tab
rejection/refresh, live form completion and real item save, one item-code chip,
zero duplicate IDs on the checked pages, contained mobile scrolling, touch drag
across columns, and the no-JavaScript overlay fallback. No page exceptions were
reported in the completed checks. Tests used synthetic local hotel data; no
production records or external emails were used. Review actual assets and
hosting through the normal staging workflow before publishing.
