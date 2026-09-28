import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import LogItemForm from './LogItemForm'

export default async function NewItemPage() {
  const { staff, property } = await requireSession()
  const supabase = await createClient()
  const { data: rooms } = await supabase
    .from('rooms')
    .select('room_number')
    .order('room_number')
    .returns<{ room_number: string }[]>()

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Log a found item</h1>
      <p className="hint mt-1">Takes about a minute. Write the code you get on the item’s tag.</p>
      <LogItemForm
        propertyId={property.id}
        userId={staff.user_id}
        rooms={(rooms ?? []).map((r) => r.room_number)}
      />
    </div>
  )
}
