'use server'
import { getSession, ITEM_ROLES } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { changeActionBoard, loadActionBoard, type BoardCommand } from '@/lib/action-groups'
export async function getActionBoard() {
 const me=await getSession()
 if(!me||!ITEM_ROLES.includes(me.staff.role))return {ok:false,error:'Your role cannot view the item organisation board.'} as const
 try{return {ok:true,board:await withStaff(me.staff.user_id,loadActionBoard)} as const}catch{return {ok:false,error:'Could not load the board. Please try again.'} as const}
}
export async function saveActionBoard(version:number,command:BoardCommand) {
 const me=await getSession()
 if(!me||!ITEM_ROLES.includes(me.staff.role))return {ok:false,error:'Sign in with an item-management role.'} as const
 try {
  const board=await withStaff(me.staff.user_id,async(tx)=>{await changeActionBoard(tx,version,command);return loadActionBoard(tx)})
  revalidatePath('/items')
  return {ok:true,board} as const
 } catch(e) {
  const error=e as {code?:string;message?:string}
  return {ok:false,error:error.code==='23505'?'That group name is already in use.': ['P0001','22023','42501'].includes(error.code??'')?error.message!:'The change was not saved. Refresh and try again.'} as const
 }
}
