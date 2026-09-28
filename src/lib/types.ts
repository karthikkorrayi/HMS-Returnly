// Shared types and labels. Values mirror the enums and checks in
// supabase/migrations — change both together.

export type StaffRole = 'housekeeping' | 'front_office' | 'manager'
export type ValueTier = 'standard' | 'valuable' | 'sensitive'
export type ItemStatus =
  | 'logged'
  | 'stored'
  | 'matched'
  | 'guest_contacted'
  | 'awaiting_collection'
  | 'awaiting_shipping'
  | 'returned'
  | 'disposed'
  | 'donated'
export type HandoverMethod = 'in_person' | 'courier' | 'disposed' | 'donated'

export type Staff = {
  user_id: string
  property_id: string
  username: string
  display_name: string
  role: StaffRole
  active: boolean
}

export type Property = {
  id: string
  inn_code: string
  name: string
  retention_days: number
}

export type StorageLocation = {
  id: string
  label: string
  is_secure: boolean
  active: boolean
}

export type LostItem = {
  id: string
  property_id: string
  item_code: string
  found_area_type: 'room' | 'public_area'
  room_number: string | null
  area_label: string | null
  found_at: string
  found_by: string
  category: string
  description: string
  brand: string | null
  colour: string | null
  value_tier: ValueTier
  status: ItemStatus
  storage_location_id: string | null
  dispose_after: string
  created_at: string
}

export type GuestCandidate = {
  id: string
  item_id: string
  reservation_ref: string
  departure_date: string | null
  added_by: string
  added_at: string
  confirmed: boolean
  confirmed_by: string | null
  confirmed_at: string | null
  note: string | null
}

export type CustodyEvent = {
  id: number
  from_status: ItemStatus | null
  to_status: ItemStatus
  storage_location_id: string | null
  actor: string
  note: string | null
  created_at: string
}

export type Handover = {
  method: HandoverMethod
  id_checked: boolean | null
  courier_tracking: string | null
  handed_over_by: string
  witness: string | null
  note: string | null
  handed_over_at: string
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  housekeeping: 'Housekeeping',
  front_office: 'Front office',
  manager: 'Manager',
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  logged: 'Logged',
  stored: 'Stored',
  matched: 'Matched to a stay',
  guest_contacted: 'Guest contacted',
  awaiting_collection: 'Awaiting collection',
  awaiting_shipping: 'Awaiting posting',
  returned: 'Returned',
  disposed: 'Disposed',
  donated: 'Donated',
}

export const CLOSED_STATUSES: ItemStatus[] = ['returned', 'disposed', 'donated']

export const TIER_LABEL: Record<ValueTier, string> = {
  standard: 'Standard',
  valuable: 'Valuable',
  sensitive: 'Sensitive',
}

export const TIER_HINT: Record<ValueTier, string> = {
  standard: 'Clothes, chargers, toiletries, books',
  valuable: 'Phones, laptops, jewellery, watches, cash — goes in the safe',
  sensitive: 'Passports, ID, bank cards, medication — safe only, no photos',
}

export const CATEGORIES: { value: string; label: string }[] = [
  { value: 'electronics', label: 'Electronics' },
  { value: 'chargers_cables', label: 'Chargers & cables' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'bags', label: 'Bags' },
  { value: 'jewellery_watches', label: 'Jewellery & watches' },
  { value: 'documents_cards', label: 'Documents & cards' },
  { value: 'cash_wallets', label: 'Cash & wallets' },
  { value: 'toiletries', label: 'Toiletries' },
  { value: 'medication', label: 'Medication' },
  { value: 'toys', label: 'Toys' },
  { value: 'books', label: 'Books' },
  { value: 'other', label: 'Other' },
]

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

export const PUBLIC_AREAS = [
  'Lobby',
  'Restaurant',
  'Bar',
  'Gym',
  'Pool',
  'Meeting rooms',
  'Car park',
  'Lifts',
  'Corridor',
]

export type ActionState = { error: string | null; ok?: boolean }
export const initialActionState: ActionState = { error: null }
