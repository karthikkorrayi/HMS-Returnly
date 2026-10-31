# Installing a hotel — install, rehearse, reinstall

One installation = one hotel = one Railway environment with its own database
and photo bucket. Installing happens **once** per environment; deploys after
that only update the app (the database and its records are untouched).

Settings and variables referred to here are listed in [RAILWAY.md](RAILWAY.md).

## When does the setup screen appear?

Only when that environment's database has **no hotel yet**. The database
records "set up" in the same step that creates the hotel and first
administrator, and refuses a second setup. So the setup screen appears:

| Situation | Setup screen? |
|---|---|
| Normal deploy (design, features, fixes) | No |
| New migration on deploy | No (migrations only add) |
| Restoring a backup of that database | No (the backup includes the hotel) |
| A brand-new environment / a new, empty database | **Yes**: that is an installation |
| Someone opens `/setup` on a set-up hotel | No: "This hotel is already set up" |

## Install a new environment from nothing

About 30 minutes. Do it for staging first; production only at launch.

1. **Railway** (project `hms-returnly`, region EU West): create the environment
   (or use the existing one), add **PostgreSQL** (18) and a **Bucket** named
   `photos`, both in EU West. Turn on the database's backups (Hobby plan).
2. **Database roles** (from your Mac, repo root):
   Postgres → Networking → public networking **on** → copy `DATABASE_PUBLIC_URL` →
   `bash ~/ReturnlyDev/scripts/railway-db-setup.bash` (creates database
   `returnly`, the roles, random passwords; writes them to a private file) →
   paste the 4 lines into that environment's **Shared Variables** →
   public networking **off** → `bash ~/ReturnlyDev/scripts/railway-db-setup.bash --forget`.
3. **Web service** `web`: region EU West, variables from RAILWAY.md (port
   **5432**, host `postgres.railway.internal`, database `returnly`, one user
   per variable), pre-deploy `node db/migrate.mjs --apply`, health check
   `/api/health`, source = this repository and the environment's branch,
   **Wait for CI** on, generate a domain.
4. **First deploy**: pre-deploy log ends `done: 13 applied` (or more);
   `https://<domain>/api/health` → `{"status":"ok"}`.
5. **Setup key**: `openssl rand -hex 24` on your Mac → variable `SETUP_TOKEN`
   on `web` → deploy.
6. **First-time setup** on your phone: open `https://<domain>/` → setup screen.
   Enter the key, hotel (code is permanent), floors and rooms (`101-120`
   ranges), areas, storage places, guest support details, first administrator.
7. **Sign in** as that administrator → add staff on the Staff page.
8. **Delete `SETUP_TOKEN`** from the variables.
9. Run the **checklist** below.

## Rehearse it without touching an environment (local)

To check the setup flow after a change, on your Mac:

```bash
npm run db:local:setup -- --database returnly_fresh --no-seed   # an empty installation
```

Then run the app against it: in `.env.local` temporarily point the three
database URLs at `returnly_fresh` (keep a copy of the old lines), add
`SETUP_TOKEN=<24+ random characters>`, `npm run dev`, open the app → setup
screen. Put the old lines back afterwards. The empty database can be dropped
when you're done: `dropdb -p 5433 returnly_fresh` (local only; your
`returnly_dev` is not touched).

## Reinstall an existing environment

"Reinstall" means starting that environment's hotel again from an empty
database. It is **never needed for updates**, and on production it means
losing the hotel's records, so it needs an explicit decision (and a backup
first). Prefer the additive way, which keeps the old database until you're sure:

1. **Back up** the current database (Railway backup, plus a `pg_dump` once the
   off-platform backup exists).
2. Add a **new** PostgreSQL service in the same environment (e.g. `Postgres2`),
   EU West. Do not delete the old one.
3. Run step 2 of the install against the new database (new passwords → update
   the Shared Variables).
4. In `web`'s variables, change the database service name in the three
   references (`${{Postgres2.RAILWAY_PRIVATE_DOMAIN}}`) → deploy. The
   pre-deploy creates every table; the site now opens the setup screen.
5. Steps 5–9 of the install.
6. **Rollback**: point the three references back at the old service and deploy.
   Delete the old database only when the new one has been in use for an agreed
   time (and never without saying so explicitly).

The photo bucket can stay: photos are stored under the hotel's id, so a new
hotel never sees the old one's photos.

## Checklist after installing (and the staging rehearsal)

Run on a phone, on the environment's address. Made-up data only on staging.

**Install**
- [ ] `/` and `/login` lead to setup; wrong key → "The setup key is not correct", form keeps its contents
- [ ] a mistake (e.g. a room on two floors) is named exactly, form keeps its contents
- [ ] setup completes → sign-in page says "Setup is complete. Sign in as …"
- [ ] `/setup` now says "already set up"; `SETUP_TOKEN` deleted

**Staff and sign-in**
- [ ] administrator signs in; header shows the hotel and "Manager"
- [ ] add a housekeeper; they sign in and see Dashboard / Log item only
- [ ] make someone a manager → they can open Settings; your own role can't be changed
- [ ] 10 wrong passwords lock that username; a manager's new password clears it
- [ ] change your own password (Account) → other devices are signed out

**Hotel configuration**
- [ ] Settings: change the phone → guest page shows it under "Prefer to talk to someone?"
- [ ] Floors and rooms: add a floor and rooms (`301-305`), retire one, delete an unused one
- [ ] Areas and storage: add one, retire one; a place holding items can't be retired

**Daily work**
- [ ] Log item with a photo (room) → photo shows on the item page
- [ ] Log item in a public area → only active areas are suggested; a retired room is refused
- [ ] store it, match a guest, record a handover
- [ ] guest page: send an enquiry → reference; `/track` shows it; staff reply → customer sees it

**Deploy safety**
- [ ] merge a small change → Railway waits for CI → deploys → records and setup unchanged
- [ ] `/api/health` → `{"status":"ok"}`

## Not covered yet (before production)

- Scheduled clean-ups (expired stays, closed enquiries): were `pg_cron` on
  Supabase; on Railway they become a scheduled job (Phase 6).
- Off-platform backups with a timed restore drill (Phase 6), and photo backups.
- Rate limits on `/track` lookups and enquiry submissions (Phase 6).
