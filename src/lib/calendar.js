import { startOfDay, addDays, isSameDay, toISODate } from './date'

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

// A birthday renders as "🎂 <Name>" everywhere it appears (bars, chips, detail);
// every other event uses its plain title. The stored title is always just the
// name, so this stays the single place the cake prefix is applied.
export function eventDisplayTitle(ev) {
  if (!ev) return ''
  return ev.is_birthday ? `🎂 ${ev.title}` : ev.title
}

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
// Google-Calendar-style packing for the Tag / Woche grids:
//   1. mutually overlapping events are split into columns and placed side by
//      side, in start order,
//   2. every block is then widened into the columns its neighbours leave free,
//      so a partial overlap doesn't shrink the whole cluster,
//   3. when a column would fall below `minEventWidth`, the extra events are
//      collapsed into one "+X weitere" chip instead of becoming unreadable
//      slivers.
//
// Positions come back as fractions (0…1) of the day column so the views stay
// resolution independent; the measured `columnWidth` (px) only decides how many
// events still fit next to each other.
//
// Returns { items, overflows } — `items` carry pixel top/height plus left/width
// fractions, `overflows` are the "+X weitere" chips (one per cluster).
export const OVERFLOW_CHIP_PX = 84 // width the "+X weitere" chip would like

export function layoutTimedEvents(timed, options = {}) {
  const { columnWidth = Infinity, minEventWidth = 0 } = options
  const measured = Number.isFinite(columnWidth) && columnWidth > 0
  const maxColumns =
    measured && minEventWidth > 0
      ? Math.max(1, Math.floor(columnWidth / minEventWidth))
      : Infinity
  const chipWidth = measured
    ? Math.min(0.45, Math.max(0.2, OVERFLOW_CHIP_PX / columnWidth))
    : 0.25

  const entries = timed.map((ev) => {
    const s = eventStart(ev)
    const e = eventEnd(ev) || s
    const startMin = minutesOfDay(s)
    let endMin = minutesOfDay(e)
    if (endMin <= startMin) endMin = startMin + 30 // enforce a minimum block
    return { ev, startMin, endMin }
  })
  entries.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const items = []
  const overflows = []
  let cluster = []
  let clusterEnd = -1

  const px = (min) => (min / 60) * HOUR_HEIGHT
  const overlaps = (a, b) => a.startMin < b.endMin && a.endMin > b.startMin

  const flush = () => {
    // 1. columns: reuse the first column that is free at this event's start.
    const colEnds = []
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

    // 2. too many parallel events for the available width → keep the earliest
    //    columns and collect the rest behind a chip.
    const overflowing = colCount > maxColumns
    const visibleCols = overflowing ? Math.max(1, maxColumns - 1) : colCount
    const visible = cluster.filter((it) => it.colIndex < visibleCols)
    const hidden = overflowing ? cluster.filter((it) => it.colIndex >= visibleCols) : []
    const usable = hidden.length ? 1 - chipWidth : 1

    // 3. widen each block over the free columns to its right.
    for (const it of visible) {
      let span = 1
      while (
        it.colIndex + span < visibleCols &&
        !visible.some((o) => o !== it && o.colIndex === it.colIndex + span && overlaps(o, it))
      ) {
        span++
      }
      items.push({
        ev: it.ev,
        startMin: it.startMin,
        endMin: it.endMin,
        top: px(it.startMin),
        height: px(it.endMin - it.startMin),
        colIndex: it.colIndex,
        colCount: visibleCols,
        left: (it.colIndex / visibleCols) * usable,
        width: (span / visibleCols) * usable,
      })
    }

    if (hidden.length) {
      const from = Math.min(...hidden.map((h) => h.startMin))
      const to = Math.max(...hidden.map((h) => h.endMin))
      overflows.push({
        id: `more-${hidden[0].ev.id}`,
        count: hidden.length,
        events: hidden.map((h) => h.ev),
        top: px(from),
        height: px(to - from),
        left: usable,
        width: chipWidth,
      })
    }

    cluster = []
    clusterEnd = -1
  }

  for (const it of entries) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush()
  return { items, overflows }
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

// ── Direct manipulation: move / resize a timed event on the grid ─────────────
// All pure math so the pointer layer (useTimedGesture) stays thin and the tricky
// snapping/clamping is unit-tested. Times stay in local wall-clock strings.

export const SNAP_MIN = 15 // events snap to a 15-minute grid while dragging
const MIN_DURATION = 15 // a timed event can never be shorter than this
const DAY_MINUTES = 24 * 60

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)
const snap = (min) => Math.round(min / SNAP_MIN) * SNAP_MIN

// Convert a vertical pixel delta on the hour grid into minutes.
export const pxToMin = (px) => (px / HOUR_HEIGHT) * 60

// Pixel top/height for a timed event, from its wall-clock strings. Used to draw
// the live drag preview (which pops to full width) without re-running layout.
export function eventTopHeight(startAt, endAt) {
  const s = parseDateTime(startAt)
  const e = parseDateTime(endAt) || s
  if (!s) return { top: 0, height: HOUR_HEIGHT }
  const startMin = minutesOfDay(s)
  let endMin = minutesOfDay(e)
  if (endMin <= startMin) endMin = startMin + 30
  return { top: (startMin / 60) * HOUR_HEIGHT, height: ((endMin - startMin) / 60) * HOUR_HEIGHT }
}

// Given an event and a drag, return the new { start_at, end_at } strings.
//   mode 'move'  → shift the whole block (keep duration); dayShift moves it
//                  across columns in the week view.
//   mode 'start' → drag the top handle (change start, keep end)
//   mode 'end'   → drag the bottom handle (change end, keep start)
// deltaMin is the raw (unsnapped) minute delta; the result snaps to SNAP_MIN,
// stays inside the day (00:00–24:00) and keeps at least MIN_DURATION.
export function draggedTimes(ev, mode, deltaMin, dayShift = 0) {
  const s = eventStart(ev)
  const e = eventEnd(ev) || new Date(s.getTime() + 30 * 60000)
  const startMin = minutesOfDay(s)
  const endMin = Math.max(startMin + MIN_DURATION, minutesOfDay(e))
  const duration = endMin - startMin

  let ns = startMin
  let ne = endMin
  if (mode === 'move') {
    ns = clamp(snap(startMin + deltaMin), 0, DAY_MINUTES - duration)
    ne = ns + duration
  } else if (mode === 'start') {
    ns = clamp(snap(startMin + deltaMin), 0, endMin - MIN_DURATION)
    ne = endMin
  } else if (mode === 'end') {
    ne = clamp(snap(endMin + deltaMin), startMin + MIN_DURATION, DAY_MINUTES)
    ns = startMin
  }

  const baseDay = mode === 'move' ? addDays(startOfDay(s), dayShift) : startOfDay(s)
  // Never emit 24:00 — parseDateTime would roll it into the next day and the
  // event would flip to a multi-day bar. Cap at 23:59 so it stays single-day.
  const mk = (min) => {
    const m = Math.min(min, DAY_MINUTES - 1)
    return `${toISODate(baseDay)}T${p2(Math.floor(m / 60))}:${p2(m % 60)}`
  }
  return { start_at: mk(ns), end_at: mk(ne) }
}

const p2 = (n) => String(n).padStart(2, '0')
