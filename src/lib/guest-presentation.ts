import 'server-only'
import { cache } from 'react'
import { withAnon } from '@/lib/db'
import { publicContacts } from '@/lib/hotel-config'
import { listHotels } from '@/lib/requests/public-actions'

// Reuse Railway's existing public, permission-scoped database APIs. React cache
// shares these reads between the root layout and homepage within one request.
export const loadGuestPresentation = cache(async () => {
  const [hotels, contacts] = await Promise.all([
    listHotels(),
    withAnon(publicContacts).catch(() => []),
  ])
  return { hotels, contacts }
})
