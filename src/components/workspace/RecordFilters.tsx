'use client'
import { useState } from 'react'
export type FilterRecord = { id: string; search: string; status?: string; kind?: string; date?: string }
export default function RecordFilters({ records, children, scope, statusLabels = {}, kindLabels = {} }: { records: FilterRecord[]; children: React.ReactNode[]; scope: string; statusLabels?: Record<string,string>; kindLabels?: Record<string,string> }) {
  const [query, setQuery] = useState(''), [status,setStatus] = useState('all'), [kind,setKind] = useState('all'), [from,setFrom] = useState(''), [until,setUntil] = useState('')
  const statuses = [...new Set(records.flatMap((r) => r.status ? [r.status] : []))]
  const kinds = [...new Set(records.flatMap((r) => r.kind ? [r.kind] : []))]
  const visible = records.map((r,i) => ({r,i})).filter(({r}) => r.search.toLowerCase().includes(query.trim().toLowerCase()) && (status==='all' || r.status===status) && (kind==='all' || r.kind===kind) && (!from || (r.date??'').slice(0,10)>=from) && (!until || (r.date??'').slice(0,10)<=until))
  return <div className="space-y-4"><div className="filter-toolbar panel p-4"><label>Search<input type="search" className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search visible records"/></label>
    {statuses.length>0 && <label>Status<select className="field" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{statusLabels[s]??s}</option>)}</select></label>}
    {kinds.length>0 && <label>Type<select className="field" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All types</option>{kinds.map((s) => <option key={s} value={s}>{kindLabels[s]??s}</option>)}</select></label>}
    <label>From (UTC)<input type="date" className="field" max={until||undefined} value={from} onChange={(e) => setFrom(e.target.value)}/></label><label>To (UTC)<input type="date" className="field" min={from||undefined} value={until} onChange={(e) => setUntil(e.target.value)}/></label>
    <button className="btn btn-secondary" type="button" onClick={() => { setQuery('');setStatus('all');setKind('all');setFrom('');setUntil('') }}>Reset filters</button></div>
    <p className="hint" role="status">Showing {visible.length} of {records.length} · {scope}</p><ul className="space-y-3">{visible.map(({r,i}) => <li key={r.id}>{children[i]}</li>)}</ul>{visible.length===0 && <p className="panel p-5">No records match these filters.</p>}
  </div>
}
