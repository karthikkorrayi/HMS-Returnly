import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadStaffNames } from '@/lib/queries/requests'
import RequestList, { type ListParams } from '../requests/RequestList'

// Support: the enquiries an admin has assigned to you. (The database only
// returns those, whatever the URL says.)
export default async function SupportRequestsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { staff: me } = await requireSession(['support'])
  const names = await withStaff(me.user_id, loadStaffNames)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Support requests</h1>
        <p className="hint mt-1">
          Investigate, add notes, ask the customer for details, then mark the request ready for admin review.
        </p>
      </div>
      <RequestList basePath="/support" params={await searchParams} names={names} meId={me.user_id} showAssigneeFilter={false} />
    </div>
  )
}
