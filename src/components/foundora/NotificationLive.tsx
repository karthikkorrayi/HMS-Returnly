'use client'
import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { notificationPulseNow } from '@/app/(app)/notifications/actions'
import { notify } from './Toast'

// The live bell for managers and support. Every 30 seconds while the tab is
// visible (and at once when the tab comes back, the window gets focus, or this
// person changes something), it asks only for the unread count, the newest id
// and up to 3 new notifications — a few hundred bytes, not the full list.
// New ones pop up as toasts; the notifications page reloads its list when
// something changed. Changes elsewhere in the app (dashboard, Action Board,
// lists) show on the next page load or refresh, as before.
export const POLL_MS = 30_000

export default function NotificationLive() {
  const router = useRouter()
  const pathname = usePathname()
  const path = useRef(pathname)
  useEffect(() => { path.current = pathname }, [pathname])

  useEffect(() => {
    let stopped = false, running = false, failed = false
    let newest: number | null = null, lastCount: number | null = null
    async function refresh() {
      if (stopped || running || document.visibilityState !== 'visible') return
      running = true
      try {
        const pulse = await notificationPulseNow(newest)
        if (stopped) return
        if (!pulse) { stopped = true; return }
        window.dispatchEvent(new CustomEvent('foundora-unread', { detail: pulse.count }))
        if (newest !== null) pulse.fresh.slice().reverse().forEach((n) => notify('info', n.message))
        const changed = newest !== null && (pulse.latest !== newest || pulse.count !== lastCount)
        newest = Math.max(newest ?? 0, pulse.latest)
        lastCount = pulse.count
        if (changed && path.current.endsWith('/notifications')) router.refresh()
        if (failed) notify('info', 'Notification updates have resumed.')
        failed = false
      } catch {
        if (!stopped && !failed) notify('error', 'Notification updates are temporarily unavailable. Retrying automatically.')
        failed = true
      } finally { running = false }
    }
    const update = () => { void refresh() }
    update()
    const timer = setInterval(update, POLL_MS)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('foundora-data-changed', update)
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('foundora-data-changed', update) }
  }, [router])
  return null
}
