'use client'
import { useState } from 'react'
import { ROLE_LABEL, type Staff } from '@/lib/types'
import { Modal } from './Modal'
export default function StaffDirectory({ staff, profiles, me }: { staff: Staff[]; profiles: React.ReactNode[]; me: string }) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const visible = staff.filter((s) => `${s.display_name} ${s.username}`.toLowerCase().includes(query.toLowerCase().trim()) && (role==='all' || s.role===role) && (status==='all' || s.active === (status==='active')))
  const index = staff.findIndex((s) => s.user_id===selected)
  return <section aria-labelledby="team"><div className="flex flex-wrap justify-between gap-3 mb-4"><h2 id="team" className="text-lg font-bold">Staff directory</h2><p className="hint">{staff.filter((s) => s.active).length} active · {staff.length} total</p></div>
    <div className="filter-toolbar panel p-4"><label>Search staff<input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or username"/></label><label>Role<select aria-label="Staff role" className="field" value={role} onChange={(e) => setRole(e.target.value)}><option value="all">All roles</option>{Object.entries(ROLE_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Access<select aria-label="Staff access" className="field" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Deactivated</option></select></label><button type="button" className="btn btn-secondary" onClick={() => { setQuery('');setRole('all');setStatus('all') }}>Reset filters</button></div>
    <p className="hint my-3" role="status">Showing {visible.length} of {staff.length} staff accounts</p>
    <ul className="staff-directory">{visible.map((s) => <li key={s.user_id}><button className="staff-directory-row" type="button" aria-haspopup="dialog" onClick={() => setSelected(s.user_id)}><span className="staff-avatar">{s.display_name.slice(0,1).toUpperCase()}</span><span><strong>{s.display_name}{s.user_id===me?' (you)':''}</strong><span className="hint block">{s.username} · {ROLE_LABEL[s.role]}</span></span><span className={`badge ${s.active?'bg-done-soft text-done':'bg-danger-soft text-danger'}`}>{s.active?'Active':'Deactivated'}</span><span aria-hidden="true">→</span></button></li>)}</ul>
    {visible.length===0 && <p className="panel p-5">No staff match these filters.</p>}
    <Modal open={index>=0} title={index>=0 ? `${staff[index].display_name} — access profile` : 'Staff profile'} onClose={() => setSelected(null)}>{index>=0 && profiles[index]}</Modal>
  </section>
}
