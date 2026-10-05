import type { ItemStatus, StaffRole, ValueTier } from './types'

export const DASHBOARD_VIEWS = [
  {
    id: 'open',
    label: 'All open',
    statuses: [
      'logged', 'stored', 'matched', 'guest_contacted',
      'awaiting_collection', 'awaiting_shipping',
    ],
  },
  { id: 'storage', label: 'Needs storage', statuses: ['logged'] },
  {
    id: 'return',
    label: 'Ready to return',
    statuses: ['awaiting_collection', 'awaiting_shipping'],
  },
  {
    id: 'retention',
    label: 'Retention review',
    statuses: ['stored', 'matched', 'guest_contacted'],
  },
  {
    id: 'closed',
    label: 'Closed',
    statuses: ['returned', 'disposed', 'donated'],
  },
] as const

export type DashboardFilter = (typeof DASHBOARD_VIEWS)[number]['id']
export type DashboardCounts = Record<DashboardFilter, number | null>

export type DashboardItem = {
  id: string
  code: string
  description: string
  category: string
  location: string
  status: ItemStatus
  tier: ValueTier
  retention: boolean
  photoUrl?: string
}

export const DASHBOARD_SUMMARIES = [
  { id: 'open', label: 'Open items', icon: 'box', note: 'In your team’s care', tone: 'teal' },
  { id: 'storage', label: 'Needs storage', icon: 'tag', note: 'Find a safe place first', tone: 'amber' },
  { id: 'return', label: 'Ready to return', icon: 'check', note: 'Collection or posting', tone: 'green' },
  { id: 'retention', label: 'Retention review', icon: 'clock', note: 'For a manager to review', tone: 'amber' },
] as const

export function getDashboardView(value: unknown) {
  return DASHBOARD_VIEWS.find((view) => view.id === value) ?? DASHBOARD_VIEWS[0]
}

export function matchesDashboardFilter(item: DashboardItem, filter: DashboardFilter) {
  const view = getDashboardView(filter)
  const matchesStatus = (view.statuses as readonly ItemStatus[]).includes(item.status)
  return matchesStatus && (filter !== 'retention' || item.retention)
}

export function dashboardGuidance(item: DashboardItem, role: StaffRole): string {
  const managesItems = role === 'manager' || role === 'front_office'
  const witness = item.tier === 'standard'
    ? ''
    : ' A second active staff member must witness the handover.'

  if (
    item.retention &&
    matchesDashboardFilter(item, 'retention') &&
    role === 'manager'
  ) {
    return 'The retention period has passed. Review disposal or donation with a second staff witness. Open the item to record the decision.'
  }

  switch (item.status) {
    case 'logged':
      return item.tier === 'standard'
        ? 'Choose a storage location and record where this item is kept.'
        : 'Store this item securely and record its location.' +
          (item.tier === 'sensitive' ? ' Do not photograph sensitive items.' : '')
    case 'stored':
      return managesItems
        ? 'Look for a matching reservation and confirm the candidate on the item record.' +
          (item.retention ? ' This item is also eligible for manager retention review.' : '')
        : 'Keep the item in its recorded location. The front desk will match it to a reservation.' +
          (item.retention ? ' Ask a manager to review its retention date.' : '')
    case 'matched':
      return managesItems
        ? 'Contact the guest through the PMS, then record how they were contacted.'
        : 'The front desk will contact the guest through the PMS.'
    case 'guest_contacted':
      return managesItems
        ? 'Record whether the guest wants to collect the item or have it posted.'
        : 'The front desk is waiting for the guest’s collection or posting preference.'
    case 'awaiting_collection':
      return managesItems
        ? 'Check the guest’s ID against the reservation in the PMS, then record the handover.' + witness
        : 'The front desk will check the guest’s ID and record collection.' + witness
    case 'awaiting_shipping':
      return managesItems
        ? 'Record the courier tracking number when posting the item.' + witness
        : 'The front desk will record courier tracking when posting the item.' + witness
    case 'returned':
      return 'This item has been returned. Open its record to review the custody trail.'
    case 'disposed':
      return 'This item has been disposed of. Its custody record remains available.'
    case 'donated':
      return 'This item has been donated. Its custody record remains available.'
  }
}
