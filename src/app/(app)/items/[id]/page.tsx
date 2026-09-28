import { notFound } from 'next/navigation'
import Link from 'next/link'
import { canManageItems, requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { signPhotoUrls } from '@/lib/photo-urls'
import { formatDate, formatDateTime, hotelToday } from '@/lib/format'
import { MAX_PHOTOS } from '@/lib/photos'
import {
  CATEGORY_LABEL,
  CLOSED_STATUSES,
  STATUS_LABEL,
  type CustodyEvent,
  type GuestCandidate,
  type Handover,
  type LostItem,
  type Staff,
  type StorageLocation,
} from '@/lib/types'
import { StatusBadge, TierBadge } from '@/components/Badges'
import ActionForm from '@/components/ActionForm'
import NextStep, { ItemTools } from './NextStep'
import Candidates from './Candidates'
import AddPhotos from './AddPhotos'
import { deletePhoto } from './actions'

const HANDOVER_LABEL = {
  in_person: 'Handed to guest in person',
  courier: 'Posted to guest',
  disposed: 'Disposed of',
  donated: 'Donated',
}

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ logged?: string; photos_failed?: string }>
}) {
  const { staff: me, property } = await requireSession()
  const { id } = await params
  const flags = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const supabase = await createClient()
  const { data: item } = await supabase.from('lost_items').select('*').eq('id', id).maybeSingle<LostItem>()
  if (!item) notFound()

  const manage = canManageItems(me.role)
  const [photosRes, candidatesRes, eventsRes, handoverRes, locationsRes, staffRes] = await Promise.all([
    supabase.from('item_photos').select('id, storage_path, uploaded_by, uploaded_at').eq('item_id', id).order('uploaded_at'),
    manage
      ? supabase.from('guest_candidates').select('*').eq('item_id', id).order('added_at').returns<GuestCandidate[]>()
      : Promise.resolve({ data: [] as GuestCandidate[] }),
    supabase.from('custody_events').select('*').eq('item_id', id).order('id', { ascending: false }).returns<CustodyEvent[]>(),
    supabase.from('handovers').select('*').eq('item_id', id).maybeSingle<Handover>(),
    supabase.from('storage_locations').select('id, label, is_secure, active').order('label').returns<StorageLocation[]>(),
    supabase.from('staff').select('user_id, property_id, username, display_name, role, active').order('display_name').returns<Staff[]>(),
  ])

  const photos = photosRes.data ?? []
  const candidates = candidatesRes.data ?? []
  const events = eventsRes.data ?? []
  const handover = handoverRes.data
  const locations = locationsRes.data ?? []
  const staff = staffRes.data ?? []
  const names = Object.fromEntries(staff.map((s) => [s.user_id, s.display_name]))
  const locationName = Object.fromEntries(locations.map((l) => [l.id, l.label]))
  const urls = await signPhotoUrls(supabase, photos.map((p) => p.storage_path))

  const closed = CLOSED_STATUSES.includes(item.status)
  const where = item.found_area_type === 'room' ? `Room ${item.room_number}` : item.area_label
  const pastRetention = !closed && item.dispose_after < hotelToday()
  const canAddPhotos = !closed && item.value_tier !== 'sensitive' && photos.length < MAX_PHOTOS

  const facts: [string, React.ReactNode][] = [
    ['Found in', where],
    ['Found', formatDateTime(item.found_at)],
    ['Found by', names[item.found_by] ?? '—'],
    ['Type', CATEGORY_LABEL[item.category] ?? item.category],
    ...(item.brand ? [['Brand', item.brand] as [string, string]] : []),
    ...(item.colour ? [['Colour', item.colour] as [string, string]] : []),
    ['Stored in', item.storage_location_id ? locationName[item.storage_location_id] ?? '—' : 'Not stored yet'],
    [
      'Keep until',
      <span key="k" className={pastRetention ? 'font-semibold text-attention' : undefined}>
        {formatDate(item.dispose_after)}
        {pastRetention ? ' — past retention' : ''}
      </span>,
    ],
  ]

  return (
    <div className="space-y-5">
      <Link href="/items" className="text-sm font-semibold text-teal">← All items</Link>

      {flags.logged && (
        <div role="status" className="panel border-teal bg-teal-soft p-4">
          <p className="font-semibold">Item logged. Write this code on the item’s tag:</p>
          <p className="mt-3"><span className="tag tag-lg">{item.item_code}</span></p>
          {flags.photos_failed && (
            <p className="mt-3 text-sm text-danger">
              {flags.photos_failed} photo(s) did not upload. Add them again below.
            </p>
          )}
        </div>
      )}

      <header className="space-y-3">
        <span className="tag tag-lg">{item.item_code}</span>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          <TierBadge tier={item.value_tier} />
        </div>
        <h1 className="text-2xl font-bold">{item.description}</h1>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <NextStep item={item} me={me} staff={staff} locations={locations} />

          {handover && (
            <section aria-labelledby="handover" className="panel p-4 sm:p-5">
              <h2 id="handover" className="text-lg font-bold">{HANDOVER_LABEL[handover.method]}</h2>
              <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted">When</dt>
                <dd>{formatDateTime(handover.handed_over_at)}</dd>
                <dt className="text-muted">By</dt>
                <dd>{names[handover.handed_over_by] ?? '—'}</dd>
                {handover.witness && (
                  <>
                    <dt className="text-muted">Witness</dt>
                    <dd>{names[handover.witness] ?? '—'}</dd>
                  </>
                )}
                {handover.method === 'in_person' && (
                  <>
                    <dt className="text-muted">ID checked</dt>
                    <dd>Yes</dd>
                  </>
                )}
                {handover.courier_tracking && (
                  <>
                    <dt className="text-muted">Tracking</dt>
                    <dd className="font-semibold">{handover.courier_tracking}</dd>
                  </>
                )}
                {handover.note && (
                  <>
                    <dt className="text-muted">Note</dt>
                    <dd>{handover.note}</dd>
                  </>
                )}
              </dl>
            </section>
          )}

          <section aria-labelledby="photos" className="panel p-4 sm:p-5">
            <h2 id="photos" className="mb-3 text-lg font-bold">Photos</h2>
            {item.value_tier === 'sensitive' && photos.length === 0 && (
              <p className="hint">Sensitive items are not photographed.</p>
            )}
            {photos.length > 0 && (
              <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((p) => (
                  <li key={p.id} className="space-y-1">
                    {urls[p.storage_path] ? (
                      <a href={urls[p.storage_path]} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-paper">
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                        <img src={urls[p.storage_path]} alt={`Photo of ${item.item_code}`} className="h-full w-full object-cover" />
                      </a>
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-paper text-sm text-muted">Unavailable</div>
                    )}
                    {me.role === 'manager' && (
                      <ActionForm
                        action={deletePhoto}
                        hidden={{ item_id: item.id, photo_id: p.id }}
                        submitLabel="Delete"
                        variant="secondary"
                        confirmText="Delete this photo permanently?"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canAddPhotos && (
              <AddPhotos
                propertyId={property.id}
                itemId={item.id}
                userId={me.user_id}
                remaining={MAX_PHOTOS - photos.length}
              />
            )}
          </section>

          {manage && <Candidates item={item} candidates={candidates} names={names} />}

          <ItemTools item={item} me={me} locations={locations} />
        </div>

        <div className="space-y-5">
          <section aria-labelledby="details" className="panel p-4 sm:p-5">
            <h2 id="details" className="mb-3 text-lg font-bold">Details</h2>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="history" className="panel p-4 sm:p-5">
            <h2 id="history" className="mb-3 text-lg font-bold">History</h2>
            <ol className="relative space-y-4 border-l-2 border-line pl-4">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-teal" aria-hidden />
                  <p className="font-semibold">
                    {e.from_status === e.to_status ? e.note ?? 'Updated' : STATUS_LABEL[e.to_status]}
                  </p>
                  <p className="hint">
                    {formatDateTime(e.created_at)} · {names[e.actor] ?? 'staff'}
                    {e.storage_location_id && e.to_status !== 'returned' ? ` · ${locationName[e.storage_location_id] ?? ''}` : ''}
                  </p>
                  {e.note && e.from_status !== e.to_status && <p className="mt-0.5 text-sm">{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
