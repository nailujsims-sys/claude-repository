// Pure-logic tests for the calendar's tricky bits: drag/resize geometry, search
// matching + ordering, wall-clock (timezone-safe) date math, and the single
// task selector that feeds the day list / week counts / month dots. The lib
// files use extensionless imports, so we bundle with esbuild (like smoke.mjs)
// and run the bundle in node. No browser needed.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { pxToMin, eventTopHeight, draggedTimes, parseDateTime, formatDateTime, layoutTimedEvents } from './src/lib/calendar.js'
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

// ── overlap layout: columns, widening, "+X weitere" ─────────────────────────
const ev2 = (id, from, to) => ({ id, title: id, start_at: '2026-07-04T' + from, end_at: '2026-07-04T' + to })
const near = (a, b) => Math.abs(a - b) < 1e-9

{
  const { items, overflows } = layoutTimedEvents([ev2('a', '09:00', '10:00')])
  ok('single event fills the column', items.length === 1 && near(items[0].left, 0) && near(items[0].width, 1))
  ok('single event geometry', items[0].top === 9 * 56 && items[0].height === 56)
  ok('single event needs no chip', overflows.length === 0)
}

{
  const { items } = layoutTimedEvents([ev2('a', '09:00', '10:00'), ev2('b', '09:30', '10:30')])
  const a = items.find((i) => i.ev.id === 'a')
  const b = items.find((i) => i.ev.id === 'b')
  ok('two overlapping events share the width', near(a.width, 0.5) && near(b.width, 0.5))
  ok('second event sits in the right half', near(a.left, 0) && near(b.left, 0.5))
}

{
  // Sequential events never overlap → each one keeps the full width.
  const { items } = layoutTimedEvents([ev2('a', '09:00', '10:00'), ev2('b', '10:00', '11:00')])
  ok('back-to-back events stay full width', items.every((i) => near(i.width, 1) && near(i.left, 0)))
}

{
  // 'd' only competes with 'a' (col 0) — the free third column is added to it.
  const { items } = layoutTimedEvents([
    ev2('a', '09:00', '11:00'),
    ev2('b', '09:15', '09:45'),
    ev2('c', '09:20', '09:40'),
    ev2('d', '10:00', '10:30'),
  ])
  const d = items.find((i) => i.ev.id === 'd')
  ok('a block widens into the columns its neighbours leave free', near(d.width, 2 / 3))
  ok('the widened block keeps its own column', near(d.left, 1 / 3))
}

{
  // Four parallel events in a 100px column with a 40px minimum → one event plus
  // a chip for the other three.
  const dense = [
    ev2('a', '09:00', '10:00'),
    ev2('b', '09:15', '10:00'),
    ev2('c', '09:30', '10:00'),
    ev2('d', '09:45', '10:00'),
  ]
  const { items, overflows } = layoutTimedEvents(dense, { columnWidth: 100, minEventWidth: 40 })
  ok('too many parallel events collapse into one chip', items.length === 1 && overflows.length === 1)
  ok('the chip counts the hidden events', overflows[0].count === 3)
  ok('the visible event keeps the rest of the width', near(items[0].width, 0.55))
  ok('the chip spans the hidden events', overflows[0].top === (555 / 60) * 56 && overflows[0].height === (45 / 60) * 56)
  ok('the chip carries the hidden events', overflows[0].events.map((e) => e.id).join() === 'b,c,d')

  // Same events, unmeasured width → nothing is hidden.
  const wide = layoutTimedEvents(dense)
  ok('without a measured width nothing is collapsed', wide.items.length === 4 && wide.overflows.length === 0)
  ok('four parallel events split the width evenly', wide.items.every((i) => near(i.width, 0.25)))

  // A wide column fits all four.
  const roomy = layoutTimedEvents(dense, { columnWidth: 400, minEventWidth: 96 })
  ok('a wide column keeps every event visible', roomy.items.length === 4 && roomy.overflows.length === 0)
}

{
  // An event without an end still gets the 30-minute minimum block.
  const { items } = layoutTimedEvents([{ id: 'x', title: 'x', start_at: '2026-07-04T09:00', end_at: null }])
  ok('an event without an end gets a minimum block', items[0].height === 28)
}

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
