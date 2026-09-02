// What the repositories actually put on the wire.
//
// These bundle the real repository modules against the real supabase-js client
// and let them talk to the same stubbed backend the smoke test uses, so the
// assertions are about requests, not about a mock of our own making. Three
// properties are worth pinning:
//
//   1. no request is ever made without a user id — an unscoped query against a
//      table full of personal rows is the worst failure mode there is;
//   2. every read and write is scoped to that user, on top of RLS;
//   3. a caller cannot smuggle another user's id, or a column the client has
//      no business writing, into a row.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseStub.mjs'

const TEST = `
import { taskRepository } from './src/data/taskRepository.js'
import { eventRepository } from './src/data/eventRepository.js'
import { listRepository } from './src/data/listRepository.js'
import { WRITABLE_FIELDS } from './src/data/taskDefaults.js'
import { makeBackend } from './tools/supabaseStub.mjs'

const USER = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const backend = makeBackend({ tasks: [], events: [], lists: [], listItems: [] })
globalThis.fetch = (...args) => backend.fetch(...args)
const lastCall = () => backend.calls[backend.calls.length - 1]

// ── 1. nothing happens without a user ───────────────────────────────────────
{
  const callsBefore = backend.calls.length
  const attempts = [
    ['listTasks', () => taskRepository.listTasks(null)],
    ['createTask', () => taskRepository.createTask(undefined, { title: 'x' })],
    ['updateTask', () => taskRepository.updateTask('', 'id', { title: 'x' })],
    ['reorderTasks', () => taskRepository.reorderTasks(null, [{ id: 'a', sort_order: 1 }])],
    ['listEvents', () => eventRepository.listEvents(null)],
    ['createEvent', () => eventRepository.createEvent(null, { title: 'x' })],
    ['deleteEvent', () => eventRepository.deleteEvent(null, 'id')],
    ['listLists', () => listRepository.listLists(null)],
    ['listItems', () => listRepository.listItems(undefined)],
    ['createList', () => listRepository.createList(null, { name: 'x' })],
    ['updateList', () => listRepository.updateList('', 'id', { name: 'x' })],
    ['deleteList', () => listRepository.deleteList(null, 'id')],
    ['createItem', () => listRepository.createItem(null, { list_id: 'l', title: 'x' })],
    ['updateItem', () => listRepository.updateItem(null, 'id', { title: 'x' })],
    ['deleteItem', () => listRepository.deleteItem(null, 'id')],
    ['reorderItems', () => listRepository.reorderItems(null, [{ id: 'a', sort_order: 1 }])],
  ]
  for (const [name, run] of attempts) {
    let threw = false
    try { await run() } catch { threw = true }
    ok(name + ' refuses to run without a user', threw)
  }
  ok('and not one request left the client', backend.calls.length === callsBefore)
}

// ── 2. every statement is scoped to the signed-in user ──────────────────────
{
  await taskRepository.listTasks(USER)
  ok('reading tasks filters by user', lastCall().search.includes('user_id=eq.' + USER))
  ok('reading tasks keeps the list order', lastCall().search.includes('order=sort_order.asc'))

  await eventRepository.listEvents(USER)
  ok('reading events filters by user', lastCall().search.includes('user_id=eq.' + USER))

  const task = await taskRepository.createTask(USER, { title: 'Neue Aufgabe' })
  ok('a created task belongs to its user', task.user_id === USER)

  await taskRepository.updateTask(USER, task.id, { title: 'Geändert' })
  ok('an update names both the row and its owner',
     lastCall().search.includes('id=eq.' + task.id) && lastCall().search.includes('user_id=eq.' + USER))

  await taskRepository.reorderTasks(USER, [{ id: task.id, sort_order: 3 }])
  ok('reordering stays scoped', lastCall().search.includes('user_id=eq.' + USER))

  const event = await eventRepository.createEvent(USER, {
    title: 'Termin', start_at: '2026-09-02T09:00', end_at: '2026-09-02T10:00',
  })
  ok('a created event belongs to its user', event.user_id === USER)
  ok('an event carries the device timezone', typeof event.timezone === 'string' && event.timezone.length > 0)

  await eventRepository.deleteEvent(USER, event.id)
  ok('a delete names both the row and its owner',
     lastCall().search.includes('id=eq.' + event.id) && lastCall().search.includes('user_id=eq.' + USER))
  ok('the event is gone from the database', backend.tables.events.length === 0)

  // ── Listen ────────────────────────────────────────────────────────────────
  await listRepository.listLists(USER)
  ok('reading lists filters by user', lastCall().search.includes('user_id=eq.' + USER))
  ok('reading lists keeps the list order', lastCall().search.includes('order=sort_order.asc'))

  await listRepository.listItems(USER)
  ok('reading entries filters by user', lastCall().search.includes('user_id=eq.' + USER))

  const shopping = await listRepository.createList(USER, { name: 'Einkauf', template: 'shopping', icon: 'shopping-cart' })
  ok('a created list belongs to its user', shopping.user_id === USER)
  ok('a created list keeps its template and icon',
     shopping.template === 'shopping' && shopping.icon === 'shopping-cart')

  await listRepository.updateList(USER, shopping.id, { is_pinned: true })
  ok('a list update names both the row and its owner',
     lastCall().search.includes('id=eq.' + shopping.id) && lastCall().search.includes('user_id=eq.' + USER))

  const apples = await listRepository.createItem(USER, {
    list_id: shopping.id, title: 'Äpfel', quantity: 6, unit: 'Stück',
  })
  ok('an entry belongs to its user and to its list',
     apples.user_id === USER && apples.list_id === shopping.id)
  ok('an entry keeps its template-specific fields', apples.quantity === 6 && apples.unit === 'Stück')

  await listRepository.updateItem(USER, apples.id, { is_done: true, done_at: new Date().toISOString() })
  ok('an entry update stays scoped',
     lastCall().search.includes('id=eq.' + apples.id) && lastCall().search.includes('user_id=eq.' + USER))

  await listRepository.reorderItems(USER, [{ id: apples.id, sort_order: 2 }])
  ok('reordering entries stays scoped', lastCall().search.includes('user_id=eq.' + USER))

  await listRepository.deleteItem(USER, apples.id)
  ok('deleting an entry names both the row and its owner',
     lastCall().search.includes('id=eq.' + apples.id) && lastCall().search.includes('user_id=eq.' + USER))

  // Deleting a list must take its entries with it — "on delete cascade" in the
  // migration, emulated by the stub, and the reason there is no second request
  // here that a failure could leave half-done.
  const keeper = await listRepository.createItem(USER, { list_id: shopping.id, title: 'Milch' })
  ok('the entry is in the database before the list goes',
     backend.tables.list_items.some((r) => r.id === keeper.id))
  await listRepository.deleteList(USER, shopping.id)
  ok('deleting a list names both the row and its owner',
     lastCall().search.includes('id=eq.' + shopping.id) && lastCall().search.includes('user_id=eq.' + USER))
  ok('the list is gone', !backend.tables.lists.some((r) => r.id === shopping.id))
  ok('and so are its entries', !backend.tables.list_items.some((r) => r.list_id === shopping.id))
}

// ── 3. a caller cannot write what it should not ─────────────────────────────
{
  // The signed-in id wins over anything the caller passes, so a row can never
  // be created into somebody else's account from this client.
  const smuggled = await taskRepository.createTask(USER, { title: 'Untergeschoben', user_id: OTHER })
  ok('a supplied user_id is overruled by the session', smuggled.user_id === USER)

  // Server-managed columns are not the client's to set.
  const forged = await taskRepository.createTask(USER, {
    title: 'Mit Extras',
    id: 'forged-id',
    created_at: '1999-01-01T00:00:00.000Z',
    is_admin: true,
  })
  ok('a forged id is dropped', forged.id !== 'forged-id')
  ok('a forged created_at is dropped', forged.created_at !== '1999-01-01T00:00:00.000Z')
  ok('an unknown column never reaches the database', !('is_admin' in forged))

  ok('the writable list is a whitelist, not a guess',
     WRITABLE_FIELDS.length > 0 && !WRITABLE_FIELDS.includes('user_id') && !WRITABLE_FIELDS.includes('id'))

  // The same three properties for the Listen tables.
  const ownedList = await listRepository.createList(USER, { name: 'Meine Liste', user_id: OTHER })
  ok('a supplied user_id is overruled on a list too', ownedList.user_id === USER)
  const forgedList = await listRepository.createList(USER, {
    name: 'Mit Extras', id: 'forged-list', created_at: '1999-01-01T00:00:00.000Z', is_admin: true,
  })
  ok('a forged list id is dropped', forgedList.id !== 'forged-list')
  ok('an unknown column never reaches the lists table', !('is_admin' in forgedList))

  const ownedItem = await listRepository.createItem(USER, {
    list_id: ownedList.id, title: 'Eintrag', user_id: OTHER, id: 'forged-item', is_admin: true,
  })
  ok('a supplied user_id is overruled on an entry too', ownedItem.user_id === USER)
  ok('a forged entry id is dropped', ownedItem.id !== 'forged-item')
  ok('an unknown column never reaches the entries table', !('is_admin' in ownedItem))
}

// ── 4. a failing database throws instead of returning nothing ───────────────
// Silently returning [] is how a broken connection turns into "all your tasks
// are gone" on screen.
{
  const failing = makeBackend({ tasks: [], failTable: 'tasks' })
  globalThis.fetch = (...args) => failing.fetch(...args)
  let threw = false
  try { await taskRepository.listTasks(USER) } catch { threw = true }
  ok('a 500 from the database reaches the caller', threw)

  const failingLists = makeBackend({ lists: [], failTable: 'lists' })
  globalThis.fetch = (...args) => failingLists.fetch(...args)
  let listsThrew = false
  try { await listRepository.listLists(USER) } catch { listsThrew = true }
  ok('and a 500 on the lists table does the same', listsThrew)
}

console.log(\`data logic: \${pass} passed, \${fail} failed\`)
if (fail) process.exit(1)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'dataLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*'],
  define: {
    'import.meta.env': JSON.stringify({
      MODE: 'test',
      DEV: false,
      PROD: true,
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    }),
  },
  write: false,
  logLevel: 'silent',
})

// Creating a Supabase client also builds its realtime client, and that one
// insists on a WebSocket implementation. Browsers have one, Node 22 has one,
// Node 20 — which CI pins — does not, so the suite passed locally and failed
// on the runner. The app opens no realtime connection (that is the next piece
// of work, not this one), so a stub that would throw if anything ever used it
// is both enough and honest.
globalThis.WebSocket ??= class RealtimeIsNotUnderTest {
  constructor() {
    throw new Error('dataLogic: the repositories must not open a realtime connection')
  }
}

const out = `${process.env.SCRATCH || '/tmp'}/dataLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
