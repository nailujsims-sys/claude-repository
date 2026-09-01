// Pure-logic tests for what a restore from the Papierkorb actually has to
// guarantee (G17). The UI half — a button on the deleted row, a button in the
// detail — is behavioural and is covered by tools/smoke.mjs. What can be pinned
// without a browser is the promise underneath it: `restoreTask` clears exactly
// two fields, and `buildSections` must then place the row back where it left,
// in the right section and at its old `sort_order`.
//
// That promise is not obvious from the patch alone. `sort_order` survives
// because the delete never touched it, but the *section* is re-derived from
// `due_date` on every build, and an overdue task deliberately rolls forward
// into HEUTE. So "back where it left" has to be asserted through the selector,
// not assumed from the two fields.
//
// Bundled with esbuild like pressLogic.mjs / overlayLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { buildSections, isActive } from './src/lib/taskSelectors.js'
import { toISODate, addDays, startOfDay } from './src/lib/date.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// A fixed reference day, so section placement is deterministic.
const REF = new Date(2026, 8, 1, 12, 0, 0) // 1 September 2026
const today = startOfDay(REF)
const iso = (d) => toISODate(d)

const base = {
  user_id: 'u', category: 'Privat', subcategory: null, details: null,
  due_time: null, due_type: 'day', is_favorite: false, is_completed: false,
  is_deleted: false, completed_at: null, deleted_at: null,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
}
const task = (over) => ({ ...base, ...over })

// The delete as the app performs it, and its exact inverse (TasksContext).
const softDelete = (t) => ({ ...t, is_deleted: true, deleted_at: '2026-08-30T10:00:00.000Z' })
const restore = (t) => ({ ...t, is_deleted: false, deleted_at: null })

const ALL = { category: 'Alle', search: '', onlyFavorites: false, showCompleted: true, showDeleted: true }
const DEFAULTS = { category: 'Alle', search: '', onlyFavorites: false, showCompleted: false, showDeleted: false }

const sectionOf = (secs, key) => secs.find((s) => s.key === key)
const titles = (rows) => rows.map((r) => r.title)

// ── the patch itself ────────────────────────────────────────────────────────
{
  const before = task({ id: 'a', title: 'A', due_date: iso(today), sort_order: 7, is_favorite: true, due_time: '09:30' })
  const after = restore(softDelete(before))
  ok('restore clears is_deleted', after.is_deleted === false)
  ok('restore clears deleted_at', after.deleted_at === null)
  ok('restore makes the task active again', isActive(after))
  const untouched = ['id', 'title', 'due_date', 'due_time', 'due_type', 'sort_order', 'category', 'is_favorite', 'is_completed', 'created_at']
  ok('restore changes nothing else', untouched.every((k) => after[k] === before[k]))
  ok('sort_order in particular survives the round trip', after.sort_order === 7)
}

// ── it lands back between the same neighbours, at its old sort_order ────────
{
  const first = task({ id: 'first', title: 'Erste', due_date: iso(today), sort_order: 0 })
  const middle = task({ id: 'mid', title: 'Mitte', due_date: iso(today), sort_order: 1 })
  const last = task({ id: 'last', title: 'Letzte', due_date: iso(today), sort_order: 2 })

  const intact = buildSections([first, middle, last], DEFAULTS, REF)
  ok('baseline order is first/middle/last',
     titles(sectionOf(intact, 'TODAY').active).join() === 'Erste,Mitte,Letzte')

  // Deleted: it leaves the active list and shows up under the Papierkorb filter.
  const deletedList = [first, softDelete(middle), last]
  const withDeleted = buildSections(deletedList, ALL, REF)
  ok('a deleted task leaves the active rows',
     titles(sectionOf(withDeleted, 'TODAY').active).join() === 'Erste,Letzte')
  ok('a deleted task is listed as deleted when the filter is on',
     titles(sectionOf(withDeleted, 'TODAY').deleted).join() === 'Mitte')
  ok('a deleted task is hidden while the filter is off',
     sectionOf(buildSections(deletedList, DEFAULTS, REF), 'TODAY').deleted.length === 0)

  // Restored: back in the middle, not appended at the end.
  const restored = buildSections([first, restore(softDelete(middle)), last], DEFAULTS, REF)
  ok('a restored task returns to its old position, not to the end',
     titles(sectionOf(restored, 'TODAY').active).join() === 'Erste,Mitte,Letzte')
  ok('a restored task is no longer listed as deleted',
     sectionOf(buildSections([first, restore(softDelete(middle)), last], ALL, REF), 'TODAY').deleted.length === 0)
}

// ── the section is re-derived, so check the non-today ones too ──────────────
{
  const later = task({ id: 'l', title: 'Später', due_date: null, sort_order: 3 })
  const secs = buildSections([restore(softDelete(later))], DEFAULTS, REF)
  ok('a restored task without a due date returns to LATER',
     titles(sectionOf(secs, 'LATER').active).join() === 'Später')

  const tomorrow = task({ id: 't', title: 'Morgen', due_date: iso(addDays(today, 1)), sort_order: 4 })
  const secs2 = buildSections([restore(softDelete(tomorrow))], DEFAULTS, REF)
  ok('a restored task due tomorrow returns to MORGEN',
     titles(sectionOf(secs2, 'TOMORROW').active).join() === 'Morgen')
}

// ── an overdue task rolls into HEUTE, exactly as any other active one does ──
{
  const overdue = task({ id: 'o', title: 'Überfällig', due_date: iso(addDays(today, -3)), sort_order: 5 })
  const secs = buildSections([restore(softDelete(overdue))], DEFAULTS, REF)
  ok('a restored overdue task rolls forward into HEUTE like any active task',
     titles(sectionOf(secs, 'TODAY').active).join() === 'Überfällig')
  ok('its stored due_date is not rewritten by the restore',
     restore(softDelete(overdue)).due_date === iso(addDays(today, -3)))
}

// ── a task that was completed before it was deleted comes back completed ───
{
  const done = task({ id: 'd', title: 'Erledigt', due_date: iso(today), sort_order: 6, is_completed: true, completed_at: '2026-08-29T08:00:00.000Z' })
  const back = restore(softDelete(done))
  ok('restore does not un-complete a task', back.is_completed === true)
  const secs = buildSections([back], ALL, REF)
  ok('such a task returns to the completed rows, not the active ones',
     titles(sectionOf(secs, 'TODAY').completed).join() === 'Erledigt' &&
     sectionOf(secs, 'TODAY').active.length === 0)
}

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'restoreLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/restoreLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
