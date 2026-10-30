// First-time hotel setup (S2). Turns the setup form into the configuration
// that public.complete_initial_setup() stores, and runs the two-part setup:
//   1. create the first manager's login (Better Auth, schema auth);
//   2. create the hotel, floors, rooms, areas, storage places, the manager's
//      staff row and the "set up" record — one database transaction that the
//      database refuses to run twice.
// If step 2 fails, the login from step 1 is removed again, so a failed
// attempt leaves nothing behind and can simply be repeated.
// No Next.js imports, so it can be unit tested.
import { timingSafeEqual, createHash } from 'node:crypto'
import type { Auth } from './better-auth/config'
import { MAX_PASSWORD, MIN_PASSWORD } from './better-auth/rules'
import { createStaffLogin, normaliseUsername, StaffLoginError } from './better-auth/staff-logins'
import type { Tx } from './db/core'

export class SetupError extends Error {}

export const MIN_SETUP_TOKEN = 24
export const MAX_ROOMS_PER_FLOOR = 500
export const DEFAULT_AREAS = ['Lobby', 'Reception', 'Restaurant', 'Bar', 'Gym', 'Pool', 'Meeting rooms', 'Car park', 'Lifts', 'Corridor']
export const DEFAULT_STORAGE = [
  { label: 'Front desk safe', secure: true },
  { label: 'Housekeeping office', secure: false },
]

export type SetupConfig = {
  hotel: { code: string; name: string; address: string; phone: string; email: string; support_hours: string; support_note: string }
  floors: { name: string; rooms: string[] }[]
  areas: string[]
  storage: { label: string; secure: boolean }[]
}
export type SetupAdmin = { name: string; username: string; password: string }

/** Compares the typed setup key with SETUP_TOKEN without leaking timing. */
export function setupTokenMatches(given: string, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_SETUP_TOKEN) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Is SETUP_TOKEN usable? (Set, and long enough not to be guessed.) */
export function setupTokenConfigured(expected: string | undefined): boolean {
  return typeof expected === 'string' && expected.length >= MIN_SETUP_TOKEN
}

/**
 * "101, 102, 105-110" → ["101", "102", "105", …, "110"]. Commas, spaces or new
 * lines separate rooms. A range needs two plain numbers of the same length
 * ("101-110", "01-12"); anything else with a dash (e.g. "G-01") is one room.
 */
export function parseRoomList(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const part = raw.trim()
    if (!part) continue
    const m = part.match(/^(\d+)-(\d+)$/)
    if (m && m[1].length === m[2].length) {
      const from = Number(m[1]), to = Number(m[2])
      if (to < from) throw new SetupError(`Room range ${part}: the second number must be the larger one.`)
      if (to - from + 1 > MAX_ROOMS_PER_FLOOR) throw new SetupError(`Room range ${part} is too long (at most ${MAX_ROOMS_PER_FLOOR} rooms).`)
      for (let n = from; n <= to; n++) out.push(String(n).padStart(m[1].length, '0'))
    } else {
      out.push(part)
    }
  }
  return out
}

const LIST = (text: string) => text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)

/** Validates the whole form (the database checks everything again). */
export function buildSetup(form: {
  code: string; name: string; address: string; phone: string; email: string; supportHours: string; supportNote: string
  floorNames: string[]; floorRooms: string[]
  areas: string
  storageLabels: string[]; storageKinds: string[]
  adminName: string; adminUsername: string; adminPassword: string; adminPassword2: string
}): { config: SetupConfig; admin: SetupAdmin } {
  const code = form.code.trim().toUpperCase()
  if (!/^[A-Z0-9]{3,10}$/.test(code)) throw new SetupError('Hotel code: 3–10 letters or digits, e.g. GRAND. It appears on every item tag and cannot be changed later.')
  const name = form.name.trim()
  if (name.length < 2 || name.length > 100) throw new SetupError('Hotel name: 2–100 characters.')
  const email = form.email.trim().toLowerCase()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new SetupError('The contact email does not look right.')
  const phone = form.phone.trim()
  if (phone && !/^[0-9 +()-]{5,30}$/.test(phone)) throw new SetupError('Contact phone: digits, spaces, +, ( ) and dashes only.')
  if (form.address.trim().length > 300) throw new SetupError('Address: at most 300 characters.')

  const floors: SetupConfig['floors'] = []
  const seenFloors = new Set<string>()
  const seenRooms = new Map<string, string>()
  form.floorNames.forEach((rawName, i) => {
    const floorName = rawName.trim()
    const roomsText = form.floorRooms[i] ?? ''
    if (!floorName && !roomsText.trim()) return // an empty row
    if (!/^[A-Za-z0-9 ._-]{1,20}$/.test(floorName)) throw new SetupError(`Floor ${i + 1}: give it a name (1–20 letters or digits, e.g. "Ground" or "1").`)
    if (seenFloors.has(floorName.toLowerCase())) throw new SetupError(`Floor "${floorName}" is listed twice.`)
    seenFloors.add(floorName.toLowerCase())
    const rooms = parseRoomList(roomsText)
    if (rooms.length === 0) throw new SetupError(`Floor "${floorName}": add its room numbers, e.g. 101, 102, 103 or 101-120.`)
    if (rooms.length > MAX_ROOMS_PER_FLOOR) throw new SetupError(`Floor "${floorName}": at most ${MAX_ROOMS_PER_FLOOR} rooms.`)
    for (const r of rooms) {
      if (!/^[A-Za-z0-9-]{1,10}$/.test(r)) throw new SetupError(`Room "${r.slice(0, 20)}" on floor "${floorName}": 1–10 letters, digits or dashes.`)
      const other = seenRooms.get(r.toUpperCase())
      if (other !== undefined) throw new SetupError(`Room ${r} is listed twice${other === floorName ? ` on floor "${floorName}"` : ` (floors "${other}" and "${floorName}")`}.`)
      seenRooms.set(r.toUpperCase(), floorName)
    }
    floors.push({ name: floorName, rooms })
  })
  if (floors.length === 0) throw new SetupError('Add at least one floor with its rooms.')

  const areas = LIST(form.areas)
  const seenAreas = new Set<string>()
  for (const a of areas) {
    if (a.length > 60) throw new SetupError(`Area "${a.slice(0, 20)}…": at most 60 characters.`)
    if (seenAreas.has(a.toLowerCase())) throw new SetupError(`Area "${a}" is listed twice.`)
    seenAreas.add(a.toLowerCase())
  }

  const storage: SetupConfig['storage'] = []
  const seenStorage = new Set<string>()
  form.storageLabels.forEach((raw, i) => {
    const label = raw.trim()
    if (!label) return
    if (label.length > 60) throw new SetupError(`Storage place "${label.slice(0, 20)}…": at most 60 characters.`)
    if (seenStorage.has(label.toLowerCase())) throw new SetupError(`Storage place "${label}" is listed twice.`)
    seenStorage.add(label.toLowerCase())
    storage.push({ label, secure: form.storageKinds[i] === 'secure' })
  })
  if (storage.length === 0) throw new SetupError('Add at least one place where found items are kept.')

  const adminName = form.adminName.trim()
  if (adminName.length < 1 || adminName.length > 80) throw new SetupError('Administrator name: 1–80 characters.')
  let username: string
  try {
    username = normaliseUsername(form.adminUsername)
  } catch (e) {
    throw new SetupError((e as Error).message)
  }
  if (form.adminPassword.length < MIN_PASSWORD || form.adminPassword.length > MAX_PASSWORD) {
    throw new SetupError(`Administrator password: ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`)
  }
  if (form.adminPassword !== form.adminPassword2) throw new SetupError('The two administrator passwords do not match.')

  return {
    config: {
      hotel: { code, name, address: form.address.trim(), phone, email, support_hours: form.supportHours.trim(), support_note: form.supportNote.trim() },
      floors,
      areas,
      storage,
    },
    admin: { name: adminName, username, password: form.adminPassword },
  }
}

export type SetupDeps = {
  auth: Auth
  withAnon: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
}

/** Is this installation set up? (Anyone may ask; nothing else is revealed.) */
export async function isSetUp(withAnon: SetupDeps['withAnon']): Promise<boolean> {
  return withAnon(async (tx) => (await tx.query<{ s: boolean }>('select public.setup_status() as s')).rows[0].s === true)
}

const DB_MESSAGES = /^(Hotel|Floor|Room|Area|Storage|Add at least|At most|The administrator login)/

/** Creates the first manager's login, then the whole hotel. All or nothing. */
export async function runInitialSetup(deps: SetupDeps, input: { config: SetupConfig; admin: SetupAdmin }): Promise<{ propertyId: string }> {
  if (await isSetUp(deps.withAnon)) throw new SetupError('This installation is already set up. Sign in instead.')
  let userId: string
  try {
    userId = await createStaffLogin(deps.auth, { username: input.admin.username, password: input.admin.password, name: input.admin.name })
  } catch (e) {
    if (e instanceof StaffLoginError) throw new SetupError(e.message)
    if (/already|exists|unique/i.test(String((e as Error)?.message))) {
      throw new SetupError('That username is already taken. Choose another one.')
    }
    throw e
  }
  try {
    const r = await deps.withAnon((tx) =>
      tx.query<{ id: string }>(`select public.complete_initial_setup($1::uuid, $2, $3, $4::jsonb) as id`, [
        userId, input.admin.username, input.admin.name, JSON.stringify(input.config),
      ])
    )
    return { propertyId: r.rows[0].id }
  } catch (e) {
    // The hotel was not created: remove the new login again (its account and
    // sessions go with it), so nothing is left half-done.
    const ctx = await deps.auth.$context
    await ctx.internalAdapter.deleteUser(userId).catch(() => {})
    const err = e as { code?: string; message?: string }
    if (err.code === '42501') throw new SetupError('This installation is already set up. Sign in instead.')
    if (err.code === 'P0001' || DB_MESSAGES.test(err.message ?? '')) throw new SetupError(err.message ?? 'Setup was refused.')
    if (err.code === '23505') throw new SetupError('Something in the form is listed twice (a room, floor, area or storage place).')
    if (err.code === '23514') throw new SetupError('One of the values is not in the expected format (check the contact email and phone).')
    throw e
  }
}
