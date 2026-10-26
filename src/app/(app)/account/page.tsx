import { requireSession } from '@/lib/auth'
import { ROLE_LABEL } from '@/lib/types'
import PasswordForm from './PasswordForm'

// Every role can reach this page: it only ever changes the signed-in person's
// own password, and Better Auth checks their current password first.
export default async function AccountPage() {
  const { staff } = await requireSession()

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="hint mt-1">{staff.display_name} · {staff.username} · {ROLE_LABEL[staff.role]}</p>
      </div>
      <section className="panel p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-semibold">Change password</h2>
        <PasswordForm username={staff.username} />
      </section>
    </div>
  )
}
