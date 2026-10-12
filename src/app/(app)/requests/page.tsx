import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import RequestList, { type ListParams } from './RequestList'

// Admin: every customer enquiry for this hotel.
export default async function CustomerRequestsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { staff: me } = await requireSession(['manager'])
  const supabase = await createClient()
  const { data: staff } = await supabase.from('staff').select('user_id, display_name')
  const names = Object.fromEntries((staff ?? []).map((s) => [s.user_id, s.display_name]))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Customer requests</h1>
        <p className="hint mt-1">
          Enquiries from the public site. Matches are suggestions only — approving is always your decision, and
          releasing the item still follows the item’s ID check and handover.
        </p>
      </div>
      <RequestList basePath="/requests" params={await searchParams} names={names} meId={me.user_id} showAssigneeFilter />
    </div>
  )
}
