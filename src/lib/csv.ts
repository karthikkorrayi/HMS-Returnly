// Turns a stays CSV (a PMS arrivals/in-house/departures export, or a Google
// Sheet downloaded as CSV) into rows for the import_stays database function.
// Pure functions, no dependencies, so they run in the browser and in tests.

export type StayImportRow = {
  room_number: string
  reservation_ref: string
  guest_surname: string
  check_in_date: string // YYYY-MM-DD
  check_out_date: string // YYYY-MM-DD
  status: 'in_house' | 'departed' | 'cancelled'
  checked_out_at?: string // ISO timestamp
}

export type ParseProblem = { line: number; message: string }

// Header names hotels actually use, normalised (lowercase, letters only).
const HEADERS: Record<keyof StayImportRow, string[]> = {
  room_number: ['room', 'roomnumber', 'roomno', 'rm'],
  reservation_ref: ['reservationref', 'confirmation', 'confirmationnumber', 'confirmationno', 'confno', 'conf', 'reservation', 'reservationnumber', 'resno', 'bookingref', 'booking'],
  guest_surname: ['guestsurname', 'surname', 'lastname', 'familyname', 'guestlastname'],
  check_in_date: ['checkindate', 'checkin', 'arrival', 'arrivaldate', 'arrive'],
  check_out_date: ['checkoutdate', 'checkout', 'departure', 'departuredate', 'depart'],
  status: ['status', 'reservationstatus', 'staystatus'],
  checked_out_at: ['checkedoutat', 'actualdeparture', 'actualcheckout', 'departuretime'],
}

const REQUIRED: (keyof StayImportRow)[] = ['room_number', 'reservation_ref', 'guest_surname', 'check_in_date', 'check_out_date']

const LABEL: Record<keyof StayImportRow, string> = {
  room_number: 'Room',
  reservation_ref: 'Confirmation number',
  guest_surname: 'Surname',
  check_in_date: 'Check-in date',
  check_out_date: 'Check-out date',
  status: 'Status',
  checked_out_at: 'Actual departure',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

// RFC 4180-style: quoted fields, doubled quotes, commas/newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

// Accepts 2026-10-07, 07/10/2026 and 7/10/26 (UK day-first). Returns
// YYYY-MM-DD or null.
export function parseDate(value: string): string | null {
  const v = value.trim()
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  const uk = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (uk) [d, m, y] = [Number(uk[1]), Number(uk[2]), Number(uk[3].length === 2 ? `20${uk[3]}` : uk[3])]
  else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseStatus(value: string, checkOut: string, today: string): StayImportRow['status'] | null {
  const v = norm(value)
  if (!v) return checkOut < today ? 'departed' : 'in_house'
  if (['inhouse', 'checkedin', 'arrived', 'staying', 'inh'].includes(v)) return 'in_house'
  if (['departed', 'checkedout', 'checkout', 'out', 'dep'].includes(v)) return 'departed'
  if (['cancelled', 'canceled', 'noshow', 'cxl', 'cancel'].includes(v)) return 'cancelled'
  return null
}

export function toStayRows(
  table: string[][],
  today: string
): { rows: StayImportRow[]; problems: ParseProblem[]; missingColumns: string[] } {
  if (table.length === 0) return { rows: [], problems: [], missingColumns: REQUIRED.map((k) => LABEL[k]) }

  const header = table[0].map(norm)
  const col = {} as Record<keyof StayImportRow, number>
  for (const key of Object.keys(HEADERS) as (keyof StayImportRow)[]) {
    col[key] = header.findIndex((h) => h === norm(key) || HEADERS[key].includes(h))
  }
  const missingColumns = REQUIRED.filter((k) => col[k] < 0).map((k) => LABEL[k])
  if (missingColumns.length) return { rows: [], problems: [], missingColumns }

  const rows: StayImportRow[] = []
  const problems: ParseProblem[] = []
  table.slice(1).forEach((cells, i) => {
    const line = i + 2
    const cell = (k: keyof StayImportRow) => (col[k] >= 0 ? (cells[col[k]] ?? '').trim() : '')

    const checkIn = parseDate(cell('check_in_date'))
    const checkOut = parseDate(cell('check_out_date'))
    if (!cell('room_number') || !cell('reservation_ref') || !cell('guest_surname')) {
      problems.push({ line, message: 'Room, confirmation number or surname is empty' })
      return
    }
    if (!checkIn || !checkOut) {
      problems.push({ line, message: 'Dates must look like 2026-10-07 or 07/10/2026' })
      return
    }
    if (checkOut < checkIn) {
      problems.push({ line, message: 'Check-out is before check-in' })
      return
    }
    const status = parseStatus(cell('status'), checkOut, today)
    if (!status) {
      problems.push({ line, message: `Unknown status “${cell('status')}” (use In house, Departed or Cancelled)` })
      return
    }
    let checkedOutAt: string | undefined
    if (cell('checked_out_at')) {
      const t = new Date(cell('checked_out_at'))
      if (Number.isNaN(t.getTime())) {
        problems.push({ line, message: 'Actual departure time is not a valid date/time' })
        return
      }
      checkedOutAt = t.toISOString()
    }

    rows.push({
      room_number: cell('room_number'),
      reservation_ref: cell('reservation_ref'),
      guest_surname: cell('guest_surname'),
      check_in_date: checkIn,
      check_out_date: checkOut,
      status,
      ...(checkedOutAt ? { checked_out_at: checkedOutAt } : {}),
    })
  })
  return { rows, problems, missingColumns: [] }
}
