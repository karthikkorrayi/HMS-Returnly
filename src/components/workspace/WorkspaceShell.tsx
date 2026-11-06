'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Nav from '@/app/(app)/Nav'
import { signOut } from '@/app/(app)/actions'
import { notificationSnapshot, openNotification, markAllNotificationsRead } from '@/app/(app)/notifications/actions'
import type { StaffNotification } from '@/lib/notifications'
import { ROLE_LABEL, type Staff, type Property } from '@/lib/types'
import { ROLE_PERMISSIONS } from '@/lib/role-permissions'
import { staffPath } from '@/lib/staff-paths'
import { homeForRole } from '@/lib/workspace'
import Brand from '@/components/foundora/Brand'
import ThemeToggle from '@/components/foundora/Theme'
import HotelLogo from '@/components/foundora/HotelLogo'
import { Modal } from './Modal'

type Props = { staff: Staff; property: Pick<Property, 'name'|'slug'|'inn_code'>; logoVersion: number; hasLogo: boolean; hasMark: boolean; notified: boolean; unread: number; children: React.ReactNode }
export default function WorkspaceShell({ staff, property, logoVersion, hasLogo, hasMark, notified, unread, children }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [profile, setProfile] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [count, setCount] = useState(unread)
  const [items, setItems] = useState<StaffNotification[] | null>(null)
  const [error, setError] = useState('')
  const [readFilter, setReadFilter] = useState('all')
  const to = (path: string) => staffPath(property.slug, path)
  const mobileDialog = useRef<HTMLDialogElement>(null)
  const initial = property.name.trim().slice(0, 1).toUpperCase()
  useEffect(() => {
    const update = (e: Event) => setCount((e as CustomEvent<number>).detail)
    window.addEventListener('foundora-unread', update)
    return () => window.removeEventListener('foundora-unread', update)
  }, [])
  useEffect(() => {
    let live = true, running = false
    async function load() {
      if (!notifications || !notified || document.visibilityState !== 'visible' || running) return
      running = true
      try {
        const data = await notificationSnapshot()
        if (live) { if (!data) setError('Your session has ended. Sign in again.'); else { setItems(data.items); setCount(data.count); setError('') } }
      } catch { if (live) setError('Could not load notifications. Retrying automatically.') }
      finally { running = false }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => { live = false; clearInterval(timer) }
  }, [notifications, notified])
  useEffect(() => { if (mobile && !mobileDialog.current?.open) mobileDialog.current?.showModal(); else if (!mobile) mobileDialog.current?.close() }, [mobile])
  function toggle() { setCollapsed((old) => !old) }
  const logo = hasLogo ? <HotelLogo slug={property.slug} version={logoVersion} name={property.name} /> : <span className="hotel-initial" aria-label={property.name}>{initial}</span>
  const mark = hasMark
    // eslint-disable-next-line @next/next/no-img-element -- public tenant-scoped branding endpoint
    ? <img src={`/brand/${encodeURIComponent(property.slug)}/logo?variant=mark&v=${logoVersion}`} width="44" height="44" alt={property.name} />
    : <span className="hotel-initial" aria-label={`${property.name} — standalone logo not configured`}>{initial}</span>
  return <div className={`workspace-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#staff-main">Skip to workspace</a>
    <aside className="workspace-sidebar" aria-label="Workspace sidebar">
      <div className="sidebar-header"><Link href={to(homeForRole(staff.role))} aria-label={`${property.name} dashboard`}>{collapsed ? mark : logo}</Link>
        <button type="button" className="icon-button" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} onClick={toggle}>{collapsed ? '»' : '«'}</button></div>
      <Nav role={staff.role} variant="rail" collapsed={collapsed} />
      <div className="sidebar-footer"><Link href="/" aria-label="FoundOra guest services"><Brand /></Link></div>
    </aside>
    <div className="workspace-column">
      <header className="workspace-topbar">
        <span className="mobile-header-logo">{logo}</span><button type="button" className="icon-button mobile-menu-toggle" aria-label="Open navigation" aria-expanded={mobile} onClick={() => setMobile(true)}>☰</button>
        <div className="workspace-hotel"><div><p className="font-bold">{property.name}</p><p className="hint">{property.inn_code} · Staff workspace</p></div></div>
        <div className="workspace-account-actions"><ThemeToggle />
          <button type="button" className="icon-button notification-trigger" aria-label={`Notifications: ${count} unread`} onClick={() => { setNotifications(true); setItems(null); setError('') }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>{count>0 && <span className="notification-count">{count>99?'99+':count}</span>}
          </button>
          <button type="button" className="profile-trigger" aria-label="Open your profile" aria-haspopup="dialog" onClick={() => setProfile(true)}>{staff.display_name.slice(0,1).toUpperCase()}</button>
        </div>
      </header>
      <main id="staff-main" className="workspace-main">{children}</main>
      <footer className="workspace-company-footer"><Brand /><span>FoundOra · Lost &amp; Found, Made Simple.</span><Link href="/">Guest services</Link></footer>
    </div>
    <dialog ref={mobileDialog} className="mobile-navigation-dialog" aria-label="Navigation" onClose={() => setMobile(false)}><header className="workspace-dialog-header"><span className="font-bold">Navigation</span><button type="button" className="icon-button" aria-label="Close navigation" onClick={() => setMobile(false)}>×</button></header><div onClick={(event) => { if ((event.target as Element).closest('a')) setMobile(false) }}><Nav role={staff.role} variant="rail" /></div><div className="sidebar-footer"><Brand /></div></dialog>
    <Modal open={profile} title="Your profile" onClose={() => setProfile(false)}>
      <dl className="profile-details"><div><dt>Name</dt><dd>{staff.display_name}</dd></div><div><dt>Username</dt><dd>{staff.username}</dd></div><div><dt>Role</dt><dd>{ROLE_LABEL[staff.role]}</dd></div><div><dt>Hotel</dt><dd>{property.name} ({property.inn_code})</dd></div><div><dt>Account access</dt><dd>Active · This hotel only</dd></div></dl>
      <h3 className="font-bold mt-5">Your role can</h3><ul className="permission-list">{ROLE_PERMISSIONS.filter((p) => p.roles.includes(staff.role)).map((p) => <li key={p.what}>{p.what}{p.note && <span className="hint block">{p.note}</span>}</li>)}</ul>
      <div className="flex flex-wrap gap-3 mt-5"><Link className="btn btn-primary" href={to('/account')} onClick={() => setProfile(false)}>Change password</Link><form action={signOut}><button className="btn btn-secondary">Sign out</button></form></div>
    </Modal>
    <Modal open={notifications} title="Notifications" onClose={() => setNotifications(false)}>
      {!notified ? <p className="hint">Your role does not receive request notifications. Your account and item permissions are shown in your profile.</p> : <>
        <div className="filter-toolbar"><label>Show<select className="field" value={readFilter} onChange={(e) => setReadFilter(e.target.value)}><option value="all">All recent</option><option value="unread">Unread</option><option value="read">Read</option></select></label><Link className="btn btn-secondary" href={to('/notifications')} onClick={() => setNotifications(false)}>View history</Link></div>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {!items && !error && <p role="status">Loading notifications…</p>}
        {items && <ul className="notification-list">{items.filter((n) => readFilter==='all' || (readFilter==='read')===n.read).slice(0,20).map((n) => <li key={n.id}><form action={openNotification}><input type="hidden" name="id" value={n.id}/><button className={n.read?'':'font-semibold'}>{n.message}<span className="hint block">{n.read?'Read':'Unread'} · {new Date(n.created_at).toLocaleString()}</span></button></form></li>)}</ul>}
        {items && !items.some((n) => readFilter==='all' || (readFilter==='read')===n.read) && <p className="hint">No notifications match this filter.</p>}
        {count>0 && <form action={markAllNotificationsRead}><button className="btn btn-secondary mt-4">Mark all as read</button></form>}
      </>}
    </Modal>
  </div>
}
