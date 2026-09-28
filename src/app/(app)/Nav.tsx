'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { href: string; label: string; icon: 'board' | 'plus' | 'people' }

function Icon({ name }: { name: NavItem['icon'] }) {
  const common = { width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'board')
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  if (name === 'plus')
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17.5 14.5c2 .4 3.4 2 4 4.5" />
    </svg>
  )
}

export default function Nav({ isManager, variant }: { isManager: boolean; variant: 'rail' | 'bar' }) {
  const pathname = usePathname()
  const items: NavItem[] = [
    { href: '/items', label: 'Items', icon: 'board' },
    { href: '/items/new', label: 'Log item', icon: 'plus' },
    ...(isManager ? [{ href: '/staff', label: 'Staff', icon: 'people' as const }] : []),
  ]
  const isActive = (href: string) =>
    href === '/items'
      ? pathname === '/items' || (pathname.startsWith('/items/') && pathname !== '/items/new')
      : pathname.startsWith(href)

  if (variant === 'rail')
    return (
      <nav aria-label="Main">
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 font-semibold ${
                  isActive(item.href) ? 'bg-teal-soft text-teal-dark' : 'text-muted hover:bg-paper'
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

  return (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex">
          {items.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${
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
