# HMS Returnly — hotel lost & found

Housekeeping logs items left behind in rooms and public areas, with photos. The front desk matches each item to a reservation, records how it went back to the guest, and managers approve disposal of unclaimed items after the retention period. Every step is written to a custody log that can't be edited or deleted.

Built with Next.js 16 (App Router) and Supabase (Postgres, Auth, Storage), in a Supabase project of its own.

## Data rules

- **No guest names, emails or phone numbers are stored.** Guests are referenced only by the PMS reservation/confirmation number. Contacting guests happens in the PMS.
- **Sensitive items** (passports, ID, bank cards, medication) cannot be photographed, and must be stored in a secure location.
- **Valuable and sensitive items** need a second staff member as witness at handover. Disposal and donation always need a witness and a manager.
- Photos are resized and stripped of EXIF metadata (including GPS) on the device before upload. They live in a private bucket and are shown through 30-minute signed links.
- Every row is scoped to the signed-in staff member's hotel by row-level security. Status changes go only through database functions, which check the role and the allowed transitions.

## Roles

| | Housekeeping | Front office | Manager |
|---|:-:|:-:|:-:|
| Log items, add photos, store and move items | ✓ | ✓ | ✓ |
| Add and confirm possible owners (reservation numbers) | | ✓ | ✓ |
| Record contact, collection, posting and handover | | ✓ | ✓ |
| Dispose or donate after retention | | | ✓ |
| Delete photos, add and deactivate staff, reset passwords | | | ✓ |

## Item lifecycle

```
logged → stored → matched → guest_contacted → awaiting_collection → returned (in person, ID checked)
                                            → awaiting_shipping   → returned (posted, tracking number)
stored / matched / guest_contacted → disposed | donated   (manager, after retention date, with witness)
```

## Stay log and room checks

Until the PMS can be connected, front desk keeps a stay log in Returnly and housekeeping records a check of every room after departure. Any item found in a room can then be traced to the stays most likely to own it. API details: [docs/backend-api.md](docs/backend-api.md).

- **Rooms** (everyone): each room is *Occupied*, *Due out*, *Needs check*, *Check overdue* or *Ready*. After a departure, housekeeping opens the room and taps **Clean – no items found** or **Items found – log them** (which opens the item form linked to that check). No guest details are shown to housekeeping.
- **Stays** (front office, managers): check guests in and out, or import the PMS arrivals/in-house/departures report or a Google Sheet saved as CSV ([template](public/stays-import-template.csv)). Re-importing the same file is safe; corrections are logged. Guest surnames are stored only so a guest can later prove a booking; nobody can read them through the app or the API.
- **Likely owners** (front office, managers, on each item found in a room): stays in that room within the trace window, ranked with reasons. Each clean check since a guest left lowers their score, less so if the item was somewhere hard to see. **Add as possible owner** feeds the existing confirm → contact → handover flow. Staff decide; the score never does.
- **Settings** (managers): trace window, room check deadline, how long to keep stays and unclaimed items.
- **Retention:** `purge_expired_stays()` deletes stays older than the stay retention period. Schedule it daily (Setup, step 7).

## Setup

1. **Create a Supabase project** in the **London (eu-west-2)** region, under an organisation rather than a personal account.
2. **Apply the database.** Either:
   - with the [Supabase CLI](https://supabase.com/docs/guides/cli): `supabase link --project-ref <ref>`, then `supabase db push`, then run `supabase/seed.sql` for demo data; or
   - paste each file in `supabase/migrations/` into the SQL editor in filename order, then `supabase/seed.sql`.
3. **Turn off public sign-ups** in the project's Authentication settings ("Allow new users to sign up"). Staff accounts are created by managers only.
4. **Configure the app:** `cp .env.example .env.local`, then fill in the URL and keys from Project Settings → API.
5. **Create the first manager:**
   ```bash
   npm install
   npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager
   ```
6. **Run it:** `npm run dev` for the laptop. To try it on a phone on the same Wi-Fi, set `DEV_LAN_HOST` in `.env.local` to your computer's LAN IP, run `npm run dev:lan`, and open `http://<that-ip>:3000` on the phone. For a production-like test, `npm run build` then `npm run start:lan`.
7. **Schedule the stay clean-up** (once): Database → Extensions → enable `pg_cron`, then in the SQL editor run
   ```sql
   select cron.schedule('purge-expired-stays', '30 3 * * *', $$select public.purge_expired_stays()$$);
   ```

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

- Customer-facing lost property assistant (chat, booking check by confirmation number + surname, case tracking) — endpoints designed in [docs/backend-api.md](docs/backend-api.md)
- Automatic PMS sync (the stay import is the manual bridge; `stays.source = 'pms'` is reserved for it)
- Screens for managers to edit rooms and storage locations (use the SQL editor for now)
- Editing an item's description after logging
- Removing photos from storage automatically once an item is closed
- Offline logging for rooms with poor Wi-Fi
