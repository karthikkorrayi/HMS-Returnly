// Customer enquiries. Values mirror supabase/migrations/…0008_customer_requests.sql.

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
// the item has been found until staff have approved the claim.
export const CUSTOMER_STATUS: Record<RequestStatus, { title: string; body: string }> = {
  pending_review: {
    title: 'Received — waiting for review',
    body: 'A member of staff will check your enquiry against the items we hold.',
  },
  under_investigation: {
    title: 'Being checked',
    body: 'Staff are checking our records. We may ask you a question here.',
  },
  awaiting_customer: {
    title: 'We need a little more information',
    body: 'Please answer the question below so we can continue.',
  },
  awaiting_admin: {
    title: 'Being checked',
    body: 'Your enquiry is with a manager for a final check.',
  },
  approved: {
    title: 'We think we have your item',
    body: 'The hotel will arrange collection or posting with you. Bring photo ID that matches your booking.',
  },
  rejected: {
    title: 'We couldn’t match your item',
    body: 'We couldn’t match your description to anything we hold. The message below may explain more.',
  },
  resolved: {
    title: 'Closed',
    body: 'This enquiry is closed. Start a new enquiry if something else is missing.',
  },
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
  customer_name: string
  booking_ref: string
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
  status: RequestStatus
  item_name: string
  created_at: string
  updated_at: string
  can_reply: boolean
  messages: { sender: 'customer' | 'staff' | 'system'; body: string; created_at: string }[]
}

// The structured enquiry the assistant produces and the backend accepts.
// A future AI assistant must produce exactly this shape; nothing else is sent.
export type EnquiryPayload = {
  innCode: string
  customerName: string
  bookingRef: string
  itemName: string
  description: string
  category: string | null
  colour: string | null
  brand: string | null
  lostLocation: string | null
  lostDate: string | null // YYYY-MM-DD
}
