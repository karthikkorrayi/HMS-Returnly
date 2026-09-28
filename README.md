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
6. **Run it:** `npm run dev`, then open it on a phone on the same network at `http://<your-computer-ip>:3000`. Camera capture needs HTTPS on most phones, so for photo testing deploy a preview (for example to Vercel, region `lhr1`) or use a tunnel.

### Real hotel data

Build and demo with the seeded `DEMO` property. Before real use:
- get written approval from the hotel's general manager for the data this holds (staff names, item photos, reservation numbers); and
- replace the demo property, rooms and storage locations with the hotel's own, and set the retention period to the hotel's policy.

## Checks

```bash
npm run lint
npm run typecheck
npm run test:db   # applies migrations in an in-memory Postgres and tests every role and workflow rule
npm run build
```

The same checks run in GitHub Actions on every push and pull request.

## Not built yet

- Guest-facing "I lost something" enquiry form (QR code or link)
- Screens for managers to edit rooms, storage locations and the retention period (use the SQL editor for now)
- Editing an item's description after logging
- Removing photos from storage automatically once an item is closed
- Offline logging for rooms with poor Wi-Fi
