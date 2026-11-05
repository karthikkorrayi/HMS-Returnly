'use client'
import { useEffect, useState } from 'react'
export type Notice = { kind: 'success' | 'info' | 'error'; message: string }
export function notify(kind: Notice['kind'], message: string) {
  window.dispatchEvent(new CustomEvent('foundora-notice', { detail: { kind, message } }))
  if (kind === 'success') window.dispatchEvent(new Event('foundora-data-changed'))
}
export default function Toasts() {
  const [items, setItems] = useState<(Notice & { id: number; leaving?: boolean })[]>([])
  useEffect(() => {
    let id = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const schedule = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }
    function receive(event: Event) {
      const notice = (event as CustomEvent<Notice>).detail
      if (!notice || !['success', 'info', 'error'].includes(notice.kind) || !notice.message) return
      const key = ++id
      setItems((old) => [...old.slice(-3), { ...notice, id: key }])
      schedule(() => setItems((old) => old.map((n) => n.id === key ? { ...n, leaving: true } : n)), 4500)
      schedule(() => setItems((old) => old.filter((n) => n.id !== key)), 4800)
    }
    window.addEventListener('foundora-notice', receive)
    return () => { window.removeEventListener('foundora-notice', receive); timers.forEach(clearTimeout) }
  }, [])
  return <div className="toast-stack" aria-label="Application updates">{items.map((n) =>
    <div key={n.id} role={n.kind === 'error' ? 'alert' : 'status'} className={`toast toast-${n.kind} ${n.leaving ? 'toast-leaving' : ''}`}>
      <span>{n.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setItems((old) => old.filter((x) => x.id !== n.id))}>×</button>
    </div>)}</div>
}
