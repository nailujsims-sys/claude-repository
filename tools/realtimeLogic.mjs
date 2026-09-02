// Pure-logic tests for cross-device sync: what a Postgres change event is
// allowed to do to the row list. The websocket half — real channels, a real
// second device, mount/unmount — is exercised in tools/smoke.mjs; what can be
// pinned without a socket is the reducer, and that is where the promises live:
//
//   * an echo of this device's own write changes nothing (same array back, so
//     React does not re-render and nothing flickers);
//   * a row belonging to somebody else never enters the state;
//   * a DELETE for an id we do not hold is ignored — Supabase cannot apply RLS
//     to deletes, so that guard is the only thing between a foreign delete and
//     our list;
//   * the resync after a reconnect keeps the old array when the database has
//     nothing new to say.
//
// Bundled with esbuild like restoreLogic.mjs / homeLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  applyRealtimeChange, mergeRows, isSameRow, channelTopic, ownRowsFilter,
} from './src/lib/realtimeSync.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const ME = '11111111-2222-4333-8444-555555555555'
const SOMEONE_ELSE = '99999999-8888-4777-8666-555555555555'

const task = (over = {}) => ({
  id: 'a', user_id: ME, title: 'Einkaufen', is_completed: false, is_deleted: false,
  sort_order: 1, updated_at: '2026-09-02T10:00:00+00:00', ...over,
})

const insert = (row) => ({ eventType: 'INSERT', new: row, old: {} })
const update = (row) => ({ eventType: 'UPDATE', new: row, old: { id: row.id } })
// What a delete really looks like: the primary key and nothing else.
const remove = (id) => ({ eventType: 'DELETE', new: {}, old: { id } })

// ── 1. the channel is scoped to one table and one user ──────────────────────
{
  ok('one channel per table and user', channelTopic('tasks', ME) === 'sync:tasks:' + ME)
  ok('two tables do not share a channel', channelTopic('tasks', ME) !== channelTopic('events', ME))
  ok('two users do not share a channel', channelTopic('tasks', ME) !== channelTopic('tasks', SOMEONE_ELSE))
  ok('the server-side filter names the owner', ownRowsFilter(ME) === 'user_id=eq.' + ME)
}

// ── 2. a change from another device arrives ─────────────────────────────────
{
  const rows = []
  const afterInsert = applyRealtimeChange(rows, insert(task()), ME)
  ok('an insert adds the row', afterInsert.length === 1 && afterInsert[0].title === 'Einkaufen')

  const renamed = task({ title: 'Großeinkauf', updated_at: '2026-09-02T11:00:00+00:00' })
  const afterUpdate = applyRealtimeChange(afterInsert, update(renamed), ME)
  ok('an update replaces the row', afterUpdate.length === 1 && afterUpdate[0].title === 'Großeinkauf')

  const completed = task({ is_completed: true, updated_at: '2026-09-02T12:00:00+00:00' })
  const afterComplete = applyRealtimeChange(afterUpdate, update(completed), ME)
  ok('completing on another device arrives as an update', afterComplete[0].is_completed === true)

  const afterDelete = applyRealtimeChange(afterComplete, remove('a'), ME)
  ok('a delete removes the row', afterDelete.length === 0)
}

// ── 3. our own change is not applied a second time ──────────────────────────
//     The write already put the server's row into the state; the event that
//     follows says exactly the same thing. Same array back = no render.
{
  const rows = [task()]
  const echo = applyRealtimeChange(rows, update(task()), ME)
  ok('an echo of our own write returns the identical array', echo === rows)

  const insertEcho = applyRealtimeChange(rows, insert(task()), ME)
  ok('a duplicated insert does not duplicate the row', insertEcho === rows)

  const twice = applyRealtimeChange(applyRealtimeChange(rows, remove('a'), ME), remove('a'), ME)
  ok('the same delete twice removes the row once', twice.length === 0)

  const real = applyRealtimeChange(rows, update(task({ title: 'Anders' })), ME)
  ok('a genuine change still produces a new array', real !== rows && real[0].title === 'Anders')
  ok('and does not disturb the rest of the list', real.length === rows.length)
}

// ── 4. nothing of another user ever enters the state ────────────────────────
{
  const rows = [task()]
  const foreign = task({ id: 'x', user_id: SOMEONE_ELSE, title: 'Fremd' })
  ok('a foreign insert is ignored', applyRealtimeChange(rows, insert(foreign), ME) === rows)
  ok('a foreign update is ignored', applyRealtimeChange(rows, update(foreign), ME) === rows)
  // A delete carries no user_id — it cannot. "Do we hold this id?" is the test.
  ok('a delete for an unknown id is ignored', applyRealtimeChange(rows, remove('x'), ME) === rows)
  ok('and the row we do hold is still there', applyRealtimeChange(rows, remove('x'), ME)[0].id === 'a')
}

// ── 5. malformed or irrelevant payloads change nothing ──────────────────────
{
  const rows = [task()]
  ok('an unknown event type is ignored', applyRealtimeChange(rows, { eventType: 'TRUNCATE' }, ME) === rows)
  ok('an insert without a row is ignored', applyRealtimeChange(rows, insert({}), ME) === rows)
  ok('a delete without an id is ignored', applyRealtimeChange(rows, { eventType: 'DELETE', old: {} }, ME) === rows)
  ok('no payload at all is ignored', applyRealtimeChange(rows, null, ME) === rows)
  ok('an empty list survives a delete', applyRealtimeChange([], remove('a'), ME).length === 0)
}

// ── 6. the resync after a reconnect ─────────────────────────────────────────
{
  const rows = [task(), task({ id: 'b', title: 'Zweite' })]
  const same = [task({ id: 'b', title: 'Zweite' }), task()] // same rows, other order
  ok('a resync that found no news keeps the old array', mergeRows(rows, same) === rows)

  const changed = [task({ title: 'Geändert' }), task({ id: 'b', title: 'Zweite' })]
  ok('a resync with a changed row hands over the new list', mergeRows(rows, changed) === changed)

  const added = [...rows, task({ id: 'c', title: 'Neu' })]
  ok('a row created while we were offline appears', mergeRows(rows, added) === added)

  const fewer = [task()]
  ok('a row deleted while we were offline disappears', mergeRows(rows, fewer) === fewer)
  ok('an empty database empties the list', mergeRows(rows, []).length === 0)
}

// ── 7. row equality is the whole basis of "nothing changed" ─────────────────
{
  ok('identical rows are equal', isSameRow(task(), task()))
  ok('a changed field is not equal', !isSameRow(task(), task({ is_completed: true })))
  ok('a new field is not equal', !isSameRow(task(), { ...task(), extra: 1 }))
  ok('a missing field is not equal', !isSameRow(task(), { id: 'a' }))
  ok('a missing row is not equal', !isSameRow(undefined, task()))
}

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'realtimeLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/realtimeLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
