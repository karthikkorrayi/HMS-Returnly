'use server'
import type { ItemStatus, ValueTier } from '@/lib/types'
import { getSession, ITEM_ROLES } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { getDashboardView } from '@/lib/item-dashboard'
import { loadDashboard } from '@/lib/queries/item-dashboard'
import { hotelToday } from '@/lib/format'
type MetricResult = { error: string } | { total: number; items: { id:string; code:string; description:string; location:string; status:ItemStatus; tier:ValueTier }[] }
export async function loadMetricDetails(value: string): Promise<MetricResult> {
  const me = await getSession()
  if (!me || !ITEM_ROLES.includes(me.staff.role)) return { error: 'Sign in with an item-management role to view this summary.' } as const
  const view = getDashboardView(value)
  if (view.id !== value) return { error: 'Unknown metric.' } as const
  try {
    const data = await withStaff(me.staff.user_id, (tx) => loadDashboard(tx, { propertyId: me.property.id, view: view.id, search: '', page: 1, pageSize: 10, today: hotelToday() }))
    return { total: data.total, items: data.rows.map((i) => ({ id:i.id, code:i.item_code, description:i.description, location:i.room_number ? `Room ${i.room_number}` : i.area_label ?? 'Public area', status:i.status, tier:i.value_tier })) } as const
  } catch { return { error: 'This summary could not be loaded. Please try again.' } as const }
}
