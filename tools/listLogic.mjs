// Pure-logic tests for the Listen module.
//
// Three promises are worth pinning here, because all three are rules a screen
// can only obey if the layer underneath it is right:
//
//   1. THE sorting rule — open entries above, done entries below, and a ticked
//      entry lands where the user can see it. Every screen reads this from one
//      function, so it is asserted once.
//   2. The quick-add reading. "Äpfel 6 Stück" has to become three fields and
//      "Kapitel 2 lesen" has to stay one, or the fast path costs more than it
//      saves.
//   3. That archiving and reactivating are exact inverses, which is the whole
//      reason a finished list does not have to be deleted.
//
// The UI half — the sheets, the drag, the animation — is behavioural and is
// covered by tools/smoke.mjs. Bundled with esbuild like the other logic suites.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  archivedLists,
  formatAmount,
  formatQuantity,
  groupByCategory,
  itemCountLabel,
  itemTrailingLabel,
  itemsOfList,
  nextSortOrder,
  openAmountTotal,
  partitionItems,
  splitLists,
} from './src/lib/listSelectors.js'
import { numberToInput, parseNumber, parseQuickAdd } from './src/lib/listParsing.js'
import {
  LIST_TEMPLATES,
  listTemplate,
  templateHasField,
  SHOPPING_CATEGORIES,
} from './src/config/listTemplates.js'
import { WRITABLE_LIST_FIELDS, WRITABLE_LIST_ITEM_FIELDS } from './src/data/listDefaults.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const titles = (rows) => rows.map((r) => r.title).join(',')

const list = (over) => ({
  id: 'l', user_id: 'u', name: 'Liste', template: 'standard', icon: 'clipboard-list',
  is_pinned: false, is_archived: false, archived_at: null, sort_order: 0,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', ...over,
})
const item = (over) => ({
  id: 'i', user_id: 'u', list_id: 'l', title: 'Eintrag', is_done: false, done_at: null,
  sort_order: 0, quantity: null, unit: null, amount: null, category: null,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', ...over,
})

// ── 1. templates ────────────────────────────────────────────────────────────
{
  ok('there are exactly the three templates the module promises',
     LIST_TEMPLATES.map((t) => t.id).join() === 'standard,shopping,money')
  ok('an unknown template falls back to Standard rather than to nothing',
     listTemplate('projekt').id === 'standard' && listTemplate(undefined).id === 'standard')
  ok('Standard carries no extra fields', listTemplate('standard').fields.length === 0)
  ok('Einkauf carries quantity and unit',
     templateHasField('shopping', 'quantity') && templateHasField('shopping', 'unit'))
  ok('Geld carries an amount and no quantity',
     templateHasField('money', 'amount') && !templateHasField('money', 'quantity'))
  ok('every template names an icon that is a plain key',
     LIST_TEMPLATES.every((t) => typeof t.icon === 'string' && t.icon.length > 0))
  ok('the Einkauf categories are a closed, non-empty set',
     SHOPPING_CATEGORIES.length > 0 && new Set(SHOPPING_CATEGORIES).size === SHOPPING_CATEGORIES.length)
}

// ── 2. THE sorting rule ─────────────────────────────────────────────────────
{
  const rows = [
    item({ id: 'a', title: 'A', sort_order: 0 }),
    item({ id: 'b', title: 'B', sort_order: 1, is_done: true, done_at: '2026-09-01T10:00:00.000Z' }),
    item({ id: 'c', title: 'C', sort_order: 2 }),
    item({ id: 'd', title: 'D', sort_order: 3, is_done: true, done_at: '2026-09-01T12:00:00.000Z' }),
  ]
  const { open, done } = partitionItems(rows)
  ok('open entries stay above and in their own order', titles(open) === 'A,C')
  ok('done entries are the rest', titles(done) === 'D,B')
  ok('the entry ticked off most recently is at the top of Erledigt', done[0].id === 'd')
  ok('no entry is in both halves and none is lost',
     open.length + done.length === rows.length &&
     open.every((o) => !done.some((d) => d.id === o.id)))

  // Ticking an entry off is one field; the sections follow from it.
  const ticked = rows.map((r) => (r.id === 'a' ? { ...r, is_done: true, done_at: '2026-09-01T13:00:00.000Z' } : r))
  const after = partitionItems(ticked)
  ok('a ticked entry leaves the open section', titles(after.open) === 'C')
  ok('and arrives at the top of Erledigt', after.done[0].id === 'a')

  // …and putting it back is the exact inverse.
  const restored = ticked.map((r) => (r.id === 'a' ? { ...r, is_done: false, done_at: null } : r))
  const back = partitionItems(restored)
  ok('restoring returns it to its old place among the open entries', titles(back.open) === 'A,C')
  ok('and Erledigt is what it was before', titles(back.done) === 'D,B')
}

// ── 3. lists: pinned first, archived elsewhere ──────────────────────────────
{
  const rows = [
    list({ id: '1', name: 'Einkauf', sort_order: 0, is_pinned: true }),
    list({ id: '2', name: 'Bücher', sort_order: 1 }),
    list({ id: '3', name: 'Geld', sort_order: 2, is_pinned: true }),
    list({ id: '4', name: 'Alt', sort_order: 3, is_archived: true, archived_at: '2026-08-20T00:00:00.000Z' }),
    list({ id: '5', name: 'Älter', sort_order: 4, is_archived: true, archived_at: '2026-08-10T00:00:00.000Z' }),
  ]
  const { pinned, others } = splitLists(rows)
  ok('pinned lists are their own group', pinned.map((l) => l.name).join() === 'Einkauf,Geld')
  ok('the rest keeps the user order', others.map((l) => l.name).join() === 'Bücher')
  ok('an archived list is in neither overview group',
     ![...pinned, ...others].some((l) => l.is_archived))
  ok('the archive holds exactly the archived ones, newest first',
     archivedLists(rows).map((l) => l.name).join() === 'Alt,Älter')

  // Archive and reactivate, as ListsContext performs them.
  const archive = (l) => ({ ...l, is_archived: true, archived_at: '2026-09-02T08:00:00.000Z' })
  const unarchive = (l) => ({ ...l, is_archived: false, archived_at: null })
  const source = rows[0]
  const roundTrip = unarchive(archive(source))
  ok('archiving and reactivating are exact inverses',
     Object.keys(source).every((k) => roundTrip[k] === source[k]))
  ok('archiving leaves the pin, the name and the icon alone',
     archive(source).is_pinned === source.is_pinned && archive(source).name === source.name)
}

// ── 4. entries belong to one list ───────────────────────────────────────────
{
  const rows = [item({ id: 'a', list_id: 'l1' }), item({ id: 'b', list_id: 'l2' })]
  ok('a list only ever sees its own entries', itemsOfList(rows, 'l1').map((i) => i.id).join() === 'a')
  ok('nextSortOrder starts at 0 for an empty list', nextSortOrder([]) === 0)
  ok('and appends after the highest existing order',
     nextSortOrder([item({ sort_order: 0 }), item({ sort_order: 4 })]) === 5)
}

// ── 5. quick add ────────────────────────────────────────────────────────────
{
  ok('a Standard list never parses anything',
     JSON.stringify(parseQuickAdd('standard', 'Kapitel 2 lesen')) === JSON.stringify({ title: 'Kapitel 2 lesen' }))
  ok('empty input creates nothing', parseQuickAdd('standard', '   ') === null)

  const apples = parseQuickAdd('shopping', 'Äpfel 6 Stück')
  ok('"Äpfel 6 Stück" reads as three fields',
     apples.title === 'Äpfel' && apples.quantity === 6 && apples.unit === 'Stück')
  const tomatoes = parseQuickAdd('shopping', 'Tomaten 500 g')
  ok('"Tomaten 500 g" keeps the unit', tomatoes.title === 'Tomaten' && tomatoes.quantity === 500 && tomatoes.unit === 'g')
  const milk = parseQuickAdd('shopping', 'Milch 2')
  ok('"Milch 2" is a quantity without a unit',
     milk.title === 'Milch' && milk.quantity === 2 && milk.unit === null)
  const bread = parseQuickAdd('shopping', 'Brot')
  ok('a bare article stays a bare article',
     bread.title === 'Brot' && bread.quantity === null && bread.unit === null)
  const dashed = parseQuickAdd('shopping', 'Mehl – 1 kg')
  ok('a typed dash is a separator, not part of the name',
     dashed.title === 'Mehl' && dashed.quantity === 1 && dashed.unit === 'kg')
  const numberOnly = parseQuickAdd('shopping', '42')
  ok('a line that is nothing but a number becomes an entry called "42"',
     numberOnly.title === '42' && numberOnly.quantity === null)
  const decimal = parseQuickAdd('shopping', 'Hack 0,5 kg')
  ok('German decimals are read as decimals', decimal.quantity === 0.5)

  const max = parseQuickAdd('money', 'Max Mustermann 25,00 €')
  ok('"Max Mustermann 25,00 €" reads as a person and an amount',
     max.title === 'Max Mustermann' && max.amount === 25)
  ok('the euro sign may hug the number', parseQuickAdd('money', 'Anna 40€').amount === 40)
  ok('a name on its own has no amount', parseQuickAdd('money', 'Paul').amount === null)
  ok('a money entry never gets a quantity', !('quantity' in parseQuickAdd('money', 'Paul 5')))
  ok('a shopping entry never gets an amount', !('amount' in parseQuickAdd('shopping', 'Brot 2')))

  ok('parseNumber accepts both separators', parseNumber('1.250,50') === 1250.5 && parseNumber('12.5') === 12.5)
  ok('parseNumber refuses what is not a number', parseNumber('zwölf') === null && parseNumber('') === null)
  ok('numberToInput hands a stored value back the way it is typed',
     numberToInput(0.5) === '0,5' && numberToInput(6) === '6' && numberToInput(null) === '')
}

// ── 6. what a row shows on its right ────────────────────────────────────────
{
  ok('a Standard entry shows nothing on the right',
     itemTrailingLabel(item({ quantity: 3, amount: 9 }), 'standard') === '')
  ok('an Einkauf entry shows its quantity and unit',
     itemTrailingLabel(item({ quantity: 6, unit: 'Stück' }), 'shopping') === '6 Stück')
  ok('an Einkauf entry without a quantity shows nothing',
     itemTrailingLabel(item({ unit: 'g' }), 'shopping') === '')
  ok('a Geld entry shows a formatted amount',
     itemTrailingLabel(item({ amount: 25 }), 'money').replace(/\\u00a0/g, ' ') === '25,00 €')
  ok('formatQuantity writes German decimals', formatQuantity(0.5, 'kg') === '0,5 kg')

  // What Postgres actually stores is numeric(12,3) / numeric(12,2), so the
  // production API answers "6.000" and "25.00" where the test stub answers 6
  // and 25 — and PostgREST is free to send a numeric as a JSON string to keep
  // its precision. Verified against the live project (2026-09). Every consumer
  // goes through Number(), so both forms render identically; this pins that,
  // because a formatter that started trusting the JS type would only fail in
  // production.
  ok('a numeric from the database renders like a plain number',
     formatQuantity('6.000', 'Stück') === '6 Stück' && formatQuantity(6, 'Stück') === '6 Stück')
  ok('and so does a scaled amount',
     formatAmount('25.00').replace(/\u00a0/g, ' ') === '25,00 €')
  ok('the open total adds up strings and numbers alike',
     openAmountTotal([item({ amount: '25.00' }), item({ amount: 12.5 })]) === 37.5)
  ok('an editable field shows a scaled numeric without its trailing zeros',
     numberToInput('6.000') === '6' && numberToInput('0.500') === '0,5')
  ok('formatAmount writes German currency',
     formatAmount(1234.5).replace(/\\u00a0/g, ' ') === '1.234,50 €')
}

// ── 7. the Geld total, and the Einkauf grouping ─────────────────────────────
{
  const rows = [
    item({ id: 'a', amount: 25 }),
    item({ id: 'b', amount: 12.5 }),
    item({ id: 'c', amount: 40, is_done: true, done_at: '2026-09-01T00:00:00.000Z' }),
  ]
  ok('the total adds up only what is still open', openAmountTotal(rows) === 37.5)
  ok('a list with nothing open has no total at all', openAmountTotal([rows[2]]) === null)
  ok('and neither has an empty list', openAmountTotal([]) === null)

  const shopping = [
    item({ id: 'a', title: 'Brot' }),
    item({ id: 'b', title: 'Äpfel', category: 'Obst & Gemüse' }),
    item({ id: 'c', title: 'Milch', category: 'Milchprodukte' }),
    item({ id: 'd', title: 'Birnen', category: 'Obst & Gemüse' }),
  ]
  const groups = groupByCategory(shopping)
  ok('the uncategorised entries lead, unlabelled', groups[0].key === '' && titles(groups[0].items) === 'Brot')
  ok('categories group their own entries',
     groups.find((g) => g.key === 'Obst & Gemüse').items.length === 2)
  ok('every entry lands in exactly one group',
     groups.reduce((n, g) => n + g.items.length, 0) === shopping.length)
  ok('a list nobody categorised is one flat unlabelled group',
     groupByCategory([item({ id: 'x' }), item({ id: 'y' })]).length === 1)
  ok('the empty list produces no groups at all', groupByCategory([]).length === 0)

  ok('the archive counts entries in German', itemCountLabel(1) === '1 Eintrag' && itemCountLabel(5) === '5 Einträge')
}

// ── 8. the writable whitelists ──────────────────────────────────────────────
// Same property tools/dataLogic.mjs asserts for tasks: a caller cannot name a
// server-managed column, whatever it hands the repository.
{
  for (const [name, fields] of [['lists', WRITABLE_LIST_FIELDS], ['list_items', WRITABLE_LIST_ITEM_FIELDS]]) {
    ok(name + ' has a whitelist, not a guess', fields.length > 0)
    ok(name + ' never lets a client write id, user_id or created_at',
       !fields.includes('id') && !fields.includes('user_id') && !fields.includes('created_at'))
  }
  ok('an entry may say which list it is in', WRITABLE_LIST_ITEM_FIELDS.includes('list_id'))
}

console.log(\`list logic: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'listLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/listLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
