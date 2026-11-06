import type { Tx } from './db/core'
import type { ItemStatus, ValueTier } from './types'
export type ActionGroup = { id:string; title:string; count:number }
export type GroupItem = { id:string; code:string; description:string; status:ItemStatus; tier:ValueTier; group_id:string|null; position:string; location:string }
export type ActionBoard = { version:number; groups:ActionGroup[]; items:GroupItem[]; total:number }
export type BoardCommand = { kind:'create_group'|'rename_group'|'delete_group'|'move_group'|'move_item'; group?:string|null; item?:string; before?:string|null; title?:string }
export async function loadGroupCounts(tx:Tx):Promise<ActionGroup[]> {
 const groups=(await tx.query<{id:string;title:string;count:number}>(`select g.id,g.title,count(b.item_id)::int as count from public.action_groups g left join public.action_group_items b on b.group_id=g.id and b.property_id=g.property_id where g.property_id=public.current_property_id() group by g.id,g.title,g.position order by g.position,g.id`)).rows
 const unassigned=(await tx.query<{count:number}>(`select count(*)::int as count from public.lost_items i where i.property_id=public.current_property_id() and not exists(select 1 from public.action_group_items b where b.item_id=i.id and b.group_id is not null)`)).rows[0].count
 return [{id:'unassigned',title:'Unassigned',count:unassigned},...groups]
}
export async function loadActionBoard(tx:Tx):Promise<ActionBoard> {
 const version=(await tx.query<{version:number}>(`select action_board_version as version from public.properties where id=public.current_property_id()`)).rows[0]?.version
 if(version===undefined)throw new Error('Hotel not found.')
 const groups=await loadGroupCounts(tx)
 const items=(await tx.query<GroupItem>(`select i.id,i.item_code as code,i.description,i.status::text as status,i.value_tier::text as tier,b.group_id,coalesce(b.position,9223372036854775807)::text as position,case when i.room_number is not null then 'Room '||i.room_number else coalesce(i.area_label,'Public area') end as location from public.lost_items i left join public.action_group_items b on b.item_id=i.id and b.property_id=i.property_id where i.property_id=public.current_property_id() order by b.position nulls last,i.found_at desc,i.id limit 1000`)).rows
 return {version,groups,items,total:groups.reduce((n,g)=>n+g.count,0)}
}
export async function changeActionBoard(tx:Tx,version:number,c:BoardCommand) {
 if(!Number.isSafeInteger(version)||version<0)throw new Error('Invalid board version.')
 return tx.rpc('organise_action_board',{p_expected:version,p_kind:c.kind,p_group:c.group==='unassigned'?null:c.group??null,p_item:c.item??null,p_before:c.before??null,p_title:c.title??null})
}
