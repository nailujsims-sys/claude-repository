// Pure-logic tests for what the Heute screen promises, below the pixels.
//
// Four claims are worth pinning here because they are the ones a user would
// notice being wrong and a screenshot would not show:
//
//   1. the greeting follows the clock, and covers all 24 hours;
//   2. the motivation line is a function of the calendar day — the same all day
//      (so a reload cannot change it) and different the next day;
//   3. the agenda is the whole day, in order, all-day entries first;
//   4. the [Heute | Diese Woche] switch widens the selection, never narrows it
//      — including for an overdue task, which belongs to both.
//
// Bundled with esbuild like restoreLogic.mjs / pressLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { GREETINGS, greetingFor, greetingLabel } from './src/lib/greeting.js'
import { MOTIVATION_QUOTES, dayIndex, quoteForDate } from './src/lib/quotes.js'
import {
  dayAgenda,
  eventSlotLabel,
  eventDurationLabel,
  eventIsPast,
  eventIsNow,
} from './src/lib/calendar.js'
import { homePreview } from './src/lib/taskSelectors.js'
import { toISODate, addDays, startOfDay, startOfISOWeek } from './src/lib/date.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// ── 1. the greeting ─────────────────────────────────────────────────────────
{
  const at = (h, m = 0) => greetingLabel(new Date(2026, 8, 1, h, m))

  ok('05:00 is the first minute of the morning', at(5) === 'Guten Morgen')
  ok('10:59 is still morning', at(10, 59) === 'Guten Morgen')
  ok('11:00 turns into the day', at(11) === 'Guten Tag')
  ok('17:59 is still the day', at(17, 59) === 'Guten Tag')
  ok('18:00 turns into the evening', at(18) === 'Guten Abend')
  ok('23:59 is evening', at(23, 59) === 'Guten Abend')
  // The night is the half of the evening bucket that lies before the first
  // boundary — the one case a naive "find the first match" would drop.
  ok('00:00 stays in the evening', at(0) === 'Guten Abend')
  ok('04:59 stays in the evening', at(4, 59) === 'Guten Abend')

  // Every hour of the day resolves to exactly one of the three labels, and no
  // hour falls through.
  const labels = new Set(GREETINGS.map((g) => g.label))
  let covered = 0
  for (let h = 0; h < 24; h++) {
    const g = greetingFor(new Date(2026, 8, 1, h, 30))
    if (g && labels.has(g.label)) covered++
  }
  ok('all 24 hours resolve to a greeting', covered === 24)
  ok('there are exactly the three greetings the screen names', labels.size === 3)
}

// ── 2. the quote of the day ─────────────────────────────────────────────────
{
  ok('there are ten quotes', MOTIVATION_QUOTES.length === 10)
  ok('the quotes are distinct', new Set(MOTIVATION_QUOTES).size === 10)

  const day = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min)

  // Stable within the day: the moments a reload is most likely to fall on.
  const morning = quoteForDate(day(2026, 8, 1, 0, 0))
  const noon = quoteForDate(day(2026, 8, 1, 12, 0))
  const night = quoteForDate(day(2026, 8, 1, 23, 59))
  ok('the same day gives the same quote at 00:00, 12:00 and 23:59',
     morning === noon && noon === night)

  // Different the next day, and again the day after — a rotation, not a coin
  // flip that happens to repeat.
  const d2 = quoteForDate(day(2026, 8, 2))
  const d3 = quoteForDate(day(2026, 8, 3))
  ok('the next day gives a different quote', d2 !== noon)
  ok('and the day after that, a third one', d3 !== d2 && d3 !== noon)

  // Ten consecutive days use all ten lines, then it starts over.
  const ten = []
  for (let i = 0; i < 10; i++) ten.push(quoteForDate(day(2026, 8, 1 + i)))
  ok('ten consecutive days show all ten quotes', new Set(ten).size === 10)
  ok('day eleven repeats day one', quoteForDate(day(2026, 8, 11)) === noon)

  // The index changes at local midnight and nowhere else.
  ok('the day index is stable across a day',
     dayIndex(day(2026, 8, 1, 0, 0)) === dayIndex(day(2026, 8, 1, 23, 59)))
  ok('and increments by one overnight',
     dayIndex(day(2026, 8, 2)) - dayIndex(day(2026, 8, 1)) === 1)
  // Month and year boundaries are ordinary days for this.
  ok('a month boundary is one step',
     dayIndex(day(2026, 8, 30)) - dayIndex(day(2026, 7, 31)) === 30)
  ok('quotes before 1970 still resolve to a real line',
     MOTIVATION_QUOTES.includes(quoteForDate(day(1965, 2, 3))))
}

// ── 3. the agenda ───────────────────────────────────────────────────────────
{
  const REF = new Date(2026, 8, 1, 12, 0) // Tuesday 1 September 2026, noon
  const today = startOfDay(REF)
  const at = (d, t) => toISODate(d) + 'T' + t
  const dayAt = (d) => toISODate(d) + 'T00:00'

  const events = [
    { id: 'e3', title: 'Sport', start_at: at(today, '18:00'), end_at: at(today, '19:30') },
    { id: 'e1', title: 'Vorlesung', start_at: at(today, '09:00'), end_at: at(today, '10:00') },
    { id: 'b1', title: 'Urlaub', all_day: true, start_at: dayAt(addDays(today, -1)), end_at: dayAt(addDays(today, 1)) },
    { id: 'e2', title: 'Mittagessen', start_at: at(today, '12:00'), end_at: at(today, '12:45') },
    { id: 'b2', title: 'Messe', all_day: true, start_at: dayAt(today), end_at: dayAt(today) },
    { id: 'x', title: 'Morgen', start_at: at(addDays(today, 1), '09:00'), end_at: at(addDays(today, 1), '10:00') },
  ]

  const agenda = dayAgenda(events, today)
  ok('the agenda holds only today', !agenda.some((e) => e.id === 'x'))
  ok('nothing today is dropped', agenda.length === 5)
  ok('all-day entries lead, then the timed ones in start order',
     agenda.map((e) => e.id).join() === 'b1,b2,e1,e2,e3')

  // The leading column.
  ok('a timed event shows its start time', eventSlotLabel(events[1]) === '09:00')
  ok('a one-day all-day event says Ganztägig', eventSlotLabel(events[4]) === 'Ganztägig')
  ok('a span across days says Mehrtägig', eventSlotLabel(events[2]) === 'Mehrtägig')

  // The meta line.
  ok('under an hour is minutes', eventDurationLabel(events[3]) === '45 Min')
  ok('a whole hour has no minutes on it', eventDurationLabel(events[1]) === '1 Std')
  ok('an hour and a half carries both', eventDurationLabel(events[0]) === '1 Std 30 Min')

  // Past / running, at noon.
  ok('the morning lecture is over', eventIsPast(events[1], REF) === true)
  ok('lunch is running', eventIsNow(events[3], REF) === true)
  ok('and is therefore not past', eventIsPast(events[3], REF) === false)
  ok('the evening is still ahead', eventIsPast(events[0], REF) === false)
  // The trap: an all-day event ends at 00:00 of its last day, so a plain
  // timestamp comparison would call it over all day long.
  ok('an all-day event today is not "past" at noon', eventIsPast(events[4], REF) === false)
  ok('a multi-day span covering today is not past', eventIsPast(events[2], REF) === false)
  ok('an all-day event that ended yesterday is past',
     eventIsPast({ id: 'b0', all_day: true, start_at: dayAt(addDays(today, -2)), end_at: dayAt(addDays(today, -1)) }, REF) === true)

  ok('the first not-past entry is the one the list opens on',
     agenda.findIndex((e) => !eventIsPast(e, REF)) === 0)
}

// ── 4. the [Heute | Diese Woche] switch ────────────────────────────────────
{
  const REF = new Date(2026, 8, 1, 12, 0) // Tuesday
  const today = startOfDay(REF)
  const iso = (d) => toISODate(d)
  const base = {
    user_id: 'u', category: 'Privat', subcategory: null, details: null,
    due_time: null, due_type: 'day', is_favorite: false, is_completed: false,
    is_deleted: false, completed_at: null, deleted_at: null, sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  }
  const task = (over) => ({ ...base, ...over })

  const weekEnd = addDays(startOfISOWeek(today), 6) // Sunday
  const tasks = [
    task({ id: 't1', title: 'Heute', due_date: iso(today), sort_order: 3 }),
    task({ id: 't2', title: 'Überfällig', due_date: iso(addDays(today, -9)), sort_order: 1 }),
    task({ id: 't3', title: 'Sonntag', due_date: iso(weekEnd), sort_order: 0 }),
    task({ id: 't4', title: 'Nächste Woche', due_date: iso(addDays(weekEnd, 3)), sort_order: 0 }),
    task({ id: 't5', title: 'Erledigt', due_date: iso(today), is_completed: true }),
    task({ id: 't6', title: 'Gelöscht', due_date: iso(today), is_deleted: true }),
    task({ id: 't7', title: 'Ohne Datum', due_date: null, sort_order: 9 }),
  ]

  const heute = homePreview(tasks, 'today', REF)
  const woche = homePreview(tasks, 'week', REF)

  ok('Heute shows today plus overdue',
     heute.map((t) => t.id).join() === 't2,t1')
  ok('Heute leaves completed and deleted tasks out',
     !heute.some((t) => t.is_completed || t.is_deleted))
  ok('a dateless task is in neither list',
     !heute.some((t) => t.id === 't7') && !woche.some((t) => t.id === 't7'))
  ok('next week is not in this week', !woche.some((t) => t.id === 't4'))

  // The switch must widen, never narrow: every row under Heute is also under
  // Diese Woche — the overdue one included, whose due date is in an earlier
  // week and would otherwise vanish from the wider list.
  const inWeek = new Set(woche.map((t) => t.id))
  ok('Diese Woche contains every row Heute shows',
     heute.every((t) => inWeek.has(t.id)))
  ok('and the overdue task in particular', inWeek.has('t2'))
  ok('Diese Woche is the wider list', woche.length > heute.length)

  // Ordered by date, not by the hand-sorted order of the Aufgaben screen: a
  // week is read along its days.
  ok('the week list runs chronologically',
     woche.map((t) => t.id).join() === 't2,t1,t3')

  // Nothing is capped — the screen bounds the height, not the data.
  const many = Array.from({ length: 30 }, (_, i) =>
    task({ id: 'm' + i, title: 'T' + i, due_date: iso(today), sort_order: i })
  )
  ok('a long list is returned in full', homePreview(many, 'today', REF).length === 30)
}

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'homeLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/homeLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
