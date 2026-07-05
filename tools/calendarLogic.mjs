// Pure-logic tests for the calendar's tricky bits: drag/resize geometry, search
// matching + ordering, wall-clock (timezone-safe) date math, and the single
// task selector that feeds the day list / week counts / month dots. The lib
// files use extensionless imports, so we bundle with esbuild (like smoke.mjs)
// and run the bundle in node. No browser needed.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { pxToMin, eventTopHeight, draggedTimes, parseDateTime, formatDateTime } from './src/lib/calendar.js'
import { toISODate } from './src/lib/date.js'
import { searchEvents } from './src/lib/eventSearch.js'
import { tasksForDay } from './src/lib/taskSelectors.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// ── px ↔ minutes (HOUR_HEIGHT = 56) ─────────────────────────────────────────
ok('pxToMin 56→60', Math.abs(pxToMin(56) - 60) < 1e-9)
ok('pxToMin 28→30', Math.abs(pxToMin(28) - 30) < 1e-9)

// ── pixel geometry for the live drag preview ────────────────────────────────
const th = eventTopHeight('2026-07-04T09:00', '2026-07-04T10:00')
ok('eventTopHeight top', th.top === 9 * 56)
ok('eventTopHeight height', th.height === 56)

// ── move (keep duration, snap to 15, clamp to the day) ──────────────────────
const ev = { start_at: '2026-07-04T09:00', end_at: '2026-07-04T10:00' }
const m1 = draggedTimes(ev, 'move', 60, 0)
ok('move +60 start', m1.start_at === '2026-07-04T10:00')
ok('move +60 end', m1.end_at === '2026-07-04T11:00')
const m2 = draggedTimes(ev, 'move', 20, 0)
ok('move snaps to 15 (start)', m2.start_at === '2026-07-04T09:15')
ok('move snaps to 15 (end keeps 60m)', m2.end_at === '2026-07-04T10:15')
const m3 = draggedTimes(ev, 'move', -600, 0)
ok('move clamps to 00:00', m3.start_at === '2026-07-04T00:00' && m3.end_at === '2026-07-04T01:00')
const evLate = { start_at: '2026-07-04T23:00', end_at: '2026-07-04T23:30' }
const m4 = draggedTimes(evLate, 'move', 180, 0)
ok('move clamps to bottom of day', m4.start_at === '2026-07-04T23:30')
ok('move never emits 24:00 (stays single-day)', m4.end_at === '2026-07-04T23:59')

// ── week move: horizontal day shift keeps the time-of-day ────────────────────
const m5 = draggedTimes(ev, 'move', 0, 2)
ok('day shift +2 moves date, keeps time', m5.start_at === '2026-07-06T09:00' && m5.end_at === '2026-07-06T10:00')

// ── resize start / end (min 15m duration, can't cross the other edge) ────────
const r1 = draggedTimes(ev, 'start', 30, 0)
ok('resize start +30', r1.start_at === '2026-07-04T09:30' && r1.end_at === '2026-07-04T10:00')
const r2 = draggedTimes(ev, 'start', 120, 0)
ok('resize start clamped to end-15', r2.start_at === '2026-07-04T09:45' && r2.end_at === '2026-07-04T10:00')
const r3 = draggedTimes(ev, 'end', 30, 0)
ok('resize end +30', r3.end_at === '2026-07-04T10:30' && r3.start_at === '2026-07-04T09:00')
const r4 = draggedTimes(ev, 'end', -120, 0)
ok('resize end clamped to start+15', r4.end_at === '2026-07-04T09:15' && r4.start_at === '2026-07-04T09:00')

// ── timezone safety: everything is local wall-clock, no UTC drift ────────────
ok('parse keeps wall-clock hour', parseDateTime('2026-06-24T14:00').getHours() === 14)
ok('toISODate has no off-by-one', toISODate(parseDateTime('2026-07-04')) === '2026-07-04')
ok('formatDateTime round-trips', formatDateTime(parseDateTime('2026-11-01T00:30')) === '2026-11-01T00:30')
// Crossing the spring-forward day by a whole day must not shift the clock time.
const dst = draggedTimes({ start_at: '2026-03-29T09:00', end_at: '2026-03-29T10:00' }, 'move', 0, 1)
ok('day shift is DST-safe', dst.start_at === '2026-03-30T09:00' && dst.end_at === '2026-03-30T10:00')

// ── search: Titel / Ort / Notizen, upcoming-first ordering ───────────────────
const evs = [
  { id: 'a', title: 'Zahnarzt', location: 'Praxis Dr. Müller', description: null, start_at: '2026-07-10T11:00', end_at: '2026-07-10T11:30' },
  { id: 'b', title: 'Team Meeting', location: 'Büro', description: 'Quartalszahlen', start_at: '2026-07-06T13:00', end_at: '2026-07-06T14:00' },
  { id: 'c', title: 'Sport', location: null, description: 'Rücken', start_at: '2026-06-01T18:00', end_at: '2026-06-01T19:00' },
]
const ref = new Date(2026, 6, 4)
ok('empty query → no results', searchEvents(evs, '', ref).length === 0)
ok('matches title', searchEvents(evs, 'zahn', ref).map((e) => e.id).join() === 'a')
ok('matches location (Ort)', searchEvents(evs, 'büro', ref).map((e) => e.id).join() === 'b')
ok('matches description (Notizen)', searchEvents(evs, 'rücken', ref).map((e) => e.id).join() === 'c')
ok('orders future ascending then past', searchEvents(evs, 'r', ref).map((e) => e.id).join() === 'b,a,c')

// ── task integration: one selector for day list / week counts / month dots ───
const tasks = [
  { id: 't1', is_completed: false, is_deleted: false, due_type: 'day', due_date: '2026-07-04' },
  { id: 't2', is_completed: false, is_deleted: false, due_type: 'week', due_date: '2026-07-04' },
  { id: 't3', is_completed: true, is_deleted: false, due_type: 'day', due_date: '2026-07-04' },
  { id: 't4', is_completed: false, is_deleted: true, due_type: 'day', due_date: '2026-07-04' },
  { id: 't5', is_completed: false, is_deleted: false, due_type: 'day', due_date: '2026-07-05' },
]
ok('tasksForDay = active + day-type + exact date', tasksForDay(tasks, '2026-07-04').map((t) => t.id).join() === 't1')
ok('tasksForDay isolates other days', tasksForDay(tasks, '2026-07-05').map((t) => t.id).join() === 't5')

console.log('\\n' + (fail ? 'FAIL' : 'OK') + ': ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'calendarLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/calendarLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
