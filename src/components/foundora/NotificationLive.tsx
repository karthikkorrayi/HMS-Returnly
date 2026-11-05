'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { notificationSnapshot } from '@/app/(app)/notifications/actions'
import { notify } from './Toast'
export default function NotificationLive() {
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    let stopped = false, running = false, newest: number | null = null, signature = '', failed = false
    async function refresh() {
      if (running || document.visibilityState !== 'visible') return
      running = true
      try {
        const snapshot = await notificationSnapshot()
        if (stopped) return
        if (!snapshot) { stopped = true; return }
        window.dispatchEvent(new CustomEvent('foundora-unread', { detail: snapshot.count }))
        if (newest !== null) {
          const incoming = snapshot.items.filter((n) => n.id > newest!)
          incoming.slice(0, 3).reverse().forEach((n) => notify('info', n.message))
        }
        newest = Math.max(newest ?? 0, ...snapshot.items.map((n) => n.id))
        const next = JSON.stringify(snapshot.items.map((n) => [n.id, n.read]))
        if (signature && next !== signature && pathname.endsWith('/notifications')) router.refresh()
        signature = next
        if (failed) notify('info', 'Notification updates have resumed.')
        failed = false
      } catch {
        if (!stopped && !failed) notify('error', 'Notification updates are temporarily unavailable. Retrying automatically.')
        failed = true
      } finally { running = false }
    }
    const update = () => { if (!stopped) void refresh() }
    update()
    const timer = setInterval(update, 5000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('foundora-data-changed', update)
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('foundora-data-changed', update) }
  }, [pathname, router])
  return null
}
