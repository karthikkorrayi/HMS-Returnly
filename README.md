# HMS Returnly — hotel lost & found

Housekeeping logs items left behind in rooms and public areas, with photos. Customers send lost property enquiries from the public home page; Support staff investigate them and an Admin approves or rejects each claim. The front desk records how items go back to guests, and managers approve disposal of unclaimed items after the retention period. Every step is written to an audit log that can't be edited or deleted.

Built with Next.js 16 (App Router), PostgreSQL (row-level security does the access control), Better Auth (staff sign-in) and a private S3-compatible bucket for photos. Runs on Railway: one environment per stage (staging, production), each with its own database. Each installation serves one hotel, set up once through a first-time setup screen.

## Data rules

- **Items reference guests only by reservation number.** Customer enquiries hold the name and booking ID the customer typed (not verified), and are deleted a set time after they close (Settings). No emails or phone numbers are collected.
- **Customers never see hotel records.** The public pages return only their own enquiry's status and messages, after matching reference + booking ID. Matches, item details, internal notes and staff names are staff-only.
- **Sensitive items** (passports, ID, bank cards, medication) cannot be photographed, and must be stored in a secure location.
- **Valuable and sensitive items** need a second staff member as witness at handover. Disposal and donation always need a witness and a manager.
- Photos are resized on the device, and the server strips EXIF/XMP metadata (including GPS) before storing them in a private bucket. They are only shown through the app, after it checks the staff member may see that item.
- Every row is scoped to the signed-in staff member's hotel by row-level security. Status changes go only through database functions, which check the role and the allowed transitions.

## Roles

"Admin" in the app is the **manager** role.

| | Housekeeping | Front office | Support | Manager (Admin) |
|---|:-:|:-:|:-:|:-:|
| Log items, add photos, store and move items | ✓ | ✓ | | ✓ |
| Add and confirm possible owners (reservation numbers) | | ✓ | | ✓ |
| Record contact, collection, posting and handover | | ✓ | | ✓ |
| Read items (to investigate enquiries) | ✓ | ✓ | ✓ | ✓ |
| Customer enquiries: see | | | assigned to them | all |
| Enquiries: notes, ask the customer, mark ready for admin | | | ✓ | ✓ |
| Enquiries: assign, approve, reject, resolve | | | | ✓ |
| Dispose or donate after retention | | | | ✓ |
| Delete photos, staff (add, roles, passwords, access), settings, rooms and areas | | | | ✓ |

These rules are enforced in the database (row-level security, triggers and workflow functions) as well as in the pages; hiding a link is never the protection.

## Item lifecycle

```
logged → stored → matched → guest_contacted → awaiting_collection → returned (in person, ID checked)
                                            → awaiting_shipping   → returned (posted, tracking number)
stored / matched / guest_contacted → disposed | donated   (manager, after retention date, with witness)
```

## Customer enquiries

1. **Customer** (home page, no sign-in): gives their name and booking ID, describes the item in a guided chat, reviews the details and sends. They get a reference like `LF-3FA9C-81D2E`. On **Check an enquiry** (`/track`), reference + booking ID show the status and messages, and let them answer staff questions.
2. **Admin** (`/requests`): sees every enquiry with counts by status, search and filters; opens one to see the report, conversation, **possible matches** (strong / partial / weak, with reasons), internal notes and history; assigns it to Support.
3. **Support** (`/support`): works on the enquiries assigned to them — investigates matches, adds internal notes, asks the customer questions, and marks it **ready for admin review**.
4. **Admin decides.** Approving is always a person choosing a specific item; it adds the booking as a possible owner on that item. The item is only released through its own ID check and handover. Reject needs a reason. Resolve closes the enquiry.

Statuses: Pending review → Under investigation ⇄ Awaiting customer information → Awaiting admin confirmation → Approved / Rejected → Resolved.

The chat is a **rule-based guided form** (`src/lib/requests/assistant.ts`), labelled as such to customers. It's built so an AI assistant can replace it later without changing the pages — see [docs/backend-api.md](docs/backend-api.md).

### Rooms and Stays

The Rooms and Stays screens have been removed. Their tables (`stays`, `room_checks`, `stay_changes`) and data are kept; existing stays are still used by enquiry matching ("found in the room where this booking stayed").

## Setup

### Local development (Mac)

1. **PostgreSQL 17+** (Postgres.app) and **versitygw** for photos (`brew install versitygw`). Node 22 (`.nvmrc`).
2. `npm ci`, then `cp .env.example .env.local` and fill it in (database URLs come from the next step; secrets are generated locally and never committed).
3. `npm run db:local:setup`: creates `returnly_dev` (roles, every migration, the synthetic DEMO hotel). It finds your server from `DATABASE_URL` in `.env.local`; run it again after pulling new migrations.
4. `npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager` (asks for the password twice).
5. `npm run storage:local` (photo store) and `npm run dev`. On a phone on the same Wi-Fi: set `DEV_LAN_HOST` and `BETTER_AUTH_URL` to your Mac's IP, run `npm run dev:lan`, open `http://<that-ip>:3000`.

### Railway (staging and production)

- How each environment is configured, deployed and rolled back: [docs/RAILWAY.md](docs/RAILWAY.md).
- Installing a hotel from nothing, rehearsing it, and reinstalling safely: [docs/INSTALL.md](docs/INSTALL.md).

Deploys are automatic once CI passes (staging from `railway`; production from a release merge in Phase 8). Before each deploy Railway runs the new migrations; data is never reset by a deploy, and the first-time setup only appears for an empty database.

### Real hotel data

Staging only ever holds made-up data. Before real use (production): written approval from the hotel's general manager for the data this holds (staff names, item photos, reservation numbers, guest names and booking IDs in enquiries), and retention periods set to the hotel's policy.

## Checks

```bash
npm run lint
npm run typecheck
npm test          # unit tests in tests/
npm run test:db   # db/tests: applies the bootstrap and migrations in an in-memory Postgres and tests every role and workflow rule
# Same tests on a real local PostgreSQL (CI uses 18). Each suite makes and drops its own database:
TEST_DATABASE_URL=postgresql://postgres@localhost:5433/postgres npm run test:db
npm run build
```

The same checks run in GitHub Actions on every push and pull request.

## Not built yet

- AI chat assistant (the rule-based guided form is in place; see docs/backend-api.md for the integration contract)
- Email to customers (enquiry reference and replies) and a handover code (OTP): planned after setup; needs a mail provider with an EU option and a data-processing agreement
- Automatic PMS sync for bookings
- Editing an item's description after logging
- Removing photos from storage automatically once an item is closed
- Offline logging for rooms with poor Wi-Fi
