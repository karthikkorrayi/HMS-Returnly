'use client'
import { useEffect, useRef, useState } from 'react'
import { ENTRY_MS, entryCookie } from '@/lib/app-entry'

// The "Preparing your workspace" intro. The root layout decides whether to
// show it (src/lib/app-entry.ts): staff workspace pages only, once per browser
// session. Everywhere else the page is shown straight away.
export default function AppEntry({ show, children }: { show: boolean; children: React.ReactNode }) {
  const [loading, setLoading] = useState(show)
  const [removed, setRemoved] = useState(!show)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!show) return
    document.cookie = entryCookie(window.location.protocol === 'https:')
  }, [show])
  useEffect(() => {
    if (!show) return
    const node = content.current
    if (node) node.inert = loading
    if (!loading) { const exit = setTimeout(() => setRemoved(true), 260); return () => clearTimeout(exit) }
    const timer = setTimeout(() => setLoading(false), ENTRY_MS)
    return () => { clearTimeout(timer); if (node) node.inert = false }
  }, [loading, show])
  if (!show) return <>{children}</>
  return <>
    {!removed && <div className={`app-entry-overlay ${loading ? '' : 'entry-leaving'}`}><div className="entry-emblem" aria-hidden="true">F<span /></div><p role="status">Preparing your workspace</p><p className="hint">FoundOra · Hotel lost &amp; found</p><button type="button" className="entry-skip" onClick={() => setLoading(false)}>Continue now</button></div>}
    <noscript>
      {/* eslint-disable-next-line @next/next/no-css-tags -- no-JS fallback must load without hydration and without inline CSP exemptions */}
      <link rel="stylesheet" href="/brand/entry-noscript.css" />
    </noscript>
    <div ref={content} className={`app-entry-content ${loading ? '' : 'entry-ready'}`}>{children}</div>
  </>
}
