import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { ROLE_LABEL } from '@/lib/types'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import { signOut } from './actions'
import Nav from './Nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, property } = await requireSession()

  return (
    <div className="overview-shell min-h-screen md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface p-5 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:gap-7">
        <div>
          <Link href="/items" className="flex items-center gap-3">
            <span className="brand-mark"><ReturnlyIcon name="tag" /></span>
            <span className="text-xl font-bold tracking-tight">Returnly</span>
          </Link>
          <div className="mt-6 rounded-xl bg-paper p-3">
            <p className="font-semibold leading-tight">{property.name}</p>
            <p className="hint mt-1">{property.inn_code}</p>
          </div>
        </div>

        <Nav isManager={staff.role === 'manager'} variant="rail" />

        <div className="mt-auto border-t border-line pt-4">
          <p className="font-semibold">{staff.display_name}</p>
          <p className="hint mt-1">{ROLE_LABEL[staff.role]}</p>
          <form action={signOut} className="mt-4">
            <button className="btn btn-secondary w-full">Sign out</button>
          </form>
          <Link href="/" className="mt-4 block text-center text-xs font-semibold text-teal">
            Public overview
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <span className="brand-mark"><ReturnlyIcon name="tag" /></span>
            <div className="min-w-0">
              <p className="truncate font-bold leading-tight">{property.name}</p>
              <p className="hint truncate">{staff.display_name} · {ROLE_LABEL[staff.role]}</p>
            </div>
          </div>
          <form action={signOut}>
            <button className="btn btn-secondary min-h-9 px-3 text-sm">Sign out</button>
          </form>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 md:px-7 md:pb-10 md:pt-8">
          {children}
        </main>
        <Nav isManager={staff.role === 'manager'} variant="bar" />
      </div>
    </div>
  )
}
