# Foundora redesign for the uploaded railway ZIP

This version targets the attached `HMS-Returnly-railway.zip`, not the main branch.

## Architecture verified

- Next.js 16.4.2 / React 19.2.4, npm with package-lock.json, Node 22 (.nvmrc).
- PostgreSQL: src/lib/db/index.ts and core.ts; withAnon / withStaff retain role and tenant boundaries.
- Better Auth: src/lib/better-auth/, src/lib/auth.ts, existing /api/auth/[...all] route, login form and finishSignIn action.
- Private S3 photos: src/lib/storage/ and existing photo API routes.
- Customer enquiries: original EnquiryChat, TrackEnquiry, public-actions, public-queries and assistant state machine.
- Hotel names: existing listHotels/public_properties; contacts: publicContacts/public_hotel_contacts. No new hotel environment variables or duplicate configuration.
- Existing first-time setup, manager navigation, Support role, own-password controls and server-side permissions remain.
- Existing nonce CSP is preserved; theme bootstrap uses its request nonce.

There is no Supabase integration on railway. Do not create src/lib/supabase/server.ts or add Supabase keys for this redesign.

## Running the delivery script

Edit PROJECT_DIR and LOGO_FILE at the top of apply-foundora-railway.sh to your actual project and PNG/JPEG/WebP file. Defaults match the paths supplied in chat. Save the script outside the checkout and run `bash apply-foundora-railway.sh` without arguments. PNG/JPEG/WebP artwork is embedded locally; no network branding service is used. The project root must contain the uploaded package.json, package-lock.json, src/, and db/ structure.

The script validates the uploaded architecture and required paths/hashes before changing source. Conflicts are reported instead of overwritten. It makes persistent timestamped backups in a sibling `foundora-backups` folder and writes restore.sh. Existing environment files, dependencies, lockfile, auth implementation, APIs, photo integration and database files are not changed. Dependency installation uses npm ci. The database validation always uses the repository's in-memory PGlite mode, not your configured database. It does not run migrations or local database setup on your machine.

After successful validation, run `npm run dev` from PROJECT_DIR. Keep your existing `.env.local`/Railway environment configuration: DATABASE_URL (app_user), AUTH_DATABASE_URL (auth_service), BETTER_AUTH_URL, BETTER_AUTH_SECRET, plus your existing storage/migration variables as applicable. The script reports missing runtime variable names without values and does not invent credentials. Production uses `npm run build` and the repository's normal start command. See existing docs/INSTALL.md and docs/RAILWAY.md for backend provisioning.

`/signin` re-exports the existing `/login` page. `/login`, sign-out redirects, setup completion, rate limiting, cross-site checks, safe next destinations and role-specific landing behavior stay compatible. Homepage has no staff sign-in option. Navigation still uses the original role map; the duplicated dashboard quick-action card is removed.

## Customer experience

The guest homepage fits common desktop, tablet and mobile viewports. Very short screens or enlarged text retain scrolling for access. The main service panel scrolls independently when needed.

The floating support window offers contextual guidance and the ORIGINAL enquiry assistant. “Report a lost item” opens that existing form; it gathers details, lets the customer review them, submits through the existing server action and returns the real enquiry reference. “Check an enquiry” opens the original tracking page, which still requires reference AND booking ID. No fake success states or duplicate request APIs are introduced. Guided support is rule-based (the existing assistant architecture); no external generative AI service is configured. Switching theme does not reset an enquiry. Closing and reopening support preserves the in-tab form; reload/navigation lifecycle follows normal app behavior, without storing personal details in local storage.

Light/dark preference uses local storage when available, follows the system until selected and synchronizes across tabs. Existing semantic tokens adapt staff forms, panels, status badges and dialogues. Exact supplied logo stays on a neutral plate.

## Verification scope

The delivered script runs lint, typecheck, npm test, test:db (PGlite), and build. Existing lint warnings are reported without changing unrelated tests. Validation against disposable PostgreSQL and the browser is performed separately during development; your actual Railway service, bucket and records are not contacted by the installer. Any local configuration issues reported by the script need to be resolved using the existing backend documentation, not by creating assumed Supabase files.
