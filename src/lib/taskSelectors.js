import {
  SECTION_ORDER,
  SECTIONS,
  sectionForDueDate,
  isToday,
  isInCurrentWeek,
  isOverdue,
} from './date'

// Pure functions that derive the various task views from the full task list.
// Keeping them here keeps screens declarative and easy to test.

export const CATEGORIES = ['Privat', 'Uni', 'Arbeit']

// Active = not completed, not deleted.
export function isActive(task) {
  return !task.is_completed && !task.is_deleted
}

// A task belongs under "Heute" when it's due today or overdue. Overdue tasks
// roll forward into today (without touching their stored due_date) until done.
export function isDueToday(task, ref = new Date()) {
  return isToday(task.due_date, ref) || isOverdue(task, ref)
}

// Active tasks due on EXACTLY the given ISO day (day-type only). Single source
// of truth for the calendar's day list, week counts and month dots — week- and
// month-type tasks deliberately never appear here (per the calendar spec).
export function tasksForDay(tasks, dayISO) {
  if (!dayISO) return []
  return tasks.filter(
    (t) => isActive(t) && t.due_type === 'day' && t.due_date === dayISO
  )
}

// Build the grouped, filtered list for the Aufgaben screen.
//
// filters: {
//   category: 'Alle' | 'Privat' | 'Uni' | 'Arbeit',
//   search: string,
//   onlyFavorites: bool,
//   showCompleted: bool,
//   showDeleted: bool,
// }
//
// Returns an ordered array of sections:
//   [{ key, label, active: Task[], completed: Task[], deleted: Task[] }]
// Only sections that contain at least one row are included.
export function buildSections(tasks, filters, ref = new Date()) {
  const { category, search, onlyFavorites, showCompleted, showDeleted } = filters
  const q = (search || '').trim().toLowerCase()

  const matches = (t) => {
    if (category && category !== 'Alle' && t.category !== category) return false
    if (onlyFavorites && !t.is_favorite) return false
    if (q && !t.title.toLowerCase().includes(q)) return false
    return true
  }

  const buckets = {}
  for (const key of SECTION_ORDER) {
    buckets[key] = { ...SECTIONS[key], active: [], completed: [], deleted: [] }
  }

  for (const task of tasks) {
    if (!matches(task)) continue
    const section = sectionForDueDate(task.due_date, ref)
    if (task.is_deleted) {
      if (showDeleted) buckets[section].deleted.push(task)
    } else if (task.is_completed) {
      if (showCompleted) buckets[section].completed.push(task)
    } else {
      // Active overdue tasks roll forward into HEUTE; the rest stay in their
      // natural section. due_date itself is never changed.
      buckets[isOverdue(task, ref) ? 'TODAY' : section].active.push(task)
    }
  }

  const bySort = (a, b) => a.sort_order - b.sort_order
  return SECTION_ORDER.map((key) => buckets[key])
    .map((b) => ({
      ...b,
      active: b.active.sort(bySort),
      completed: b.completed.sort(bySort),
      deleted: b.deleted.sort(bySort),
    }))
    .filter((b) => b.active.length || b.completed.length || b.deleted.length)
}

// The two lists behind the Heute screen's [ Heute | Diese Woche ] switch.
// Active tasks only, and never truncated — the screen bounds the *height* of
// the list and lets it scroll, so cutting the data as well would hide rows
// that the scroll would otherwise reach.
//
//   'today' — due today, plus everything overdue. That is the same rule the
//             Aufgaben list's HEUTE section uses (`isDueToday`), so a task
//             cannot appear under Heute in one screen and not the other.
//   'week'  — the current Mon–Sun week, *plus* the Heute set. Overdue tasks
//             from an earlier week roll forward into today and would otherwise
//             be missing from the wider of the two lists, which would let
//             "Diese Woche" show fewer rows than "Heute" — the switch has to
//             widen the selection, never narrow it.
//
// Sorted chronologically (oldest due date first, dateless last) and only then
// by the user's own order: a week spans several days, so due date is the axis
// the list is read along. Overdue tasks sort to the top by construction.
export function homePreview(tasks, scope, ref = new Date()) {
  const active = tasks.filter(isActive)
  const inScope =
    scope === 'week'
      ? active.filter((t) => isInCurrentWeek(t.due_date, ref) || isDueToday(t, ref))
      : active.filter((t) => isDueToday(t, ref))
  return inScope.sort(
    (a, b) =>
      (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') ||
      a.sort_order - b.sort_order
  )
}
