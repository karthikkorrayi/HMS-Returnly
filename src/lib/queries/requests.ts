// Customer requests, staff side (page port, group 4): the list shared by
// Admin (/requests) and Support (/support), and one request's page. Read in
// one transaction as the signed-in staff member, so row-level security
// decides: Admin sees every request of the hotel, Support only the ones
// assigned to them. No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'
import type { Staff } from '@/lib/types'
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUSES,
  type CustomerRequest,
  type MatchBand,
  type MatchRow,
  type RequestEvent,
  type RequestMessage,
  type RequestNote,
  type RequestStatus,
} from '@/lib/requests/types'

export type RequestListRow = Pick<
  CustomerRequest,
  'id' | 'reference' | 'customer_name' | 'booking_ref' | 'item_name' | 'category' | 'status' | 'assigned_to' | 'created_at'
>

export type RequestListQuery = {
  status: RequestStatus | 'open' | 'all'
  /** Already cleaned: letters, digits, spaces and dashes; at most 40 characters. */
  search: string
  assigned: 'any' | 'me' | 'unassigned'
  page: number
  pageSize: number
  meId: string
}

export function cleanRequestSearch(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 40)
}

const FIELDS = `r.id, r.reference, r.customer_name, r.booking_ref, r.item_name, r.category, r.status::text as status,
  r.assigned_to, r.created_at`

export async function loadRequestList(tx: Tx, q: RequestListQuery) {
  // Summary counts over everything this person may see (one grouped query).
  const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>
  for (const r of (await tx.query<{ status: RequestStatus; n: number }>(
    `select status::text as status, count(*)::int as n from public.customer_requests group by status`
  )).rows) counts[r.status] = r.n
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const statuses = q.status === 'open' ? OPEN_REQUEST_STATUSES : q.status === 'all' ? REQUEST_STATUSES : [q.status]
  // $1 statuses, $2 assignee filter, $3 me, $4 search
  const params: unknown[] = [statuses.join(','), q.assigned, q.meId, q.search || null]
  const where = `r.status = any(string_to_array($1::text, ',')::public.request_status[])
      and ($2::text = 'any' or ($2 = 'me' and r.assigned_to = $3::uuid) or ($2 = 'unassigned' and r.assigned_to is null))
      and ($4::text is null or r.reference ilike '%' || $4 || '%' or r.customer_name ilike '%' || $4 || '%'
           or r.booking_ref ilike '%' || $4 || '%' or r.item_name ilike '%' || $4 || '%')`
  const matching = (await tx.query<{ n: number }>(`select count(*)::int as n from public.customer_requests r where ${where}`, params)).rows[0].n
  const rows = (
    await tx.query<RequestListRow>(
      `select ${FIELDS} from public.customer_requests r where ${where}
        order by r.created_at desc, r.id limit $5 offset $6`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize]
    )
  ).rows

  // Best match per open request on this page: an indicator only.
  const best: Record<string, MatchBand | null> = {}
  for (const r of rows) {
    if (!OPEN_REQUEST_STATUSES.includes(r.status)) continue
    const m = await tx.rpc<{ band: MatchBand }>('match_request_items', { p_request_id: r.id })
    best[r.id] = m.rows[0]?.band ?? null
  }

  return { rows, matching, counts, total, best }
}

/** user_id → display name, for everyone this person can see at their hotel. */
export async function loadStaffNames(tx: Tx): Promise<Record<string, string>> {
  const rows = (await tx.query<{ user_id: string; display_name: string }>(`select user_id, display_name from public.staff`)).rows
  return Object.fromEntries(rows.map((s) => [s.user_id, s.display_name]))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RequestDetail = {
  req: CustomerRequest
  messages: RequestMessage[]
  notes: RequestNote[]
  events: RequestEvent[]
  staff: Pick<Staff, 'user_id' | 'display_name' | 'role' | 'active'>[]
  approvedItem: { id: string; item_code: string; description: string; status: string } | null
}

/** null when the id is malformed or the request is not visible to this person. */
export async function loadRequestDetail(tx: Tx, id: string): Promise<RequestDetail | null> {
  if (!UUID.test(id)) return null
  const req = (
    await tx.query<CustomerRequest>(
      `select id, reference, customer_name, booking_ref, item_name, category, colour, brand, description,
              lost_location, lost_date, status::text as status, assigned_to, approved_item_id, decision_note,
              created_at, updated_at, closed_at
         from public.customer_requests where id = $1`,
      [id]
    )
  ).rows[0]
  if (!req) return null

  const messages = (await tx.query<RequestMessage>(
    `select id::float8 as id, sender, author_id, body, created_at from public.request_messages where request_id = $1 order by id`, [id])).rows
  const notes = (await tx.query<RequestNote>(
    `select id::float8 as id, author_id, body, created_at from public.request_notes where request_id = $1 order by id desc`, [id])).rows
  const events = (await tx.query<RequestEvent>(
    `select id::float8 as id, actor, action, from_status::text as from_status, to_status::text as to_status, detail, created_at
       from public.request_events where request_id = $1 order by id desc`, [id])).rows
  const staff = (await tx.query<RequestDetail['staff'][number]>(
    `select user_id, display_name, role::text as role, active from public.staff order by display_name`)).rows

  const approvedItem = req.approved_item_id
    ? (await tx.query<NonNullable<RequestDetail['approvedItem']>>(
        `select id, item_code, description, status::text as status from public.lost_items where id = $1`, [req.approved_item_id])).rows[0] ?? null
    : null

  return { req, messages, notes, events, staff, approvedItem }
}

/** Possible matching items, best first. Run in its own transaction by the
 *  page, so if the matcher refuses, the rest of the page still shows. */
export async function loadRequestMatches(tx: Tx, id: string): Promise<MatchRow[]> {
  if (!UUID.test(id)) return []
  return (await tx.rpc<MatchRow>('match_request_items', { p_request_id: id })).rows
}
