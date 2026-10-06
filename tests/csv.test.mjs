import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, parseDate, parseStatus, toStayRows } from '../src/lib/csv.ts'

const TODAY = '2026-10-07'

test('parses quoted fields, doubled quotes, CRLF and a BOM', () => {
  const t = parseCsv('﻿Room,Note\r\n109,"Late, ""VIP"""\r\n\r\n110,plain\n')
  assert.deepEqual(t, [['Room', 'Note'], ['109', 'Late, "VIP"'], ['110', 'plain']])
})

test('dates: ISO and UK day-first, rejects impossible dates', () => {
  assert.equal(parseDate('2026-10-07'), '2026-10-07')
  assert.equal(parseDate('07/10/2026'), '2026-10-07')
  assert.equal(parseDate('7/10/26'), '2026-10-07')
  assert.equal(parseDate('31/02/2026'), null)
  assert.equal(parseDate('10-07'), null)
})

test('status: PMS wording, and inferred from the dates when blank', () => {
  assert.equal(parseStatus('In House', '2026-10-09', TODAY), 'in_house')
  assert.equal(parseStatus('Checked Out', '2026-10-06', TODAY), 'departed')
  assert.equal(parseStatus('No Show', '2026-10-09', TODAY), 'cancelled')
  assert.equal(parseStatus('', '2026-10-06', TODAY), 'departed')
  assert.equal(parseStatus('', '2026-10-09', TODAY), 'in_house')
  assert.equal(parseStatus('maybe', '2026-10-09', TODAY), null)
})

test('maps the hotel’s own column names and reports bad lines', () => {
  const csv = [
    'Rm,Conf No,Last Name,Arrival,Departure,Status',
    '109,ABC123,Smith,05/10/2026,07/10/2026,Checked out',
    '110,,Jones,05/10/2026,07/10/2026,',
    '111,XYZ9,Brown,08/10/2026,06/10/2026,',
    '112,Q1,Lee,06/10/2026,09/10/2026,',
  ].join('\n')
  const { rows, problems, missingColumns } = toStayRows(parseCsv(csv), TODAY)
  assert.deepEqual(missingColumns, [])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    room_number: '109', reservation_ref: 'ABC123', guest_surname: 'Smith',
    check_in_date: '2026-10-05', check_out_date: '2026-10-07', status: 'departed',
  })
  assert.equal(rows[1].status, 'in_house')
  assert.deepEqual(problems.map((p) => p.line), [3, 4])
})

test('says which required columns are missing', () => {
  const { missingColumns } = toStayRows(parseCsv('Room,Surname\n109,Smith'), TODAY)
  assert.deepEqual(missingColumns, ['Confirmation number', 'Check-in date', 'Check-out date'])
})
