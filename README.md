# HMS Returnly — hotel lost & found

Housekeeping logs items left behind in rooms and public areas, with photos. Customers send lost property enquiries from the public home page; Support staff investigate them and an Admin approves or rejects each claim. The front desk records how items go back to guests, and managers approve disposal of unclaimed items after the retention period. Every step is written to an audit log that can't be edited or deleted.

Built with Next.js 16 (App Router) and Supabase (Postgres, Auth, Storage), in a Supabase project of its own.

## Data rules

- **Items reference guests only by reservation number.** Customer enquiries hold the name and booking ID the customer typed (not verified), and are deleted a set time after they close (Settings). No emails or phone numbers are collected.
- **Customers never see hotel records.** The public pages return only their own enquiry's status and messages, after matching reference + booking ID. Matches, item details, internal notes and staff names are staff-only.
- **Sensitive items** (passports, ID, bank cards, medication) cannot be photographed, and must be stored in a secure location.
- **Valuable and sensitive items** need a second staff member as witness at handover. Disposal and donation always need a witness and a manager.
- Photos are resized and stripped of EXIF metadata (including GPS) on the device before upload. They live in a private bucket and are shown through 30-minute signed links.
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
| Delete photos, add and deactivate staff, settings | | | | ✓ |

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

1. **Create a Supabase project** in the **London (eu-west-2)** region, under an organisation rather than a personal account.
2. **Apply the database.** Either:
   - with the [Supabase CLI](https://supabase.com/docs/guides/cli): `supabase link --project-ref <ref>`, then `supabase db push`, then run `supabase/seed.sql` for demo data; or
   - paste each file in `supabase/migrations/` into the SQL editor in filename order, then `supabase/seed.sql`.
   Run `…000007_support_role.sql` on its own, before `…000008`: Postgres can't use a new role value in the same run that adds it.
3. **Turn off public sign-ups** in the project's Authentication settings ("Allow new users to sign up"). Staff accounts are created by managers only.
4. **Configure the app:** `cp .env.example .env.local`, then fill in the URL and keys from Project Settings → API.
5. **Create the first manager:**
   ```bash
   npm install
   npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager
   ```
6. **Run it:** `npm run dev` for the laptop. To try it on a phone on the same Wi-Fi, set `DEV_LAN_HOST` in `.env.local` to your computer's LAN IP, run `npm run dev:lan`, and open `http://<that-ip>:3000` on the phone. For a production-like test, `npm run build` then `npm run start:lan`.
7. **Schedule the clean-ups** (once): Database → Extensions → enable `pg_cron`, then in the SQL editor run
   ```sql
   select cron.schedule('purge-expired-stays', '30 3 * * *', $$select public.purge_expired_stays()$$);
   select cron.schedule('purge-closed-requests', '40 3 * * *', $$select public.purge_closed_requests()$$);
   ```
8. **Create Support staff** on the Staff page (role: Support), then assign enquiries to them from Customer requests.

### Real hotel data

Build and demo with the seeded `DEMO` property. Before real use:
- get written approval from the hotel's general manager for the data this holds (staff names, item photos, reservation numbers and guest surnames in the stay log); and
- replace the demo property, rooms and storage locations with the hotel's own, and set the retention period to the hotel's policy.

## Checks

```bash
npm run lint
npm run typecheck
npm test          # unit tests in tests/
npm run test:db   # applies migrations in an in-memory Postgres and tests every role and workflow rule
npm run build
```

The same checks run in GitHub Actions on every push and pull request.

## Not built yet

- AI chat assistant (the rule-based guided form is in place; see docs/backend-api.md for the integration contract)
- Email notifications to customers when staff reply (customers check `/track` for now)
- Automatic PMS sync for bookings
- Screens for managers to edit rooms and storage locations (use the SQL editor for now)
- Editing an item's description after logging
- Removing photos from storage automatically once an item is closed
- Offline logging for rooms with poor Wi-Fi
