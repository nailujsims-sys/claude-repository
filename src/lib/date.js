// Date helpers. Everything works in LOCAL time and represents calendar dates as
// 'YYYY-MM-DD' strings (matching the Postgres `date` column) to avoid timezone
// off-by-one bugs.

export const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

// Monday-first weekday labels for the calendar header.
export const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// Full Monday-first weekday names (day-view subtitle).
export const WEEKDAYS_DE_LONG = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
]

// Monday index (Mon=0 … Sun=6) for a date.
export function weekdayMon(date) {
  return (date.getDay() + 6) % 7
}

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date, n) {
  const d = startOfDay(date)
  d.setDate(d.getDate() + n)
  return d
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Format a Date as local 'YYYY-MM-DD'.
export function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Parse 'YYYY-MM-DD' into a local-midnight Date.
export function parseISODate(str) {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO() {
  return toISODate(new Date())
}

// Monday of the week containing `date`.
export function startOfISOWeek(date) {
  const d = startOfDay(date)
  const day = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - day)
  return d
}

// Standard ISO-8601 week number (weeks start Monday; week 1 holds the year's
// first Thursday).
export function getISOWeek(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  )
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000))
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

// ---------------------------------------------------------------------------
// Section grouping for the Aufgaben list / home preview.
// ---------------------------------------------------------------------------

export const SECTIONS = {
  TODAY: { key: 'TODAY', label: 'HEUTE' },
  TOMORROW: { key: 'TOMORROW', label: 'MORGEN' },
  WEEK: { key: 'WEEK', label: 'DIESE WOCHE' },
  MONTH: { key: 'MONTH', label: 'DIESEN MONAT' },
  LATER: { key: 'LATER', label: 'SPÄTER' },
}

// Render order for sections.
export const SECTION_ORDER = ['TODAY', 'TOMORROW', 'WEEK', 'MONTH', 'LATER']

// Decide which section a due date belongs to, relative to `ref` (default now).
export function sectionForDueDate(dueDateStr, ref = new Date()) {
  if (!dueDateStr) return 'LATER'
  const due = parseISODate(dueDateStr)
  if (!due) return 'LATER'

  const today = startOfDay(ref)
  const tomorrow = addDays(today, 1)
  if (isSameDay(due, today)) return 'TODAY'
  if (isSameDay(due, tomorrow)) return 'TOMORROW'

  const weekStart = startOfISOWeek(today)
  const weekEnd = addDays(weekStart, 6)
  if (due >= weekStart && due <= weekEnd) return 'WEEK'

  const monthStart = startOfMonth(today)
  const monthEnd = endOfMonth(today)
  if (due >= monthStart && due <= monthEnd) return 'MONTH'

  return 'LATER'
}

export function isToday(dueDateStr, ref = new Date()) {
  if (!dueDateStr) return false
  return isSameDay(parseISODate(dueDateStr), startOfDay(ref))
}

// Is the due date within the current Mon–Sun week?
export function isInCurrentWeek(dueDateStr, ref = new Date()) {
  if (!dueDateStr) return false
  const due = parseISODate(dueDateStr)
  const weekStart = startOfISOWeek(startOfDay(ref))
  const weekEnd = addDays(weekStart, 6)
  return due >= weekStart && due <= weekEnd
}

// Is an active task overdue? True when its whole due period (day / week / month)
// has fully elapsed before today and the task is still open. Completed, deleted,
// or dateless tasks are never overdue.
//
// Overdue is *derived* from the current day — the stored due_date is never
// mutated, so it always stays the original due date (fully traceable) and an
// overdue task keeps rolling into "Heute" every new day until it's completed.
export function isOverdue(task, ref = new Date()) {
  if (!task || !task.due_date || task.is_completed || task.is_deleted) return false
  const due = parseISODate(task.due_date)
  if (!due) return false
  let periodEnd = due // 'day' (and default)
  if (task.due_type === 'week') periodEnd = addDays(startOfISOWeek(due), 6)
  else if (task.due_type === 'month') periodEnd = endOfMonth(due)
  return periodEnd < startOfDay(ref)
}

// ---------------------------------------------------------------------------
// Human-readable formatting (German).
// ---------------------------------------------------------------------------

// "12. Juni 2026"
export function formatLongDate(dateOrStr) {
  const d =
    typeof dateOrStr === 'string' ? parseISODate(dateOrStr) : dateOrStr
  if (!d) return ''
  return `${d.getDate()}. ${MONTHS_DE[d.getMonth()]} ${d.getFullYear()}`
}

// Range for a week given its Monday: "8. – 14. Juni" (or cross-month variant).
export function formatWeekRange(monday) {
  const start = startOfDay(monday)
  const end = addDays(start, 6)
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}. – ${end.getDate()}. ${MONTHS_DE[end.getMonth()]}`
  }
  return `${start.getDate()}. ${MONTHS_DE[start.getMonth()]} – ${end.getDate()}. ${
    MONTHS_DE[end.getMonth()]
  }`
}

// Week range with year, for the calendar header: "22. – 28. Juni 2026".
// Collapses the shared month/year and handles cross-month / cross-year weeks.
export function formatWeekRangeWithYear(monday) {
  const start = startOfDay(monday)
  const end = addDays(start, 6)
  const endStr = `${end.getDate()}. ${MONTHS_DE[end.getMonth()]} ${end.getFullYear()}`
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()}. ${MONTHS_DE[start.getMonth()]} ${start.getFullYear()} – ${endStr}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()}. ${MONTHS_DE[start.getMonth()]} – ${endStr}`
  }
  return `${start.getDate()}. – ${endStr}`
}

// ---------------------------------------------------------------------------
// Relative, user-friendly "Fällig" label (German), chosen by due_type.
//
//   'day'   → Heute / Morgen / Übermorgen / "3"–"6 Tage" / "25. November"
//             (+ year when the date is in another year)
//   'week'  → Diese Woche / Nächste Woche / "2 Wochen", "3 Wochen", …
//   'month' → Diesen Monat / Nächsten Monat / "März" (+ year in another year)
//
// Only the *presentation* changes — the stored due_date/due_type are untouched.
// All math is plain calendar arithmetic, so it stays correct across month and
// year boundaries. Past dues (overdue) fall back to a sensible mirror.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Whole calendar days from `ref` to `due` (both snapped to local midnight).
// Positive = future, 0 = today, negative = past. Rounding absorbs DST shifts.
function dayDelta(due, ref) {
  return Math.round((startOfDay(due) - startOfDay(ref)) / MS_PER_DAY)
}

// "25. November", with the year appended only when it differs from `ref`.
function concreteDay(due, ref) {
  const base = `${due.getDate()}. ${MONTHS_DE[due.getMonth()]}`
  return due.getFullYear() === ref.getFullYear()
    ? base
    : `${base} ${due.getFullYear()}`
}

function formatDayDue(due, ref) {
  const delta = dayDelta(due, ref)
  if (delta === 0) return 'Heute'
  if (delta === 1) return 'Morgen'
  if (delta === 2) return 'Übermorgen'
  if (delta >= 3 && delta <= 6) return `${delta} Tage`
  // 7+ days ahead, or any date in the past → show the concrete date.
  return concreteDay(due, ref)
}

function formatWeekDue(due, ref) {
  // Both ends snap to their Monday, so the gap is always a whole number of weeks.
  const weeks = Math.round(
    (startOfISOWeek(due) - startOfISOWeek(ref)) / (7 * MS_PER_DAY)
  )
  if (weeks === 0) return 'Diese Woche'
  if (weeks === 1) return 'Nächste Woche'
  if (weeks >= 2) return `${weeks} Wochen`
  // Past weeks (not in the forward spec; mirrored for a graceful overdue look).
  if (weeks === -1) return 'Letzte Woche'
  return `vor ${Math.abs(weeks)} Wochen`
}

function formatMonthDue(due, ref) {
  const months =
    (due.getFullYear() - ref.getFullYear()) * 12 +
    (due.getMonth() - ref.getMonth())
  const name = MONTHS_DE[due.getMonth()]
  if (months === 0) return 'Diesen Monat'
  if (months === 1) return 'Nächsten Monat'
  if (months === -1) return 'Letzten Monat'
  // Same calendar year → month name only; otherwise append the year.
  if (months >= 2 && due.getFullYear() === ref.getFullYear()) return name
  return `${name} ${due.getFullYear()}`
}

// The "Fällig" label shown in the detail view, based on due_type.
export function formatDueLabel(task, ref = new Date()) {
  if (!task?.due_date) return 'Kein Datum'
  const due = parseISODate(task.due_date)
  if (!due) return 'Kein Datum'
  if (task.due_type === 'month') return formatMonthDue(due, ref)
  if (task.due_type === 'week') return formatWeekDue(due, ref)
  return formatDayDue(due, ref)
}

// "14:00" from a 'HH:MM[:SS]' time string.
export function formatTime(timeStr) {
  if (!timeStr) return ''
  return timeStr.slice(0, 5)
}

// Build the weeks of a month for the calendar grid. Returns an array of weeks,
// each: { weekNumber, days: [{ date: Date, iso, inMonth }] } — Monday first,
// padded with adjacent-month days so every row has 7 entries.
export function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const gridStart = startOfISOWeek(first)
  const last = endOfMonth(first)

  const weeks = []
  let cursor = gridStart
  // Keep adding weeks until we've covered the whole month.
  while (cursor <= last || weeks.length === 0) {
    const days = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i)
      days.push({
        date,
        iso: toISODate(date),
        inMonth: date.getMonth() === month,
      })
    }
    weeks.push({ weekNumber: getISOWeek(days[0].date), days })
    cursor = addDays(cursor, 7)
    if (weeks.length > 6) break // safety
  }
  return weeks
}
