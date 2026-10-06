# Backend API — stays, room checks and lost item tracing

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

## Staff endpoints (built)

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

1. **Now (manual):** check-in/out on the Stays page, or import a CSV (the PMS report, or a Google Sheet via File → Download → CSV). Supabase is the source of truth: a sheet is only ever an input, never edited back.
2. **Optional automation of the sheet:** a Google Apps Script that posts new rows to an Edge Function, which calls `import_stays`. Same function, same validation.
3. **Later (PMS):** a scheduled Edge Function pulls arrivals and departures from the PMS API and calls `import_stays` with `source = 'pms'`. No schema change is needed.

## Customer endpoints (designed, not built)

These use the same tables. Customers would sign in with an emailed one-time code (Supabase Auth) and get their own role. Row-level security limits them to their own cases, and they can never read `lost_items`, `stays` or `room_checks`.

| Call | Does |
|---|---|
| `verify_booking(inn_code, reservation_ref, surname)` | Edge Function, rate-limited, after the email code. Compares the surname inside the database (`_normalise_surname`) and returns the hotel and stay dates only, never the room |
| `open_case(stay_id, description, category, colour, brand, …)` | Creates a case. Matching runs silently against open items in that stay's room and dates. The customer only learns "we may have something; staff will check", never item details |
| `add_case_message(case_id, text)` / `add_case_evidence(case_id, file)` | Conversation and proof of ownership, private to the case |
| `case_status(case_id)` | Status for the customer's case page |

Matching runs both ways. A new item checks open cases, and a new case checks open items. Either one creates a suggestion for staff, who confirm through the existing candidate → handover flow.
