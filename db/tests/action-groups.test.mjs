import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { loadActionBoard, changeActionBoard } from '../../src/lib/action-groups.ts'
const {db,kind,urlFor,close}=await openTestDb('action_groups');const real=kind!=='PGlite';console.log('database: '+kind)
let failures=0
const check=(ok,label)=>{console.log(`  ${ok?'ok':'FAIL'} ${label}`);if(!ok)failures++}
await db.exec(readFileSync(new URL('../bootstrap/000_platform.sql',import.meta.url),'utf8'))
for(const f of readdirSync(new URL('../migrations/',import.meta.url)).sort())await db.exec(`set role app_owner;\n${readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8')}\n;reset role;`)
await db.exec(`set role app_owner;\n${readFileSync(new URL('../seed.sql',import.meta.url),'utf8')}\n;reset role;`)
const M=randomUUID(),H=randomUUID(),S=randomUUID(),O=randomUUID(),A=randomUUID(),B=randomUUID(),X=randomUUID()
await db.exec(`set role app_owner;
insert into public.properties(inn_code,name) values('OTHER','Other Hotel');
insert into auth.users(id) values('${M}'),('${H}'),('${S}'),('${O}');
insert into public.staff(user_id,property_id,username,display_name,role) select u,p.id,n,n,r::public.staff_role from (values ('${M}'::uuid,'DEMO','board.manager','manager'),('${H}'::uuid,'DEMO','board.house','housekeeping'),('${S}'::uuid,'DEMO','board.support','support'),('${O}'::uuid,'OTHER','board.other','manager')) v(u,code,n,r) join public.properties p on p.inn_code=v.code;
insert into public.lost_items(id,property_id,found_area_type,area_label,found_at,found_by,category,description,value_tier) select v.id,p.id,'public_area','Lobby',now(),u,'other',d,'standard' from (values('${A}'::uuid,'DEMO','${M}'::uuid,'Item A'),('${B}'::uuid,'DEMO','${M}'::uuid,'Item B'),('${X}'::uuid,'OTHER','${O}'::uuid,'Other private item')) v(id,code,u,d) join public.properties p on p.inn_code=v.code;
reset role;`)
let pool
if(real){const pg=(await import('pg')).default;pool=new pg.Pool({connectionString:urlFor('app_user'),max:3,types:returnlyTypes})}
else{await db.exec('set role app_user');pool={connect:async()=>({query:(q,p)=>db.query(q,p).then(r=>({...r,rowCount:r.affectedRows??r.rows.length})),release(){}})}}
const app=createDb(pool), read=(who=M)=>app.withStaff(who,loadActionBoard)
const error=async(fn)=>{try{await fn();return ''}catch(e){return e.code??e.message}}
async function apply(who,c,version){return app.withStaff(who,async(tx)=>{await changeActionBoard(tx,version??(await loadActionBoard(tx)).version,c);return loadActionBoard(tx)})}
let board=await read();check(board.version===0&&board.items.length===2&&board.groups[0].count===2,'new board has real unassigned hotel items')
check(await error(()=>apply(H,{kind:'create_group',title:'Forbidden'}))==='42501','housekeeping cannot create groups')
check(await error(()=>apply(S,{kind:'move_item',item:A}))==='42501','support cannot organise items')
board=await apply(M,{kind:'create_group',title:'Team review'});const G=board.groups[1].id
check(board.version===1&&board.groups[1].title==='Team review','manager creates a persistent group')
check(await error(()=>apply(M,{kind:'create_group',title:'TEAM REVIEW'}))==='23505','case-insensitive duplicate names are rejected')
const other=await apply(O,{kind:'create_group',title:'Other group'});const OG=other.groups[1].id
check(other.items.length===1&&other.items[0].id===X,'another hotel sees only its own items')
const custodyBefore=(await app.withStaff(M,(tx)=>tx.query('select count(*)::int n from public.custody_events'))).rows[0].n
board=await apply(H,{kind:'move_item',item:A,group:G});check(board.items.find(i=>i.id===A).group_id===G,'housekeeping moves a card within its hotel')
board=await apply(H,{kind:'move_item',item:B,group:G});const stale=board.version
board=await apply(H,{kind:'move_item',item:B,group:G,before:A});check(board.items.filter(i=>i.group_id===G)[0].id===B,'card ordering is persisted')
check(await error(()=>apply(M,{kind:'move_item',item:A,group:G},stale))==='P0001','stale edits are rejected without overwriting another session')
check(await error(()=>apply(M,{kind:'move_item',item:X,group:G}))==='22023','foreign hotel item cannot be moved')
check(await error(()=>apply(M,{kind:'move_item',item:A,group:OG}))==='22023','foreign hotel group cannot receive this card')
check(await error(()=>apply(M,{kind:'move_item',item:A,group:G,before:X}))==='22023','foreign target item cannot be used as a reorder anchor')
check(await error(()=>app.withStaff(H,(tx)=>tx.query('delete from public.action_groups'))) === '42501','direct group writes are denied')
check(await error(()=>app.withAnon((tx)=>tx.query('select * from public.action_group_items'))) === '42501','guests cannot read work groups')
check((await app.withStaff(S,(tx)=>tx.query('select * from public.action_groups'))).rows.length===0,'support cannot read private group rows')
board=await apply(M,{kind:'create_group',title:'Follow up'});const G2=board.groups.find(g=>g.title==='Follow up').id
board=await apply(M,{kind:'move_group',group:G2,before:G});check(board.groups[1].id===G2,'managers can reorder columns')
board=await apply(M,{kind:'rename_group',group:G,title:'Verification'});check(board.groups.find(g=>g.id===G).title==='Verification','group renaming is saved')
board=await apply(M,{kind:'delete_group',group:G});check(board.items.length===2&&board.items.every(i=>i.group_id===null),'deleting a group returns cards to Unassigned without deleting items')
check(board.items.every(i=>i.status==='logged'),'organisation never changes item custody status')
const custodyAfter=(await app.withStaff(M,(tx)=>tx.query('select count(*)::int n from public.custody_events'))).rows[0].n
check(custodyBefore===custodyAfter,'organisation does not fabricate custody events')
if(real)await pool.end();else await db.exec('reset role');await close();console.log(failures?`${failures} FAILED`:'all action-group checks passed');process.exit(failures?1:0)
