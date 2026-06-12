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

// The "Fällig" label shown in lists and detail view, based on due_type.
export function formatDueLabel(task) {
  if (!task?.due_date) return 'Kein Datum'
  const date = parseISODate(task.due_date)
  if (task.due_type === 'month') {
    return `${MONTHS_DE[date.getMonth()]} ${date.getFullYear()}`
  }
  if (task.due_type === 'week') {
    const monday = startOfISOWeek(date)
    return `KW ${getISOWeek(monday)} (${formatWeekRange(monday)})`
  }
  return formatLongDate(date)
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
