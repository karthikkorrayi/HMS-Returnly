'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { loadMetricDetails } from '@/app/(app)/items/metric-actions'
import { useStaffPath } from '@/components/StaffHotel'
import { StatusBadge, TierBadge } from '@/components/Badges'
import { getDashboardView, type DashboardFilter } from '@/lib/item-dashboard'
export default function MetricDetails({ metric }: { metric: DashboardFilter }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadMetricDetails>> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const to = useStaffPath()
  useEffect(() => {
    let live = true
    loadMetricDetails(metric).then((data) => { if (live) setResult(data) }).catch(() => { if (live) setResult({ error:'Could not reach the server. Try again.' }) })
    return () => { live = false }
  }, [metric, attempt])
  const view = getDashboardView(metric)
  return <div>
    <p className="hint">Hotel-wide summary. Opening this dialog does not change your action board or its filters.</p>
    {!result && <p role="status" className="mt-4">Loading metric details…</p>}
    {result && 'error' in result && <div role="alert"><p>{result.error}</p><button className="btn btn-secondary mt-3" type="button" onClick={() => { setResult(null); setAttempt((n) => n+1) }}>Retry</button></div>}
    {result && 'items' in result && <>
      <p className="metric-total">{result.total}<span>{view.label.toLowerCase()}</span></p>
      <ul className="metric-detail-list">{result.items.map((item) => <li key={item.id}><Link href={to(`/items/${item.id}`)}><span className="font-semibold">{item.description}</span><span className="hint block">{item.code} · {item.location}</span><span className="flex gap-2 mt-2"><StatusBadge status={item.status}/><TierBadge tier={item.tier}/></span></Link></li>)}</ul>
      {result.total === 0 && <p className="hint">No items currently need attention in this category.</p>}
      {result.total > 10 && <p className="hint mt-3">Showing the first 10 of {result.total}. Open the filtered list to browse all records.</p>}
      <Link href={{pathname:to('/items'),query:{view:metric}}} className="btn btn-primary mt-5">Open {view.label.toLowerCase()} list</Link>
    </>}
  </div>
}
