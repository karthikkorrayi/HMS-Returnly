// The setup form's own checks (src/lib/setup.ts). The database checks again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSetup, parseRoomList, setupTokenMatches, setupTokenConfigured, SetupError } from '../src/lib/setup.ts'

const form = (over = {}) => ({
  code: 'grand', name: 'The Grand', address: '', phone: '', email: '', supportHours: '', supportNote: '',
  floorNames: ['Ground', '1'], floorRooms: ['G01, G02', '101-103'],
  areas: 'Lobby\nRestaurant, Bar',
  storageLabels: ['Front desk safe', 'Shelf A'], storageKinds: ['secure', 'normal'],
  adminName: 'Grace', adminUsername: 'Grace.M', adminPassword: 'correct horse battery', adminPassword2: 'correct horse battery',
  ...over,
})
const refuses = (over, re) => assert.throws(() => buildSetup(form(over)), (e) => e instanceof SetupError && re.test(e.message))

test('room lists: commas, spaces, new lines and number ranges', () => {
  assert.deepEqual(parseRoomList('101, 102\n103  105-107'), ['101', '102', '103', '105', '106', '107'])
  assert.deepEqual(parseRoomList('01-03'), ['01', '02', '03'])
  assert.deepEqual(parseRoomList('G-01, PH-2'), ['G-01', 'PH-2'], 'a dash in a name is not a range')
  assert.deepEqual(parseRoomList('9-10'), ['9-10'], 'numbers of different length are one name, not a range')
  assert.throws(() => parseRoomList('110-101'), /larger/)
  assert.throws(() => parseRoomList('1000-2000'), /too long/)
})

test('a good form becomes the setup configuration', () => {
  const { config, admin } = buildSetup(form())
  assert.equal(config.hotel.code, 'GRAND')
  assert.deepEqual(config.floors, [{ name: 'Ground', rooms: ['G01', 'G02'] }, { name: '1', rooms: ['101', '102', '103'] }])
  assert.deepEqual(config.areas, ['Lobby', 'Restaurant', 'Bar'])
  assert.deepEqual(config.storage, [{ label: 'Front desk safe', secure: true }, { label: 'Shelf A', secure: false }])
  assert.equal(admin.username, 'grace.m')
})

test('empty floor and storage rows are ignored', () => {
  const { config } = buildSetup(form({ floorNames: ['1', ''], floorRooms: ['101', ''], storageLabels: ['Safe', ' '], storageKinds: ['secure', 'normal'] }))
  assert.equal(config.floors.length, 1)
  assert.equal(config.storage.length, 1)
})

test('mistakes get a plain message', () => {
  refuses({ code: 'g' }, /Hotel code/)
  refuses({ name: 'x' }, /Hotel name/)
  refuses({ email: 'nope' }, /email/)
  refuses({ phone: 'call me' }, /phone/)
  refuses({ floorNames: [''], floorRooms: ['101'] }, /give it a name/)
  refuses({ floorNames: ['1', '1'], floorRooms: ['101', '102'] }, /listed twice/)
  refuses({ floorNames: ['1'], floorRooms: [''] }, /add its room numbers|at least one floor/)
  refuses({ floorNames: ['1', '2'], floorRooms: ['101', '101'] }, /Room 101 is listed twice \(floors "1" and "2"\)/)
  refuses({ floorRooms: ['G 01!', '101'] }, /letters, digits or dashes/)
  refuses({ areas: 'Lobby, lobby' }, /listed twice/)
  refuses({ storageLabels: [''], storageKinds: ['normal'] }, /at least one place/)
  refuses({ adminUsername: 'x' }, /Username/)
  refuses({ adminPassword: 'short', adminPassword2: 'short' }, /password/)
  refuses({ adminPassword2: 'something else entirely' }, /do not match/)
})

test('the setup key: must be set, long, and match exactly', () => {
  const key = 'k'.repeat(30)
  assert.equal(setupTokenConfigured(undefined), false)
  assert.equal(setupTokenConfigured('short-key'), false)
  assert.equal(setupTokenConfigured(key), true)
  assert.equal(setupTokenMatches(key, key), true)
  assert.equal(setupTokenMatches(key + 'x', key), false)
  assert.equal(setupTokenMatches('', key), false)
  assert.equal(setupTokenMatches('short-key', 'short-key'), false, 'a too-short SETUP_TOKEN never unlocks setup')
})
