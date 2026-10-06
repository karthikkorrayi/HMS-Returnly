'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import type { StaffRole } from '@/lib/types'

type NavItem = {
  href: string
  label: string
  icon: 'grid' | 'plus' | 'people' | 'door' | 'calendar' | 'gear'
  // Shown in the phone bottom bar (max 5); the rest are desktop-rail only
  // and reachable from other pages on phones.
  bar: boolean
}

function Icon({ name }: { name: NavItem['icon'] }) {
  if (name !== 'people') return <ReturnlyIcon name={name} />
  return (
    <svg
      viewBox="0 0 24 24" width="22" height="22"
      fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17.5 14.5c2 .4 3.4 2 4 4.5" />
    </svg>
  )
}

export default function Nav({
  role,
  variant,
}: {
  role: StaffRole
  variant: 'rail' | 'bar'
}) {
  const pathname = usePathname()
  const desk = role === 'front_office' || role === 'manager'
  const manager = role === 'manager'

  const all: NavItem[] = [
    { href: '/items', label: 'Dashboard', icon: 'grid', bar: true },
    { href: '/rooms', label: 'Rooms', icon: 'door', bar: true },
    { href: '/items/new', label: 'Log item', icon: 'plus', bar: true },
    ...(desk ? [{ href: '/stays', label: 'Stays', icon: 'calendar' as const, bar: true }] : []),
    ...(manager ? [{ href: '/staff', label: 'Staff', icon: 'people' as const, bar: true }] : []),
    ...(manager ? [{ href: '/settings', label: 'Settings', icon: 'gear' as const, bar: false }] : []),
  ]
  const items = variant === 'bar' ? all.filter((i) => i.bar) : all

  function isActive(href: string) {
    return href === '/items'
      ? pathname === '/items' ||
        (pathname.startsWith('/items/') && pathname !== '/items/new')
      : pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <nav
      aria-label="Main"
      className={variant === 'bar'
        ? 'fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden'
        : ''}
    >
      <ul className={variant === 'rail' ? 'space-y-1' : 'flex'}>
        {items.map((item) => (
          <li key={item.href} className={variant === 'bar' ? 'flex-1' : ''}>
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={variant === 'rail'
                ? `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${
                    isActive(item.href)
                      ? 'bg-teal-soft text-teal-dark'
                      : 'text-muted hover:bg-paper'
                  }`
                : `flex flex-col items-center gap-1 py-3 text-xs font-semibold ${
                    isActive(item.href) ? 'text-teal' : 'text-muted'
                  }`}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
