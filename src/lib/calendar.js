import { startOfDay, addDays, isSameDay } from './date'

// ---------------------------------------------------------------------------
// Calendar geometry + event layout. Pure, framework-free helpers so the three
// views (Tag / Woche / Monat) stay declarative and are easy to unit-test.
// ---------------------------------------------------------------------------

export const HOUR_HEIGHT = 56 // px per hour in the day/week time grid
export const HOURS = Array.from({ length: 24 }, (_, h) => h) // 0 … 23
export const GRID_HEIGHT = HOUR_HEIGHT * 24

const DAY_MS = 24 * 60 * 60 * 1000

// ── Local wall-clock <-> string ────────────────────────────────────────────
// Datetimes are stored as local 'YYYY-MM-DDTHH:MM' strings (no zone suffix),
// matching the app's local-time convention and dodging the UTC parsing pitfall
// of `new Date('2026-06-24')`. `timezone` is carried on the row for the future.
export function parseDateTime(str) {
  if (!str) return null
  const [datePart, timePart = '00:00'] = String(str).split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh = 0, mm = 0] = timePart.split(':').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, hh, mm, 0, 0)
}

export function formatDateTime(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(
    date.getHours()
  )}:${p(date.getMinutes())}`
}

export const eventStart = (ev) => parseDateTime(ev.start_at)
export const eventEnd = (ev) => parseDateTime(ev.end_at) || parseDateTime(ev.start_at)

// A "bar" event renders in the all-day strip above the hour grid: either
// explicitly all-day (incl. birthdays) or spanning more than one calendar day.
export function isBarEvent(ev) {
  if (ev.all_day || ev.is_birthday) return true
  const s = eventStart(ev)
  const e = eventEnd(ev)
  return s && e ? !isSameDay(s, e) : false
}

export const isTimedEvent = (ev) => !isBarEvent(ev)

// Inclusive [startDay, endDay] the event occupies, snapped to local midnight.
export function eventDayRange(ev) {
  const s = startOfDay(eventStart(ev))
  const e = startOfDay(eventEnd(ev) || eventStart(ev))
  return [s, e]
}

export function eventCoversDay(ev, dayDate) {
  const [s, e] = eventDayRange(ev)
  const d = startOfDay(dayDate)
  return d >= s && d <= e
}

export function eventsInRange(events, rangeStart, rangeEnd) {
  const s = startOfDay(rangeStart)
  const e = startOfDay(rangeEnd)
  return events.filter((ev) => {
    const [es, ee] = eventDayRange(ev)
    return ee >= s && es <= e
  })
}

const byStart = (a, b) => eventStart(a) - eventStart(b)

// Events touching a day, split into top-strip bars and timed grid entries.
export function splitDayEvents(events, dayDate) {
  const covering = events.filter((ev) => eventCoversDay(ev, dayDate))
  return {
    bars: covering.filter(isBarEvent).sort(byStart),
    timed: covering.filter(isTimedEvent).sort(byStart),
  }
}

export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

export const nowTop = (date) => (minutesOfDay(date) / 60) * HOUR_HEIGHT

export function eventTimeLabel(ev) {
  const s = eventStart(ev)
  if (!s) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(s.getHours())}:${p(s.getMinutes())}`
}

export function eventRangeLabel(ev) {
  const s = eventStart(ev)
  const e = eventEnd(ev)
  if (!s) return ''
  const p = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${p(d.getHours())}:${p(d.getMinutes())}`
  return e && isSameDay(s, e) ? `${fmt(s)} – ${fmt(e)}` : fmt(s)
}

// ── Overlapping timed-event layout (interval partition into columns) ────────
// Returns each event with pixel top/height and its column position so that
// mutually overlapping events share the width side by side (like Google/Apple).
export function layoutTimedEvents(timed) {
  const items = timed.map((ev) => {
    const s = eventStart(ev)
    const e = eventEnd(ev) || s
    const startMin = minutesOfDay(s)
    let endMin = minutesOfDay(e)
    if (endMin <= startMin) endMin = startMin + 30 // enforce a minimum block
    return { ev, startMin, endMin }
  })
  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const out = []
  let cluster = []
  let clusterEnd = -1

  const flush = () => {
    const colEnds = [] // running end-minute per column
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => it.startMin >= end)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(it.endMin)
      } else {
        colEnds[col] = it.endMin
      }
      it.colIndex = col
    }
    const colCount = colEnds.length
    for (const it of cluster) {
      out.push({
        ...it,
        colCount,
        top: (it.startMin / 60) * HOUR_HEIGHT,
        height: ((it.endMin - it.startMin) / 60) * HOUR_HEIGHT,
      })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush()
  return out
}

// ── Multi-day bar packing into stacked lanes ────────────────────────────────
// Places each bar event on the lowest free lane within a day range, so
// overlapping spans stack without collisions. startIndex/endIndex are clamped
// day offsets into [rangeStart, rangeEnd].
export function packBars(bars, rangeStart, rangeEnd) {
  const start0 = startOfDay(rangeStart)
  const totalDays = Math.round((startOfDay(rangeEnd) - start0) / DAY_MS) + 1
  const dayIndex = (d) => Math.round((startOfDay(d) - start0) / DAY_MS)

  const placed = bars
    .map((ev) => {
      const [s, e] = eventDayRange(ev)
      return {
        ev,
        startIndex: Math.max(0, dayIndex(s)),
        endIndex: Math.min(totalDays - 1, dayIndex(e)),
        clippedStart: dayIndex(s) < 0,
        clippedEnd: dayIndex(e) > totalDays - 1,
      }
    })
    .filter((b) => b.endIndex >= 0 && b.startIndex <= totalDays - 1)
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)

  const laneEnds = [] // last occupied endIndex per lane
  for (const b of placed) {
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] >= b.startIndex) lane++
    b.lane = lane
    laneEnds[lane] = b.endIndex
  }
  return { lanes: placed, laneCount: laneEnds.length }
}
