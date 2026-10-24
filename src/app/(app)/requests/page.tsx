import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadStaffNames } from '@/lib/queries/requests'
import RequestList, { type ListParams } from './RequestList'

// Admin: every customer enquiry for this hotel.
export default async function CustomerRequestsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { staff: me } = await requireSession(['manager'])
  const names = await withStaff(me.user_id, loadStaffNames)

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
