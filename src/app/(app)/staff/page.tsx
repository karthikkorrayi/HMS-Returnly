import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ROLE_LABEL, type Staff } from '@/lib/types'
import ActionForm from '@/components/ActionForm'
import { createStaff, resetPassword, setActive } from './actions'

export default async function StaffPage() {
  const { staff: me } = await requireSession(['manager'])
  const supabase = await createClient()
  const { data } = await supabase
    .from('staff')
    .select('user_id, property_id, username, display_name, role, active')
    .order('active', { ascending: false })
    .order('display_name')
    .returns<Staff[]>()
  const staff = data ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Staff</h1>
        <p className="hint mt-1">
          Everyone gets their own login so the item history shows who handled what. Don’t share logins.
        </p>
      </div>

      <section aria-labelledby="add" className="panel p-4 sm:p-5">
        <h2 id="add" className="mb-3 text-lg font-bold">Add a staff member</h2>
        <ActionForm action={createStaff} submitLabel="Add staff member" pendingLabel="Adding…">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="display_name" className="label">Name</label>
              <input id="display_name" name="display_name" className="field" maxLength={80} required />
            </div>
            <div>
              <label htmlFor="new-username" className="label">Username</label>
              <input
                id="new-username"
                name="username"
                className="field"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                pattern="[a-z0-9._\-]{3,32}"
                placeholder="e.g. priya.s"
                required
              />
            </div>
            <div>
              <label htmlFor="new-role" className="label">Role</label>
              <select id="new-role" name="role" className="field" defaultValue="housekeeping">
                <option value="housekeeping">Housekeeping — logs and stores items</option>
                <option value="front_office">Front office — matches and returns items</option>
                <option value="manager">Manager — everything, plus staff and disposal</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-password" className="label">Temporary password</label>
              <input id="new-password" name="password" type="text" className="field" minLength={10} autoComplete="off" required />
              <p className="hint mt-1">At least 10 characters. Give it to them in person.</p>
            </div>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="team">
        <h2 id="team" className="mb-3 text-lg font-bold">Team ({staff.filter((s) => s.active).length} active)</h2>
        <ul className="space-y-2">
          {staff.map((s) => (
            <li key={s.user_id} className={`panel p-4 ${s.active ? '' : 'opacity-70'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {s.display_name}
                    {s.user_id === me.user_id && <span className="font-normal text-muted"> (you)</span>}
                  </p>
                  <p className="hint">
                    {s.username} · {ROLE_LABEL[s.role]}
                    {!s.active && ' · Deactivated'}
                  </p>
                </div>
              </div>
              {s.user_id !== me.user_id && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-teal">Manage access</summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {s.active && (
                      <ActionForm action={resetPassword} hidden={{ user_id: s.user_id }} submitLabel="Set new password" variant="secondary">
                        <div>
                          <label htmlFor={`pw-${s.user_id}`} className="label">New password</label>
                          <input id={`pw-${s.user_id}`} name="password" type="text" className="field" minLength={10} autoComplete="off" required />
                        </div>
                      </ActionForm>
                    )}
                    <ActionForm
                      action={setActive}
                      hidden={{ user_id: s.user_id, active: String(!s.active) }}
                      submitLabel={s.active ? 'Deactivate' : 'Reactivate'}
                      variant={s.active ? 'danger' : 'secondary'}
                      confirmText={s.active ? `Stop ${s.display_name} signing in?` : undefined}
                      className="self-end"
                    />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
