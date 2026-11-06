'use client'
import { useEffect, useRef, useState } from 'react'
export default function AppEntry({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [removed, setRemoved] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = content.current
    if (node) node.inert = loading
    if (!loading) { const exit = setTimeout(() => setRemoved(true), 260); return () => clearTimeout(exit) }
    const timer = setTimeout(() => setLoading(false), 3600)
    return () => { clearTimeout(timer); if (node) node.inert = false }
  }, [loading])
  return <>
    {!removed && <div className={`app-entry-overlay ${loading ? '' : 'entry-leaving'}`}><div className="entry-emblem" aria-hidden="true">F<span /></div><p role="status">Preparing your workspace</p><p className="hint">FoundOra · Hotel lost &amp; found</p><button type="button" className="entry-skip" onClick={() => setLoading(false)}>Continue now</button></div>}
    <noscript>
      {/* eslint-disable-next-line @next/next/no-css-tags -- no-JS fallback must load without hydration and without inline CSP exemptions */}
      <link rel="stylesheet" href="/brand/entry-noscript.css" />
    </noscript>
    <div ref={content} className={`app-entry-content ${loading ? '' : 'entry-ready'}`}>{children}</div>
  </>
}
