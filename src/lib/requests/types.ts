// Customer enquiries. Values mirror db/migrations/…0008_customer_requests.sql.

import type { ItemStatus, ValueTier } from '@/lib/types'

export type RequestStatus =
  | 'pending_review'
  | 'under_investigation'
  | 'awaiting_customer'
  | 'awaiting_admin'
  | 'approved'
  | 'rejected'
  | 'resolved'

export const REQUEST_STATUSES: RequestStatus[] = [
  'pending_review',
  'under_investigation',
  'awaiting_customer',
  'awaiting_admin',
  'approved',
  'rejected',
  'resolved',
]

export const OPEN_REQUEST_STATUSES: RequestStatus[] = [
  'pending_review',
  'under_investigation',
  'awaiting_customer',
  'awaiting_admin',
]

// Staff wording
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending_review: 'Pending review',
  under_investigation: 'Under investigation',
  awaiting_customer: 'Awaiting customer information',
  awaiting_admin: 'Awaiting admin confirmation',
  approved: 'Approved',
  rejected: 'Rejected',
  resolved: 'Resolved',
}

// Customer wording: what is happening and what they should do. Never implies
// the item has been found until staff have approved the claim. The title is
// the guest-facing status (Submitted, Under review, Contact required,
// Matched, Resolved, Closed); the internal workflow keeps its own statuses.
export type GuestStatus = 'Submitted' | 'Under review' | 'Contact required' | 'Matched' | 'Resolved' | 'Closed'

export const GUEST_STATUS: Record<RequestStatus, GuestStatus> = {
  pending_review: 'Submitted',
  under_investigation: 'Under review',
  awaiting_admin: 'Under review',
  awaiting_customer: 'Contact required',
  approved: 'Matched',
  resolved: 'Resolved',
  rejected: 'Closed',
}

export const CUSTOMER_STATUS: Record<RequestStatus, { title: GuestStatus; body: string }> = {
  pending_review: {
    title: 'Submitted',
    body: 'A member of staff will check your report against the items the hotel holds.',
  },
  under_investigation: {
    title: 'Under review',
    body: 'Staff are checking the hotel’s records. We may ask you a question here.',
  },
  awaiting_customer: {
    title: 'Contact required',
    body: 'Please answer the question below so the hotel can continue.',
  },
  awaiting_admin: {
    title: 'Under review',
    body: 'Your report is with a manager for a final check.',
  },
  approved: {
    title: 'Matched',
    body: 'The hotel thinks it has your item and will arrange collection or posting with you. Bring photo ID that matches your booking.',
  },
  rejected: {
    title: 'Closed',
    body: 'The hotel couldn’t match your description to anything it holds. The message below may explain more.',
  },
  resolved: {
    title: 'Resolved',
    body: 'This report is resolved. Start a new report if something else is missing.',
  },
}

// Found-item reports: the finder never hears about owners or matches.
export const FOUND_STATUS_BODY: Partial<Record<RequestStatus, string>> = {
  pending_review: 'Thank you. If you haven’t handed the item in yet, please take it to the hotel reception.',
  under_investigation: 'The hotel is looking into your report.',
  awaiting_admin: 'The hotel is looking into your report.',
  approved: 'The hotel has the details it needs. Thank you.',
  rejected: 'This report is closed. The message below may explain more.',
  resolved: 'This report is resolved. Thank you for handing the item in.',
}

export function customerStatus(status: RequestStatus, reportType: ReportType) {
  const base = CUSTOMER_STATUS[status]
  return reportType === 'found' && FOUND_STATUS_BODY[status] ? { ...base, body: FOUND_STATUS_BODY[status]! } : base
}

export type ReportType = 'lost' | 'found'
export type FoundWhereabouts = 'handed_in' | 'with_finder' | 'left_in_place'
export const WHEREABOUTS_LABEL: Record<FoundWhereabouts, string> = {
  handed_in: 'Handed in at reception',
  with_finder: 'Still with the finder (will hand it in)',
  left_in_place: 'Left where it was found',
}

export type MatchBand = 'strong' | 'partial' | 'weak'
export const MATCH_BAND_LABEL: Record<MatchBand, string> = {
  strong: 'Strong match',
  partial: 'Partial match',
  weak: 'Weak match',
}

export type CustomerRequest = {
  id: string
  reference: string
  report_type: ReportType
  customer_name: string | null
  booking_ref: string | null
  customer_email: string | null
  found_whereabouts: FoundWhereabouts | null
  item_name: string
  category: string | null
  colour: string | null
  brand: string | null
  description: string
  lost_location: string | null
  lost_date: string | null
  status: RequestStatus
  assigned_to: string | null
  approved_item_id: string | null
  decision_note: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
}

export type RequestMessage = {
  id: number
  sender: 'customer' | 'staff' | 'system'
  author_id: string | null
  body: string
  created_at: string
}

export type RequestNote = { id: number; author_id: string; body: string; created_at: string }

export type RequestEvent = {
  id: number
  actor: string | null
  action: string
  from_status: RequestStatus | null
  to_status: RequestStatus | null
  detail: string | null
  created_at: string
}

export type MatchRow = {
  item_id: string
  item_code: string
  description: string
  category: string
  colour: string | null
  brand: string | null
  room_number: string | null
  area_label: string | null
  found_spot: string | null
  found_at: string
  status: ItemStatus
  value_tier: ValueTier
  score: number
  band: MatchBand
  reasons: string[]
}

// What the public status lookup returns — nothing internal.
export type CustomerStatusView = {
  reference: string
  report_type: ReportType
  hotel_name: string
  status: RequestStatus
  item_name: string
  created_at: string
  updated_at: string
  can_reply: boolean
  messages: { sender: 'customer' | 'staff' | 'system'; body: string; created_at: string }[]
}

// The structured report the assistant (lost) or the short form (found)
// produces and the backend accepts. A future AI assistant must produce exactly
// this shape; nothing else is sent. emailConfirmed is true only after the
// customer pressed "Yes" on "Is this your correct email address?".
export type ReportPayload = {
  innCode: string
  reportType: ReportType
  email: string
  emailConfirmed: boolean
  itemName: string
  description: string
  category: string | null
  colour: string | null
  brand: string | null
  location: string | null
  date: string | null // YYYY-MM-DD
  customerName: string | null // lost only
  bookingRef: string | null // lost only
  whereabouts: FoundWhereabouts | null // found only
}
