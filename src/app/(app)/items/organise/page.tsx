import { ITEM_ROLES, requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadActionBoard } from '@/lib/action-groups'
import ActionGroupBoard from '@/components/workspace/ActionGroupBoard'
export default async function OrganisePage({searchParams}:{searchParams:Promise<{group?:string}>}) {
 const {staff}=await requireSession(ITEM_ROLES)
 const board=await withStaff(staff.user_id,loadActionBoard)
 return <ActionGroupBoard initial={board} manager={staff.role==='manager'} initialGroup={(await searchParams).group??''}/>
}
