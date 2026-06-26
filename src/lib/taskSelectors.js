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

// Home preview lists (max 4), always active only.
export function homePreview(tasks, scope, ref = new Date()) {
  const active = tasks.filter(isActive)
  const inScope =
    scope === 'week'
      ? active.filter((t) => isInCurrentWeek(t.due_date, ref))
      : active.filter((t) => isDueToday(t, ref))
  return inScope.sort((a, b) => a.sort_order - b.sort_order)
}

// Count of open (active) tasks due today (incl. overdue) — shown on the home card.
export function openTodayCount(tasks, ref = new Date()) {
  return tasks.filter((t) => isActive(t) && isDueToday(t, ref)).length
}
