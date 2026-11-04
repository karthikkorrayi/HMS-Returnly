'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { unreadNotificationCount } from '@/app/(app)/notifications/actions'

// The bell with the unread count. Starts from the count the server rendered,
// then checks again every 60 seconds while the tab is visible, when the tab
// comes back into view, and after moving to another page. The layout has two
// bells (side rail on wide screens, header on phones); only the visible one asks.
const EVERY_MS = 60_000

export default function NotificationBell({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial)
  const pathname = usePathname()
  const ref = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    let live = true
    const refresh = () => {
      if (document.visibilityState !== 'visible' || !ref.current || ref.current.offsetParent === null) return
      unreadNotificationCount().then((n) => { if (live) setCount(n) }).catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, EVERY_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [pathname])

  const label = count ? `Notifications: ${count} unread` : 'Notifications'
  return (
    <Link ref={ref} href="/notifications" aria-label={label} title={label}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink hover:bg-teal-soft">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      {count > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-bold leading-5 text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
