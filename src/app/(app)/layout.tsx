import { requireSession } from '@/lib/auth'
import { ROLE_LABEL } from '@/lib/types'
import { signOut } from './actions'
import Nav from './Nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, property } = await requireSession()

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line bg-surface p-4 md:flex md:flex-col md:gap-6">
        <div>
          <span className="tag">Returnly</span>
          <p className="mt-3 font-bold leading-tight">{property.name}</p>
          <p className="hint">{property.inn_code}</p>
        </div>
        <Nav isManager={staff.role === 'manager'} variant="rail" />
        <div className="mt-auto border-t border-line pt-4">
          <p className="font-semibold">{staff.display_name}</p>
          <p className="hint">{ROLE_LABEL[staff.role]}</p>
          <form action={signOut} className="mt-3">
            <button className="btn btn-secondary w-full">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
          <div className="min-w-0">
            <p className="truncate font-bold leading-tight">{property.name}</p>
            <p className="hint truncate">
              {staff.display_name} · {ROLE_LABEL[staff.role]}
            </p>
          </div>
          <form action={signOut}>
            <button className="btn btn-secondary min-h-9 px-3 text-sm">Sign out</button>
          </form>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          {children}
        </main>
        <Nav isManager={staff.role === 'manager'} variant="bar" />
      </div>
    </div>
  )
}
