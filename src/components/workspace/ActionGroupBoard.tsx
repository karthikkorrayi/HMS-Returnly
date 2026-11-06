'use client'
import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import { getActionBoard, saveActionBoard } from '@/app/(app)/items/organise/actions'
import type { ActionBoard, BoardCommand, GroupItem } from '@/lib/action-groups'
import { useStaffPath } from '@/components/StaffHotel'
import { StatusBadge, TierBadge } from '@/components/Badges'
import { notify } from '@/components/foundora/Toast'
import { Modal } from './Modal'
const closed = new Set(['returned','disposed','donated'])
type Drag = { item:GroupItem; x:number; y:number; moved:boolean; target:string|null; before:string|null }
export default function ActionGroupBoard({initial,manager,initialGroup}:{initial:ActionBoard;manager:boolean;initialGroup:string}) {
 const [board,setBoard]=useState(initial), [query,setQuery]=useState(''), [status,setStatus]=useState('open')
 const [group,setGroup]=useState(initial.groups.some((g)=>g.id===initialGroup)?initialGroup:'')
 const [pending,setPending]=useState(false), [message,setMessage]=useState(''), [error,setError]=useState('')
 const [editing,setEditing]=useState<{id?:string;title:string}|null>(null), [name,setName]=useState('')
 const [dragging,setDragging]=useState<string|null>(null), [hover,setHover]=useState<string|null>(null)
 const latch=useRef(false), drag=useRef<Drag|null>(null), ghost=useRef<HTMLDivElement>(null)
 const uid=useId(), to=useStaffPath()
 async function refresh() {
  if(latch.current)return
  latch.current=true;setPending(true)
  try{const r=await getActionBoard();if(r.ok){setBoard(r.board);setError('');setMessage('Board refreshed.')}else setError(r.error)}catch{setError('Could not reach the server. Try again.')}finally{latch.current=false;setPending(false)}
 }
 async function change(command:BoardCommand):Promise<boolean> {
  if(latch.current)return false
  latch.current=true;setPending(true);setError('');setMessage('Saving organisation…')
  try {
   const r=await saveActionBoard(board.version,command)
   if(!r.ok){setError(r.error);setMessage('The change was not saved.');notify('error',r.error);return false}
   setBoard(r.board);setMessage('Organisation saved. Custody status was not changed.');notify('success','Work-group organisation saved.');return true
  }catch{setError('Could not reach the server. Refresh before trying again.');setMessage('The change was not confirmed.');return false}
  finally{latch.current=false;setPending(false)}
 }
 function stopDrag(e:React.PointerEvent<HTMLButtonElement>,cancel=false) {
  const current=drag.current
  drag.current=null;setDragging(null);setHover(null)
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
  if(current?.moved&&!cancel&&current.target)void change({kind:'move_item',item:current.item.id,group:current.target,before:current.before})
 }
 function movePointer(e:React.PointerEvent<HTMLButtonElement>) {
  const d=drag.current;if(!d)return
  if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>7){d.moved=true;setDragging(d.item.id)}
  if(!d.moved)return
  ghost.current?.style.setProperty('--drag-x',`${e.clientX+12}px`)
  ghost.current?.style.setProperty('--drag-y',`${e.clientY+12}px`)
  const hit=document.elementFromPoint(e.clientX,e.clientY)
  const column=hit?.closest<HTMLElement>('[data-group-drop]')
  d.target=column?.dataset.groupDrop??null
  const card=hit?.closest<HTMLElement>('[data-item-drop]')
  d.before=card?.dataset.itemDrop??null
  setHover(d.target)
  const wrap=hit?.closest<HTMLElement>('.action-group-columns')
  if(wrap){const box=wrap.getBoundingClientRect();if(e.clientX>box.right-45)wrap.scrollBy({left:14});if(e.clientX<box.left+45)wrap.scrollBy({left:-14})}
  const edge=70
  if(e.clientY>innerHeight-edge)window.scrollBy({top:12})
  if(e.clientY<edge)window.scrollBy({top:-12})
 }
 const visible=board.items.filter((i)=>`${i.code} ${i.description} ${i.location}`.toLowerCase().includes(query.trim().toLowerCase())&&(status==='all'||closed.has(i.status)===(status==='closed')))
 const activeGroup=board.groups.some((g)=>g.id===group)?group:''
 const columns=board.groups.filter((g)=>!activeGroup||g.id===activeGroup)
 function itemControls(item:GroupItem,index:number,cards:GroupItem[]) {
  return <div className="group-card-controls"><label htmlFor={`${uid}-move-${item.id}`} className="sr-only">Move {item.code} to group</label><select id={`${uid}-move-${item.id}`} className="field" value={item.group_id??'unassigned'} disabled={pending} onChange={(e)=>void change({kind:'move_item',item:item.id,group:e.target.value})}>{board.groups.map((g)=><option key={g.id} value={g.id}>{g.title}</option>)}</select>
   <button type="button" className="icon-button" aria-label={`Move ${item.code} up`} disabled={pending||index===0} onClick={()=>void change({kind:'move_item',item:item.id,group:item.group_id,before:cards[index-1].id})}>↑</button>
   <button type="button" className="icon-button" aria-label={`Move ${item.code} down`} disabled={pending||index===cards.length-1} onClick={()=>void change({kind:'move_item',item:item.id,group:item.group_id,before:cards[index+2]?.id??null})}>↓</button></div>
 }
 return <div className="group-management"><header className="group-page-heading"><div><p className="eyebrow">Item organisation</p><h1 className="text-2xl font-bold">Action groups</h1><p className="hint mt-2">Drag using the grip, or use Move and the arrow buttons. Group changes do not change item custody status.</p></div><div className="flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={pending} onClick={()=>void refresh()}>Refresh board</button>{manager&&<button className="btn btn-primary" disabled={pending} onClick={()=>{setEditing({title:''});setName('')}}>Add group</button>}<Link className="btn btn-secondary" href={to('/items')}>Dashboard</Link></div></header>
  <div className="filter-toolbar panel p-4 mb-5"><label>Search items<input className="field" type="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Item, code or location"/></label><label>Status<select aria-label="Board status" className="field" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="open">Open items</option><option value="closed">Closed items</option><option value="all">All items</option></select></label><label>Group<select aria-label="Board group" className="field" value={activeGroup} onChange={(e)=>setGroup(e.target.value)}><option value="">All groups</option>{board.groups.map((g)=><option key={g.id} value={g.id}>{g.title}</option>)}</select></label><button className="btn btn-secondary" onClick={()=>{setQuery('');setStatus('open');setGroup('')}}>Reset filters</button></div>
  {board.total>board.items.length&&<p className="notice">Showing the first {board.items.length} of {board.total} hotel items. Use the dashboard to locate older records; group totals include all items.</p>}
  {error&&<div role="alert" className="group-error"><p>{error}</p><button className="btn btn-secondary" disabled={pending} onClick={()=>void refresh()}>Refresh board</button></div>}
  <p role="status" className="hint mb-4">{message||`${visible.length} matching items · ${board.total} hotel items · ${manager?'Managers can edit groups.':'Ask a manager to create or rename groups.'}`}</p>
  <div className="action-group-columns" aria-busy={pending}>{columns.map((g)=>{
   const cards=visible.filter((i)=>(i.group_id??'unassigned')===g.id), groupIndex=board.groups.findIndex((x)=>x.id===g.id)
   return <section key={g.id} data-group-drop={g.id} className={`action-group-column ${hover===g.id?'group-drop-active':''}`} aria-label={`${g.title} group`}><header><div><h2>{g.title}</h2><p className="hint">{cards.length} shown · {g.count} total</p></div>{manager&&g.id!=='unassigned'&&<details className="group-menu"><summary aria-label={`Manage ${g.title}`}>•••</summary><div><button disabled={pending} onClick={()=>{setEditing({id:g.id,title:g.title});setName(g.title)}}>Rename</button><button disabled={pending||groupIndex<=1} onClick={()=>void change({kind:'move_group',group:g.id,before:board.groups[groupIndex-1].id})}>Move column left</button><button disabled={pending||groupIndex===board.groups.length-1} onClick={()=>void change({kind:'move_group',group:g.id,before:board.groups[groupIndex+2]?.id??null})}>Move column right</button><button className="text-danger" disabled={pending} onClick={()=>{if(confirm(`Delete ${g.title}? Its items return to Unassigned. No item or custody record is deleted.`))void change({kind:'delete_group',group:g.id})}}>Delete group</button></div></details>}</header>
    <ol>{cards.map((item,index)=><li key={item.id} data-item-drop={item.id} className={`group-item-card ${dragging===item.id?'is-dragging':''}`}><div className="group-item-heading"><button type="button" className="drag-grip" aria-label={`Drag ${item.code}`} disabled={pending} onPointerDown={(e)=>{if(latch.current)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={item,x:e.clientX,y:e.clientY,moved:false,target:null,before:null}}} onPointerMove={movePointer} onPointerUp={(e)=>stopDrag(e)} onPointerCancel={(e)=>stopDrag(e,true)} onLostPointerCapture={()=>{drag.current=null;setDragging(null);setHover(null)}}>⠿</button><Link href={to(`/items/${item.id}`)}><strong>{item.description}</strong><span className="hint block">{item.code}</span></Link></div><p className="hint mt-2">{item.location}</p><div className="flex flex-wrap gap-2 my-3"><StatusBadge status={item.status}/><TierBadge tier={item.tier}/></div>{itemControls(item,index,cards)}</li>)}</ol>
    {cards.length===0&&<div className="group-empty">{g.count===0?'Drop an item here or choose this group from a card’s Move menu.':'No items match the current filters.'}</div>}
   </section>
  })}</div>
  <div ref={ghost} className={`drag-ghost ${dragging?'is-visible':''}`} aria-hidden="true">Moving item</div>
  <Modal open={editing!==null} title={editing?.id?'Rename group':'Add action group'} onClose={()=>setEditing(null)}>{editing&&<form className="space-y-4" onSubmit={async(e)=>{e.preventDefault();if(await change({kind:editing.id?'rename_group':'create_group',group:editing.id,title:name}))setEditing(null)}}><label className="label" htmlFor={`${uid}-group-name`}>Group name</label><input id={`${uid}-group-name`} className="field" value={name} onChange={(e)=>setName(e.target.value)} maxLength={60} required disabled={pending}/><p className="hint">Use work labels such as Team review or Return coordination. These are organisation groups, not item statuses.</p><button className="btn btn-primary" disabled={pending||!name.trim()}>{pending?'Saving…':'Save group'}</button>{error&&<p role="alert" className="text-danger">{error}</p>}</form>}</Modal>
 </div>
}
