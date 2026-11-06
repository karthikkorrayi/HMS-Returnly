import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadBranding } from '@/lib/branding'
import { NOTIFIED_ROLES, unreadCount } from '@/lib/notifications'
import { StaffHotelProvider } from '@/components/StaffHotel'
import StaffHelp from '@/components/foundora/StaffHelp'
import NotificationLive from '@/components/foundora/NotificationLive'
import WorkspaceShell from '@/components/workspace/WorkspaceShell'
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, property } = await requireSession()
  const notified = NOTIFIED_ROLES.includes(staff.role)
  const [brand, unread] = await Promise.all([
    withStaff(staff.user_id, loadBranding),
    notified ? withStaff(staff.user_id, unreadCount).catch(() => 0) : Promise.resolve(0),
  ])
  return <StaffHotelProvider slug={property.slug}>
    {notified && <NotificationLive />}<StaffHelp />
    <WorkspaceShell staff={staff} property={{name:property.name,slug:property.slug,inn_code:property.inn_code}} logoVersion={brand.logo_version} hasLogo={Boolean(brand.logo_key || brand.dark_logo_key)} hasMark={Boolean(brand.mark_logo_key)} notified={notified} unread={unread}>{children}</WorkspaceShell>
  </StaffHotelProvider>
}
