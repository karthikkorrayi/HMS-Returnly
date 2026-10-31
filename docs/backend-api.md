# Backend API — stays, room checks and lost item tracing

> Written for the original Supabase version. On Railway the same database functions are called through the app's data layer (`src/lib/db`: `withStaff()` / `withAnon()`, `tx.rpc('…')`) instead of `supabase.rpc`; their names, arguments and rules are unchanged.

Supabase is the single source of truth. Three kinds of endpoint:

- **Reads** go through Supabase's REST API (`supabase.from('…').select()`), filtered by row-level security to the signed-in staff member's hotel and role.
- **Every change** goes through a Postgres function (`supabase.rpc('…')`). Each one checks the role, validates the data and writes its history in one transaction. Tables are not writable directly.
- **Anything needing secrets or outside services** (email, a PMS connection) belongs in a Supabase Edge Function or a Next.js server action that calls the functions below.

## Data model

| Table | One row per | Notes |
|---|---|---|
| `properties` | hotel | Settings: `trace_window_days`, `check_due_hours`, `stay_retention_days`, `retention_days` |
| `rooms` | room | Room numbers are validated against this list everywhere |
| `stays` | guest stay in one room | A room move is two rows with the same `reservation_ref`. `guest_surname` is not readable through the API. `source`: `manual`, `import`, or `pms` (reserved for automatic sync) |
| `stay_changes` | change to a stay | Who changed what and when; never contains the surname |
| `room_checks` | housekeeping check | `departure` (one per departed stay), `recheck` or `deep_clean`; outcome `clean` or `items_found` |
| `lost_items` | found item | `room_check_id` links it to the check it was found in; `found_spot` + `spot_hidden` describe where |
| `guest_candidates` | possible owner of an item | `stay_id` links to the stay it was traced from |
| `custody_events`, `handovers` | item history, return | Unchanged |

## Status logic

```
Stay:        in_house ──check_out_guest──► departed          (or cancel_stay → cancelled)
                                              │
Room board:  occupied / due_out ─────────────►│ needs_check ──(after check_due_hours)──► check_overdue
                                              │       │
                                   record_room_check(clean | items_found)
                                              ▼
                                            ready
Item:        logged → stored → matched → guest_contacted → awaiting_* → returned
                       │                                                   (or disposed / donated)
                       └─ trace_item_owners ranks stays → add_candidate_from_stay → confirm_candidate
```

Room status is computed live from stays and checks, so there is nothing to keep in sync.

## Ownership tracing

`trace_item_owners(item)` looks at stays in the item's room that overlap the window from `trace_window_days` before the find up to the find. It returns at most 20, highest score first, each with plain-language reasons.

| Situation | Score |
|---|---|
| Item found during the departure check that followed this stay | 98 |
| Guest checked in to the room when it was found (probably not lost) | 95 |
| Otherwise | 90 − 20 per later stay − 25 per clean check since the guest left (10 if `spot_hidden`), minimum 5 |

An in-house stay past its check-out date is treated as "may have left without checking out", not as "in the room". Items found in public areas are not traced. Results are computed when asked, so late or corrected stay data is picked up automatically.

## Staff endpoints for stays and room checks (built; screens removed, functions kept)

| Role | Call | Does |
|---|---|---|
| Front office, manager | `check_in_guest(room, ref, surname, check_out_date, check_in_date?)` | Creates an in-house stay; rejects unknown rooms and overlapping stays |
| Front office, manager | `check_out_guest(stay_id)` | Marks departed now; the room then needs a check |
| Front office, manager | `cancel_stay(stay_id, reason)` | For entries made by mistake |
| Front office, manager | `import_stays(rows jsonb)` | Up to 2,000 rows from a CSV; matched on reservation + room, so re-imports update rather than duplicate; bad rows reported, not fatal |
| Everyone | `room_board()` | Every room's status, no guest details |
| Everyone | `record_room_check(room, outcome, type?, stay_id?, note?)` | Records a check; a departure check links to the latest unchecked departure |
| Everyone | insert into `lost_items` with `room_check_id`, `found_spot`, `spot_hidden` | Logs an item from a check (validated against the check's room) |
| Front office, manager | `trace_item_owners(item_id)` | Ranked likely owners |
| Front office, manager | `add_candidate_from_stay(item_id, stay_id, note?)` | Adds a traced stay as a possible owner |
| Manager | `update_property_settings(trace_days, stay_retention_days, check_due_hours, item_retention_days)` | Hotel settings |
| Scheduled job only | `purge_expired_stays()` | Deletes stays past retention (schedule with pg_cron) |

Reads used by the app: `stays` (front office and managers, without the surname), `stay_changes`, `room_checks`, `lost_items`, `guest_candidates`.

## Getting stays in

The Stays page (check-in/out and CSV import) has been removed from the app. The database functions remain, so stays can still be loaded — and enquiry matching can use them — via:

1. **SQL / script:** call `import_stays(rows jsonb)` as a front office or manager user (same validation, duplicate-safe).
2. **Later (PMS):** a scheduled Edge Function pulls arrivals and departures from the PMS API and calls `import_stays` with `source = 'pms'`. No schema change is needed.

## Customer enquiries (built — migrations 0007–0008)

Tables: `customer_requests`, `request_messages` (customer-visible conversation), `request_notes` (staff only), `request_events` (audit). Staff read them under row-level security: Admin (`manager`) sees all, `support` sees only requests assigned to them. All writes go through functions.

**Public (no sign-in, `anon`)** — validated, rate-limited, and returning only the customer's own enquiry:

| Call | Does |
|---|---|
| `public_properties()` | Hotel names for the enquiry form |
| `submit_customer_request(inn_code, name, booking_ref, item_name, description, category?, colour?, brand?, lost_location?, lost_date?)` | Creates the enquiry; returns a random reference `LF-XXXXX-XXXXX`. Max 5 per booking per day, 300 per hotel per hour |
| `customer_request_status(reference, booking_ref)` | Status, item name as typed, and the conversation. No items, matches, notes or staff names |
| `customer_reply(reference, booking_ref, body)` | Adds a customer message; moves "Awaiting customer information" back to investigation. Max 20 a day |

**Staff**

| Role | Call | Does |
|---|---|---|
| Admin | `assign_request(id, staff_id \| null)` | Assign to an active Support or Admin member |
| Admin, assigned Support | `set_request_status(id, status, note?)` | Support: → under investigation, → awaiting admin. Admin: everything except approve (below); reject needs a reason; resolve only after approve/reject |
| Admin | `approve_request(id, item_id, note?)` | Explicit decision tied to one item; adds the booking as a possible owner on the item. Does **not** release the item |
| Admin, assigned Support | `message_customer(id, body, ask?)` | Message shown to the customer; `ask = true` → Awaiting customer information |
| Admin, assigned Support | `add_request_note(id, body)` | Internal note |
| Admin, assigned Support | `match_request_items(id)` | Ranked open items: type +30, brand +20, colour +15, shared words +5 each (max 25), found in the booking's room during/after its stay +25 (uses `stays`), within 3 days of the date given +10. Strong ≥ 60, partial 35–59, weak 15–34; shown capped at 100. A guide, never proof |
| Admin | `update_request_settings(retention_days)` | Retention for closed enquiries |
| Scheduled job | `purge_closed_requests()` | Deletes rejected/resolved enquiries past retention |

Support staff can read items but a trigger blocks them from creating or changing items, photos, possible owners, stays or room checks.

## AI assistant integration (later)

The customer chat runs on `EnquiryAssistant` (`src/lib/requests/assistant.ts`); today that's `ruleBasedAssistant` plus keyword extraction (`extract.ts`). An AI version must:

- implement the same `start` / `respond` interface and end in the same reviewed `EnquiryPayload` (`src/lib/requests/types.ts`), which the customer confirms before anything is sent;
- run on the server (API keys never in the browser) and only ever receive what the customer typed — never item records, matches or other customers' data, so a prompt-injected model has nothing to leak;
- ask clarifying questions when fields are missing, but never say an item has been found, decide ownership, or approve anything — matching and decisions stay in `match_request_items` and with staff.
