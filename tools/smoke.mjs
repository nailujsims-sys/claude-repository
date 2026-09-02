// Runtime smoke test: bundle the app with esbuild and mount it in jsdom so we
// actually execute React (catching crash-on-mount / bad-hook / import errors
// that a production build alone won't surface).
//
// Since the app has no local store any more, the harness supplies the only
// thing it can read from: a stubbed Supabase (tools/supabaseStub.mjs) that
// answers the very requests supabase-js sends. So a rendered task is a task
// that came over the wire — which is exactly the property that used to be
// missing, and the reason two devices never saw the same data.
//
// No real network and no browser: the stub is installed as `window.fetch`.
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { webcrypto } from 'node:crypto'
import {
  makeBackend,
  STORAGE_KEY,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TEST_USER_ID,
  TEST_EMAIL,
} from './supabaseStub.mjs'
import { makeRealtimeHub } from './realtimeStub.mjs'
import { seedTasks } from './fixtures/seedTasks.mjs'
import { seedEvents } from './fixtures/seedEvents.mjs'

const TEST_PASSWORD = 'richtiges-passwort'

async function bundle({ configured = true } = {}) {
  const env = {
    MODE: 'test',
    DEV: false,
    PROD: true,
    ...(configured
      ? { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY }
      : {}),
  }
  const result = await build({
    entryPoints: ['src/main.jsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: {
      'import.meta.env': JSON.stringify(env),
      'process.env.NODE_ENV': '"production"',
    },
    write: false,
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

// One window = one browser = one device. `seed` fills the stubbed database;
// `signedIn` decides whether this device has a session, which is how the login
// and logout paths are exercised.
function makeDom(hash, seed = {}, options = {}) {
  const { signedIn = true, backend: existing = null, search = '', hub = makeRealtimeHub() } = options
  const window = makeBareDom(hash, search)
  const backend =
    existing ??
    makeBackend({
      tasks: seed.tasks ?? seedTasks(),
      events: seed.events ?? seedEvents(),
      // Off by default: an account without a Google connection is the state
      // every other section in this file runs in, and the app has to be
      // unchanged there.
      googleConnections: seed.googleConnections ?? [],
      googleCalendars: seed.googleCalendars ?? [],
      functions: seed.functions ?? {},
      password: TEST_PASSWORD,
      failTable: seed.failTable ?? null,
      // Every committed row change is announced to the Realtime hub, the way
      // Postgres announces one through the WAL.
      onChange: hub.emit,
    })


  // jsdom ships no fetch, so the app gets Node's classes plus the stub.
  window.fetch = (...args) => backend.fetch(...args)
  window.Headers = Headers
  window.Request = Request
  window.Response = Response
  if (signedIn) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(backend.session))
  // The transport @supabase/realtime-js picks up. Every window gets one, so no
  // test ever reaches for a real socket; windows that share a `hub` are devices
  // on the same account and see each other's changes.
  window.WebSocket = hub.WebSocket
  window.__backend = backend
  window.__hub = hub
  return window
}

function makeBareDom(hash, search = '') {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="root"></div></body></html>`,
    { url: `http://localhost/${search}${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' }
  )
  const { window } = dom
  try {
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true })
  } catch {
    if (window.crypto && !window.crypto.randomUUID) {
      window.crypto.randomUUID = () => webcrypto.randomUUID()
    }
  }
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  window.scrollTo = () => {}
  return window
}

const errors = []
// `expectErrors` is for the cases whose subject IS a failure — a database that
// answers 500 logs, and must log, on its way to the banner.
function mount(window, code, name, { expectErrors = false } = {}) {
  window.addEventListener('error', (e) => {
    if (!expectErrors) errors.push(`[${name}] ${e.message}`)
  })
  const orig = console.error
  console.error = (...a) => {
    if (!expectErrors) errors.push(`[${name}] console.error: ${a.join(' ').slice(0, 200)}`)
  }
  try {
    window.eval(code)
  } finally {
    // keep capturing console.error during effects; restore later
    window.__restoreConsole = () => (console.error = orig)
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const txt = (window) =>
  (window.document.getElementById('root').textContent || '').replace(/\s+/g, ' ').trim()

function click(window, predicate) {
  const els = [...window.document.querySelectorAll('button, [role="button"]')]
  const el = els.find(predicate)
  if (!el) return false
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
}

// Type into a React-controlled input (uses the native value setter so React's
// onChange fires), then dispatch an 'input' event.
// Dispatch a key on `window`, where the overlay's Escape and Tab listeners sit.
function press(window, key, { shiftKey = false } = {}) {
  const e = new window.KeyboardEvent('keydown', {
    key, shiftKey, bubbles: true, cancelable: true,
  })
  window.dispatchEvent(e)
  return e
}

// The focusable elements of a scope, in the same order the trap walks them.
function focusables(window, root) {
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => !el.closest('[inert]'))
}

// The actionable toast's own control, and the full scope Tab walks with it
// (G21): the panel's controls first, the toast last. Mirrors scopeWithin() in
// src/components/Overlay.jsx, so a divergence between the two shows up here.
function undoButton(window) {
  return [...window.document.querySelectorAll('[role="status"] button')].find(
    (el) => el.textContent.trim() === 'Rückgängig'
  )
}
function scopeOf(window, root) {
  const undo = undoButton(window)
  return [...focusables(window, root), ...(undo ? [undo] : [])]
}

const locked = (window) => window.document.documentElement.hasAttribute('data-ov-scroll-locked')

function typeInto(window, selector, text) {
  const el = window.document.querySelector(selector)
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, text)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
  return true
}

async function run() {
  const code = await bundle()

  // 1) Each route mounts and renders.
  //
  //    The global top bar is collected on the way through: every main area
  //    renders the same `TopBar`, so its markup must come out byte-identical
  //    from route to route (see the comparison right after the loop). jsdom
  //    does no layout, so this checks the *structure* the geometry follows
  //    from — the classes that carry the height and the insets, the menu
  //    button, the title block and the action rail. The measured pixel
  //    positions are verified in a real browser, not here.
  const topbars = []
  for (const [name, hash] of [
    ['Home (/)', '#/'],
    ['Aufgaben (/aufgaben)', '#/aufgaben'],
    ['Mehr (/mehr)', '#/mehr'],
    ['Version (/version)', '#/version'],
    ['Kalender (/kalender)', '#/kalender'],
  ]) {
    const window = makeDom(hash)
    mount(window, code, name)
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== ${name} ===\n  len=${text.length} :: ${text.slice(0, 150)}`)
    if (text.length < 20) errors.push(`[${name}] rendered almost nothing`)
    // The seed has a 2-days-overdue task, so the list must render the overdue label.
    if (name.startsWith('Aufgaben') && !text.includes('Überfällig')) {
      errors.push(`[${name}] overdue task label "Überfällig" not rendered`)
    }
    // The version screen must show a version, a build time and a commit. Under
    // esbuild the vite `define`s are absent, so it renders its dev fallback —
    // which is exactly the path that must not crash (see src/lib/version.js).
    if (name.startsWith('Version')) {
      for (const needle of ['v0.0.0-dev', 'Build', 'Commit', 'unbekannt']) {
        if (!text.includes(needle)) errors.push(`[${name}] missing "${needle}"`)
      }
    }

    const bar = window.document.querySelector('[data-topbar]')
    if (!bar) {
      errors.push(`[${name}] no global top bar`)
    } else {
      const menu = bar.querySelector('button[aria-label="Menü öffnen"]')
      const row = bar.firstElementChild
      const title = bar.querySelector('h1')
      const rail = bar.querySelector('[data-topbar-actions]')
      if (!menu) errors.push(`[${name}] the top bar has no menu button`)
      if (!title) errors.push(`[${name}] the top bar has no title`)
      if (!rail) errors.push(`[${name}] the top bar has no action pair`)
      // The menu button must be the row's first child: same slot everywhere.
      if (menu && row && row.firstElementChild !== menu)
        errors.push(`[${name}] the menu button is not the first item in the bar`)
      // No screen may nudge the bar or its menu button by itself — that is
      // exactly what the per-screen headers used to do (`-ml-1`, `pt-3` vs
      // `pt-5`) and what made the hamburger land somewhere else on every page.
      if (menu && /-m[lrtb]?-/.test(menu.className))
        errors.push(`[${name}] the menu button carries a per-screen offset: ${menu.className}`)
      // The page title is the module's name and nothing else. The calendar's
      // date in particular is content and belongs under the bar — putting it in
      // the title is what made the bar page-dependent in the first place.
      const expected = {
        'Home (/)': 'Heute',
        'Aufgaben (/aufgaben)': 'Aufgaben',
        'Mehr (/mehr)': 'Mehr',
        'Version (/version)': 'Version',
        'Kalender (/kalender)': 'Kalender',
      }[name]
      const shown = title?.textContent.trim()
      if (shown !== expected) errors.push(`[${name}] top bar title is "${shown}", expected "${expected}"`)
      topbars.push([
        name,
        [
          bar.className,
          bar.getAttribute('style') || '',
          row?.className,
          menu?.className,
          // The title's own classes carry size, weight and leading: one style
          // for every screen, no per-page typography.
          title?.className,
          rail?.className,
          // Action count and box size — the pair is right-anchored, so equal
          // counts of equally sized targets means equal positions.
          [...(rail?.children || [])]
            .map((el) => el.className.match(/h-\d+ w-\d+/)?.[0] || el.className)
            .join('|'),
        ].join(' ~ '),
      ])
    }
  }

  // 1b) One bar, not five. Every route's bar — geometry, title typography and
  //     the trailing pair — must produce the exact same signature.
  {
    const groups = new Map()
    for (const [name, sig] of topbars) {
      if (!groups.has(sig)) groups.set(sig, [])
      groups.get(sig).push(name)
    }
    if (groups.size !== 1) {
      errors.push(
        `[TopBar] the bar differs between routes: ${[...groups.values()].map((g) => g.join('+')).join(' vs ')}`
      )
    }
    console.log(
      `\n=== TopBar (global) ===\n  routes=${topbars.length} identisch=${groups.size === 1} ` +
        `:: ${topbars[0]?.[1].slice(0, 130)}`
    )
  }

  // 2) Detail view for a known, pre-seeded task (exercises formatDueLabel etc.).
  {
    const now = new Date().toISOString()
    // Monday of the current week, so the week-type due label is deterministically
    // "Diese Woche" regardless of when the test runs.
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const mondayIso = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
    const task = {
      id: 'seed-1', user_id: TEST_USER_ID, title: 'Testaufgabe Detail',
      category: 'Uni', subcategory: 'Test', details: 'Ein Detailtext.',
      due_date: mondayIso, due_time: null, due_type: 'week',
      is_favorite: true, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0, created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben/seed-1', { tasks: [task] })
    mount(window, code, 'Detail')
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Detail (/aufgaben/seed-1) ===\n  ${text.slice(0, 170)}`)
    for (const needle of ['Testaufgabe Detail', 'Bearbeiten', 'Löschen', 'Diese Woche']) {
      if (!text.includes(needle)) errors.push(`[Detail] missing "${needle}"`)
    }
  }

  // 2b) Delete + undo (G8). Deleting a task is reversible, so it commits on
  //     press with no confirmation and the toast carries the way back. Checks
  //     the whole round trip: no dialog, row gone, toast + action, row back.
  {
    const now = new Date().toISOString()
    const task = {
      id: 'seed-del', user_id: TEST_USER_ID, title: 'Löschbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben/seed-del', { tasks: [task] })
    mount(window, code, 'Undo')
    await wait(250)

    // The live region must exist before any toast does, or it is not announced.
    const region = window.document.querySelector('[role="status"][aria-live="polite"]')
    if (!region) errors.push('[Undo] toast live region missing before the first toast')

    if (!click(window, (el) => el.textContent.trim() === 'Löschen'))
      errors.push('[Undo] "Löschen" button not found')
    await wait(150)
    let text = txt(window)
    console.log(`\n=== Undo (nach Löschen) ===\n  ${text.slice(0, 170)}`)
    if (text.includes('Aufgabe löschen?'))
      errors.push('[Undo] a confirm dialog still appears for a reversible delete')
    if (!text.includes('Aufgabe gelöscht'))
      errors.push('[Undo] toast "Aufgabe gelöscht" not shown')
    if (!text.includes('Rückgängig'))
      errors.push('[Undo] toast action "Rückgängig" not shown')
    if (text.includes('Löschbare Aufgabe'))
      errors.push('[Undo] the deleted task is still listed')

    if (!click(window, (el) => el.textContent.trim() === 'Rückgängig'))
      errors.push('[Undo] "Rückgängig" not clickable')
    await wait(150)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`=== Undo (nach Rückgängig) ===\n  ${text.slice(0, 170)}`)
    if (!text.includes('Löschbare Aufgabe'))
      errors.push('[Undo] the task did not come back')
    if (!text.includes('Aufgabe wiederhergestellt'))
      errors.push('[Undo] follow-up toast "Aufgabe wiederhergestellt" not shown')
    if (text.includes('Rückgängig'))
      errors.push('[Undo] the undo toast was not retired after use')
  }

  // 2c) Complete + undo (G7). Completion commits on the tap — the 150ms wait
  //     below is deliberately shorter than the 300ms timer this replaces, so a
  //     re-introduced delay fails here. Then both halves of the toast rule: the
  //     row is gone → toast with the way back; the filter keeps the row on
  //     screen → its own circle is the way back and no toast is raised.
  {
    const now = new Date().toISOString()
    const task = {
      id: 'seed-done', user_id: TEST_USER_ID, title: 'Erledigbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben', { tasks: [task] })
    mount(window, code, 'Complete')
    await wait(250)

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren'))
      errors.push('[Complete] the completion circle was not found')
    await wait(150)
    let text = txt(window)
    console.log(`\n=== Complete (nach Tippen auf den Kreis) ===\n  ${text.slice(0, 170)}`)
    if (text.includes('Erledigbare Aufgabe'))
      errors.push('[Complete] the task is still listed — completion did not commit on press')
    if (!text.includes('Aufgabe erledigt'))
      errors.push('[Complete] toast "Aufgabe erledigt" not shown')
    if (!text.includes('Rückgängig'))
      errors.push('[Complete] toast action "Rückgängig" not shown')

    if (!click(window, (el) => el.textContent.trim() === 'Rückgängig'))
      errors.push('[Complete] "Rückgängig" not clickable')
    await wait(150)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`=== Complete (nach Rückgängig) ===\n  ${text.slice(0, 170)}`)
    if (!text.includes('Erledigbare Aufgabe'))
      errors.push('[Complete] the task did not come back')
    if (!text.includes('Aufgabe wieder offen'))
      errors.push('[Complete] follow-up toast "Aufgabe wieder offen" not shown')
    if (text.includes('Rückgängig'))
      errors.push('[Complete] the undo toast was not retired after use')
  }

  // 2d) The other half of the same rule (G7): with "Erledigte Aufgaben
  //     anzeigen" on, the completed row stays in its card and its own circle
  //     un-completes it — so no toast is raised. Its own window, so no toast
  //     from 2c can still be on screen when that is asserted.
  {
    const now = new Date().toISOString()
    const task = {
      id: 'seed-visible', user_id: TEST_USER_ID, title: 'Sichtbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben', { tasks: [task] })
    mount(window, code, 'CompleteVisible')
    await wait(250)

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Filter'))
      errors.push('[CompleteVisible] Filter button not found')
    await wait(150)
    if (!click(window, (el) => el.textContent.trim() === 'Erledigte Aufgaben anzeigen'))
      errors.push('[CompleteVisible] filter row "Erledigte Aufgaben anzeigen" not found')
    // The draft has to be re-rendered before "Anwenden" reads it.
    await wait(80)
    if (!click(window, (el) => el.textContent.trim() === 'Anwenden'))
      errors.push('[CompleteVisible] "Anwenden" not found')
    await wait(250)

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren'))
      errors.push('[CompleteVisible] the completion circle was not found')
    await wait(150)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Complete (Filter: Erledigte sichtbar) ===\n  ${text.slice(0, 170)}`)
    if (!text.includes('Sichtbare Aufgabe'))
      errors.push('[CompleteVisible] the completed row is not shown while the filter is on')
    if (!window.document.querySelector('[aria-label="Als offen markieren"]'))
      errors.push('[CompleteVisible] the completed row does not offer "Als offen markieren"')
    if (text.includes('Aufgabe erledigt') || text.includes('Rückgängig'))
      errors.push('[CompleteVisible] a toast was raised although the completed row stays on screen')
  }

  // 2e) Restore from the Papierkorb — the list half (G17). Once the 5s undo
  //     toast is gone, the deleted row itself has to carry the way back. Two
  //     tasks with known sort_orders around the deleted one, so the assertion
  //     is not just "it came back" but "it came back where it was".
  {
    const now = new Date().toISOString()
    const mk = (id, title, sort_order, over = {}) => ({
      id, user_id: TEST_USER_ID, title,
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order,
      created_at: now, updated_at: now, ...over,
    })
    const seeded = [
      mk('r-first', 'Erste Aufgabe', 0),
      mk('r-mid', 'Papierkorb Aufgabe', 1, { is_deleted: true, deleted_at: now }),
      mk('r-last', 'Letzte Aufgabe', 2),
    ]
    const window = makeDom('#/aufgaben', { tasks: seeded })
    mount(window, code, 'Restore')
    await wait(250)

    // Hidden until the Papierkorb filter is on — the existing behaviour.
    if (txt(window).includes('Papierkorb Aufgabe'))
      errors.push('[Restore] the deleted task is listed although the filter is off')

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Filter'))
      errors.push('[Restore] Filter button not found')
    await wait(150)
    if (!click(window, (el) => el.textContent.trim() === 'Gelöschte Aufgaben anzeigen'))
      errors.push('[Restore] filter row "Gelöschte Aufgaben anzeigen" not found')
    await wait(80)
    if (!click(window, (el) => el.textContent.trim() === 'Anwenden'))
      errors.push('[Restore] "Anwenden" not found')
    await wait(250)

    let text = txt(window)
    console.log(`\n=== Restore (Papierkorb sichtbar) ===\n  ${text.slice(0, 170)}`)
    if (!text.includes('Papierkorb Aufgabe'))
      errors.push('[Restore] the deleted task is not shown while the filter is on')
    // The dead star is gone from the deleted row and a real action took its slot.
    const restoreBtn = window.document.querySelector('[aria-label="Aufgabe wiederherstellen"]')
    if (!restoreBtn)
      errors.push('[Restore] the deleted row offers no way back')
    if (!restoreBtn?.className.includes('press-fade'))
      errors.push('[Restore] the restore control has no press feedback (G2)')

    restoreBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(200)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`=== Restore (nach Wiederherstellen) ===\n  ${text.slice(0, 200)}`)
    if (!text.includes('Aufgabe wiederhergestellt'))
      errors.push('[Restore] toast "Aufgabe wiederhergestellt" not shown')
    // Plain toast: nothing was lost, so it must not carry an undo action.
    if (text.includes('Rückgängig'))
      errors.push('[Restore] the restore toast carries an undo action it should not')
    if (!text.includes('Papierkorb Aufgabe'))
      errors.push('[Restore] the task vanished instead of becoming active')
    if (window.document.querySelector('[aria-label="Aufgabe wiederherstellen"]'))
      errors.push('[Restore] the row still offers a restore after being restored')
    if (!window.document.querySelector('[aria-label="Als erledigt markieren"]'))
      errors.push('[Restore] the restored row is not a normal, completable task')
    // sort_order 1 between 0 and 2 — it must land back between its neighbours.
    const order = ['Erste Aufgabe', 'Papierkorb Aufgabe', 'Letzte Aufgabe'].map((t) => text.indexOf(t))
    if (order.some((i) => i < 0) || order[0] > order[1] || order[1] > order[2])
      errors.push(`[Restore] the row did not return to its sort_order position (${order.join()})`)
  }

  // 2f) Restore from the Papierkorb — the detail half (G17). The screen used
  //     to offer "Löschen" for a task that was already deleted; it must offer
  //     the way back instead, and turn back into an ordinary detail view once
  //     the task is active again (without navigating away).
  {
    const now = new Date().toISOString()
    const task = {
      id: 'seed-trash', user_id: TEST_USER_ID, title: 'Gelöschte Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: true,
      completed_at: null, deleted_at: now, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben/seed-trash', { tasks: [task] })
    mount(window, code, 'TrashDetail')
    await wait(250)

    let text = txt(window)
    console.log(`\n=== TrashDetail (gelöschte Aufgabe) ===\n  ${text.slice(0, 200)}`)
    if (!text.includes('Gelöschte Aufgabe'))
      errors.push('[TrashDetail] the deleted task does not render its detail view')
    if (text.includes('Löschen'))
      errors.push('[TrashDetail] "Löschen" is still offered for an already deleted task')
    if (!text.includes('Wiederherstellen'))
      errors.push('[TrashDetail] no "Wiederherstellen" action offered')
    // The screen has to say why it looks different (§21).
    if (!text.includes('Gelöscht am'))
      errors.push('[TrashDetail] the screen does not say the task is in the Papierkorb')
    // Editing sits behind the restore: the info rows must not open the form.
    if (text.includes('Bearbeiten'))
      errors.push('[TrashDetail] "Bearbeiten" is offered for a task in the Papierkorb')

    if (!click(window, (el) => el.textContent.trim().includes('Wiederherstellen')))
      errors.push('[TrashDetail] "Wiederherstellen" not clickable')
    await wait(200)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`=== TrashDetail (nach Wiederherstellen) ===\n  ${text.slice(0, 200)}`)
    if (!text.includes('Aufgabe wiederhergestellt'))
      errors.push('[TrashDetail] toast "Aufgabe wiederhergestellt" not shown')
    // It stays on the detail screen — the task is simply active now.
    if (!text.includes('Gelöschte Aufgabe'))
      errors.push('[TrashDetail] the detail view was left after restoring')
    if (!text.includes('Löschen') || !text.includes('Bearbeiten'))
      errors.push('[TrashDetail] the restored task does not get its normal actions back')
    if (text.includes('Wiederherstellen'))
      errors.push('[TrashDetail] "Wiederherstellen" is still offered after the restore')
    if (text.includes('Gelöscht am'))
      errors.push('[TrashDetail] the Papierkorb status line survived the restore')
  }

  // 3) Open the Neue Aufgabe form via the Plus button → mounts the calendar.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'Form')
    await wait(250)
    if (!click(window, (el) => el.getAttribute('aria-label') === 'Neu erstellen'))
      errors.push('[Form] Plus button not found')
    await wait(120)
    if (!click(window, (el) => el.textContent.trim() === 'Neue Aufgabe'))
      errors.push('[Form] "Neue Aufgabe" action not found')
    await wait(150)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Form (Neue Aufgabe) ===\n  ${text.slice(0, 170)}`)
    const hasTitle = !!window.document.querySelector('input[placeholder="Titel der Aufgabe"]')
    if (!hasTitle) errors.push('[Form] title input not rendered')
    for (const needle of ['Kategorie', 'Fällig', 'Mo', 'KW']) {
      if (!text.includes(needle)) errors.push(`[Form] missing "${needle}"`)
    }
  }

  // 4) Calendar module: mount the day view, then switch Tag → Woche → Monat so
  //    all three render paths (overlap layout, multi-day bars, month grid) run.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'Kalender')
    await wait(300)
    let text = txt(window)
    console.log(`\n=== Kalender/Tag ===\n  ${text.slice(0, 170)}`)
    for (const needle of ['Tag', 'Woche', 'Monat', 'Aufgaben (']) {
      if (!text.includes(needle)) errors.push(`[Kalender] Tag missing "${needle}"`)
    }
    if (!click(window, (el) => el.textContent.trim() === 'Woche'))
      errors.push('[Kalender] "Woche" switch not found')
    await wait(150)
    text = txt(window)
    if (!text.includes('KW')) errors.push('[Kalender] Woche missing "KW"')
    if (!click(window, (el) => el.textContent.trim() === 'Monat'))
      errors.push('[Kalender] "Monat" switch not found')
    await wait(150)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`\n=== Kalender/Monat ===\n  ${text.slice(0, 170)}`)
    if (!text.includes('Mo')) errors.push('[Kalender] Monat weekday header missing')
  }

  // 5) Neuer Termin form: open it via the Plus action sheet and check the key
  //    fields render (title input, Terminart, Zeit block, Wiederholen/Erinnerung).
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'EventForm')
    await wait(300)
    if (!click(window, (el) => el.getAttribute('aria-label') === 'Neu erstellen'))
      errors.push('[EventForm] Plus button not found')
    await wait(120)
    if (!click(window, (el) => el.textContent.trim() === 'Neuer Termin'))
      errors.push('[EventForm] "Neuer Termin" action not found')
    await wait(150)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== EventForm (Neuer Termin) ===\n  ${text.slice(0, 170)}`)
    if (!window.document.querySelector('input[placeholder="Titel des Termins"]'))
      errors.push('[EventForm] title input not rendered')
    for (const needle of ['Terminart', 'Geburtstag', 'Ganztägig', 'Start', 'Ende', 'Wiederholen', 'Erinnerung']) {
      if (!text.includes(needle)) errors.push(`[EventForm] missing "${needle}"`)
    }
  }

  // 5b) The Google integration in the running app. Three properties, in the
  //     order they matter:
  //
  //       a) without a connection the Termin-Dialog is exactly the dialog it
  //          has always been — no calendar row, no sync switch;
  //       b) with one, both appear at the *foot* of the same sheet, with the
  //          configured default calendar already chosen;
  //       c) the settings screen shows the account, the calendars and their
  //          rights, and never asks the database for a token.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'EventFormNoGoogle')
    await wait(300)
    click(window, (el) => el.getAttribute('aria-label') === 'Neu erstellen')
    await wait(120)
    click(window, (el) => el.textContent.trim() === 'Neuer Termin')
    await wait(200)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== EventForm ohne Google ===\n  ${text.slice(0, 120)}`)
    if (text.includes('Mit Google Kalender synchronisieren'))
      errors.push('[EventFormNoGoogle] the sync switch showed without a connection')
    // The dialog itself is untouched.
    for (const needle of ['Terminart', 'Ganztägig', 'Wiederholen', 'Erinnerung']) {
      if (!text.includes(needle)) errors.push(`[EventFormNoGoogle] missing "${needle}"`)
    }
  }

  const GOOGLE_SEED = {
    googleConnections: [{ default_calendar_id: 'privat@gmail.com' }],
    googleCalendars: [
      { google_calendar_id: 'privat@gmail.com', summary: 'Privat', is_primary: true, access_role: 'owner', background_color: '#4a80ff', is_selected: true },
      { google_calendar_id: 'familie@group.calendar.google.com', summary: 'Familie', access_role: 'writer', background_color: '#0b8043', is_selected: true },
      { google_calendar_id: 'de.german#holiday@group.v.calendar.google.com', summary: 'Feiertage in Deutschland', access_role: 'reader', kind: 'holiday', background_color: '#616161', is_selected: true },
      { google_calendar_id: 'addressbook#contacts@group.v.calendar.google.com', summary: 'Geburtstage', access_role: 'reader', kind: 'birthday', background_color: '#e67c73', is_selected: true },
    ],
  }

  {
    const window = makeDom('#/kalender', GOOGLE_SEED)
    mount(window, code, 'EventFormGoogle')
    await wait(350)
    click(window, (el) => el.getAttribute('aria-label') === 'Neu erstellen')
    await wait(120)
    click(window, (el) => el.textContent.trim() === 'Neuer Termin')
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== EventForm mit Google ===\n  ${text.slice(-170)}`)
    if (!text.includes('Mit Google Kalender synchronisieren'))
      errors.push('[EventFormGoogle] the sync switch is missing')
    if (!text.includes('Kalender'))
      errors.push('[EventFormGoogle] the calendar row is missing')
    // The default calendar is pre-selected, so creating a Termin needs no
    // extra decision.
    if (!text.includes('Privat'))
      errors.push('[EventFormGoogle] the default calendar is not pre-selected')
    // The switch defaults to on.
    const sync = [...window.document.querySelectorAll('[role="switch"]')].pop()
    if (sync?.getAttribute('aria-checked') !== 'true')
      errors.push('[EventFormGoogle] the sync switch does not default to on')

    // And the calendar picker offers only the calendars that can actually
    // take a new event: not the holidays, not the birthdays.
    if (!click(window, (el) => el.textContent.includes('Kalender') && el.textContent.includes('Privat')))
      errors.push('[EventFormGoogle] the calendar row does not open')
    await wait(150)
    const opened = txt(window)
    if (!opened.includes('Familie'))
      errors.push('[EventFormGoogle] a writable calendar is missing from the picker')
    if (opened.includes('Feiertage in Deutschland'))
      errors.push('[EventFormGoogle] a read-only holiday calendar was offered as a target')
    if (opened.includes('Geburtstage'))
      errors.push('[EventFormGoogle] the birthday calendar was offered as a target')
  }

  {
    const window = makeDom('#/profil/google-kalender', GOOGLE_SEED)
    mount(window, code, 'ProfilGoogle')
    await wait(400)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Profil/Google Kalender ===\n  ${text.slice(0, 220)}`)
    for (const needle of [
      'julian@example.test',
      'Verbunden',
      'Jetzt synchronisieren',
      'Kalenderliste neu laden',
      'Standardkalender für neue Termine',
      'Synchronisierte Kalender',
      'Verbindung trennen',
    ]) {
      if (!text.includes(needle)) errors.push(`[ProfilGoogle] missing "${needle}"`)
    }
    // Google's own rights, shown as Google reports them.
    if (!text.includes('Nur lesen'))
      errors.push('[ProfilGoogle] a read-only calendar is not marked as read-only')
    if (!text.includes('über Google Kontakte'))
      errors.push('[ProfilGoogle] the birthday calendar does not say where it is edited')

    // The security property this whole feature rests on: the browser never
    // asks for the token table, because it has no right to it.
    const paths = window.__backend.calls.map((c) => c.path)
    if (paths.some((p) => p.includes('google_credentials')))
      errors.push('[ProfilGoogle] the client requested the credentials table')
    if (paths.some((p) => p.includes('google_channels')))
      errors.push('[ProfilGoogle] the client requested the push-channel table')
    // And every write goes through the Edge Function, never straight to a table.
    const writes = window.__backend.calls.filter(
      (c) => c.method !== 'GET' && /google_(connections|calendars)/.test(c.path)
    )
    if (writes.length) errors.push('[ProfilGoogle] the client wrote to a Google table directly')
  }

  {
    // Disconnecting: one confirmation, and it goes through the function.
    const window = makeDom('#/profil/google-kalender', GOOGLE_SEED)
    mount(window, code, 'ProfilGoogleTrennen')
    await wait(400)
    if (!click(window, (el) => el.textContent.trim() === 'Verbindung trennen'))
      errors.push('[ProfilGoogleTrennen] the disconnect button is missing')
    await wait(200)
    let text = txt(window)
    // The dialog has to say that nothing is deleted — that is the promise.
    if (!text.includes('bleiben in dieser App erhalten'))
      errors.push('[ProfilGoogleTrennen] the confirmation does not say the events are kept')
    if (!click(window, (el) => el.textContent.trim() === 'Trennen'))
      errors.push('[ProfilGoogleTrennen] the confirm button is missing')
    await wait(300)
    window.__restoreConsole?.()
    const called = window.__backend.functionCalls.find((c) => c.action === 'disconnect')
    console.log(`\n=== Profil/Google trennen ===\n  Funktionsaufrufe=${window.__backend.functionCalls.map((c) => c.action).join(',')}`)
    if (!called) errors.push('[ProfilGoogleTrennen] disconnect did not reach the Edge Function')
  }

  {
    // Profil itself: the shape of the screen, and the way into the integration.
    const window = makeDom('#/profil', GOOGLE_SEED)
    mount(window, code, 'Profil')
    await wait(350)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Profil ===\n  ${text.slice(0, 200)}`)
    for (const needle of ['Persönliche Daten', 'Integrationen', 'Google Kalender', 'Konto', 'Abmelden']) {
      if (!text.includes(needle)) errors.push(`[Profil] missing "${needle}"`)
    }
  }

  // 6) Event detail: tap a seeded multi-day event in the day view and confirm
  //    the read-only sheet with the task-identical actions renders.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'EventDetail')
    await wait(300)
    if (!click(window, (el) => el.textContent.trim() === 'Familientreffen'))
      errors.push('[EventDetail] event bar "Familientreffen" not found')
    await wait(150)
    window.__restoreConsole?.()
    let text = txt(window)
    console.log(`\n=== EventDetail ===\n  ${text.slice(0, 170)}`)
    for (const needle of ['Datum', 'Wiederholung', 'Erinnerung', 'Bearbeiten', 'Löschen']) {
      if (!text.includes(needle)) errors.push(`[EventDetail] missing "${needle}"`)
    }

    // Deleting a Termin is permanent — no Papierkorb, no undo — so this one
    // keeps its confirmation (G8 deliberately stops at reversible actions).
    if (!click(window, (el) => el.textContent.trim() === 'Löschen'))
      errors.push('[EventDetail] "Löschen" button not clickable')
    await wait(150)
    text = txt(window)
    if (!text.includes('Termin löschen?'))
      errors.push('[EventDetail] the confirm dialog for a permanent delete is gone')
  }

  // 7) Calendar search: open it, confirm the empty hint, type a query that only
  //    matches a non-today seed event ("Zahnarzt"), then open that hit → detail.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'Search')
    await wait(300)
    if (!click(window, (el) => el.getAttribute('aria-label') === 'Suche'))
      errors.push('[Search] Suche button not found')
    await wait(120)
    let text = txt(window)
    if (!text.includes('Suche in Titel, Ort und Notizen'))
      errors.push('[Search] empty-state hint not rendered')
    if (!typeInto(window, 'input[placeholder="Termine durchsuchen"]', 'Zahnarzt'))
      errors.push('[Search] search input not found')
    await wait(150)
    text = txt(window)
    console.log(`\n=== Search (Zahnarzt) ===\n  ${text.slice(0, 170)}`)
    if (!text.includes('Zahnarzt')) errors.push('[Search] result "Zahnarzt" not rendered')
    if (!click(window, (el) => el.textContent.includes('Zahnarzt')))
      errors.push('[Search] result row not clickable')
    await wait(150)
    window.__restoreConsole?.()
    text = txt(window)
    for (const needle of ['Zahnarzt', 'Praxis', 'Bearbeiten', 'Löschen']) {
      if (!text.includes(needle)) errors.push(`[Search] opened detail missing "${needle}"`)
    }
  }

  // 8) Focus scope (G13) and scroll lock (G14). Both live in <Overlay>, so one
  //    sheet is enough to prove the mechanism — what the individual overlays
  //    then need is that they go through <Overlay>, which section 1-7 cover.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'Overlay')
    await wait(250)
    const doc = window.document

    if (locked(window)) errors.push('[Overlay] the page is locked with no overlay open')

    // Open the action sheet from the Plus button, with the focus really on it —
    // that is the element the sheet has to hand the focus back to.
    const plus = [...doc.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === 'Neu erstellen'
    )
    if (!plus) errors.push('[Overlay] Plus button not found')
    plus?.focus()
    plus?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(150)

    const root = doc.querySelector('.ov-root')
    if (!root) errors.push('[Overlay] no overlay root rendered')
    if (!root?.contains(doc.activeElement))
      errors.push('[Overlay] opening the sheet did not move the focus into it')
    if (!locked(window)) errors.push('[Overlay] the page was not locked behind the open sheet')

    // The dialog names itself after the title it already draws.
    const panel = doc.querySelector('[role="dialog"][aria-modal="true"]')
    const labelledBy = panel?.getAttribute('aria-labelledby')
    if (!labelledBy || doc.getElementById(labelledBy)?.textContent.trim() !== 'Erstellen')
      errors.push('[Overlay] the sheet is not labelled by its own title')

    // Tab wraps at the edges and is left alone in between.
    const items = focusables(window, root)
    if (items.length < 2) errors.push('[Overlay] the sheet has too few controls to trap')
    items[items.length - 1]?.focus()
    let e = press(window, 'Tab')
    if (!e.defaultPrevented || doc.activeElement !== items[0])
      errors.push('[Overlay] Tab off the last control did not wrap into the sheet')
    e = press(window, 'Tab', { shiftKey: true })
    if (!e.defaultPrevented || doc.activeElement !== items[items.length - 1])
      errors.push('[Overlay] Shift+Tab off the first control did not wrap into the sheet')
    items[0]?.focus()
    e = press(window, 'Tab')
    if (e.defaultPrevented)
      errors.push('[Overlay] Tab inside the sheet was intercepted instead of left to the browser')

    // A focus that escaped the scope is pulled back in.
    plus?.focus()
    press(window, 'Tab')
    if (!root.contains(doc.activeElement))
      errors.push('[Overlay] Tab did not pull an escaped focus back into the sheet')

    console.log(`\n=== Overlay (Fokus + Scroll Lock) ===\n  focus=${doc.activeElement?.textContent?.trim().slice(0, 24)} locked=${locked(window)} controls=${items.length}`)

    // Escape closes it, the page unlocks and the focus goes back to the Plus.
    press(window, 'Escape')
    // The exit has no `transitionend` to ride in jsdom, so it always falls back
    // to its timer: 300ms of nominal duration plus FALLBACK_SLACK, then a React
    // commit. 450ms used to clear that by 30ms, which is not a margin — it is a
    // coin flip that came up heads while the app was smaller. Give the whole
    // budget room to run rather than tuning it again next time a provider is
    // added.
    await wait(800)
    if (doc.querySelector('.ov-root'))
      errors.push('[Overlay] Escape did not close the sheet')
    if (locked(window)) errors.push('[Overlay] the page stayed locked after the sheet closed')
    if (doc.activeElement !== plus)
      errors.push('[Overlay] closing did not hand the focus back to the trigger')
  }

  // 8b) Nesting: a ConfirmDialog opened from a sheet is a DOM *descendant* of
  //     that sheet, which is why the trap asks the stack who is on top instead
  //     of making the background inert. Escape must reach the dialog only, and
  //     the lock is held twice and released twice.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'Nested')
    await wait(300)
    const doc = window.document

    if (!click(window, (el) => el.textContent.trim() === 'Familientreffen'))
      errors.push('[Nested] event bar not found')
    await wait(200)
    if (!locked(window)) errors.push('[Nested] the page was not locked behind the sheet')
    const sheetRoot = doc.querySelector('.ov-root')
    if (!sheetRoot?.contains(doc.activeElement))
      errors.push('[Nested] the sheet did not take the focus')

    if (!click(window, (el) => el.textContent.trim() === 'Löschen'))
      errors.push('[Nested] "Löschen" not clickable')
    await wait(200)
    const dialogRoot = doc.querySelector('.ov-root .ov-root')
    if (!dialogRoot)
      errors.push('[Nested] the confirm dialog does not render inside the sheet')
    if (!dialogRoot?.contains(doc.activeElement))
      errors.push('[Nested] the dialog did not take the focus from the sheet')

    // The trap follows the top of the stack, not the DOM nesting: Tab stays in
    // the dialog even though the sheet around it is full of controls.
    const dialogItems = focusables(window, dialogRoot)
    dialogItems[dialogItems.length - 1]?.focus()
    press(window, 'Tab')
    if (!dialogRoot?.contains(doc.activeElement))
      errors.push('[Nested] Tab left the dialog for the sheet underneath it')

    // One Escape closes the dialog only — the sheet behind it stays.
    press(window, 'Escape')
    await wait(350)
    if (doc.querySelector('.ov-root .ov-root'))
      errors.push('[Nested] the dialog did not close on Escape')
    if (!doc.querySelector('.ov-root'))
      errors.push('[Nested] the same Escape closed the sheet underneath as well')
    if (!locked(window))
      errors.push('[Nested] the page unlocked although the sheet is still open')
    if (!doc.querySelector('.ov-root')?.contains(doc.activeElement))
      errors.push('[Nested] the focus did not return to the sheet under the dialog')

    console.log(`\n=== Nested (Sheet + ConfirmDialog) ===\n  dialog closed, sheet open=${!!doc.querySelector('.ov-root')} locked=${locked(window)}`)

    // And the second Escape closes the sheet, releasing the last lock.
    press(window, 'Escape')
    await wait(450)
    window.__restoreConsole?.()
    if (doc.querySelector('.ov-root')) errors.push('[Nested] the sheet did not close')
    if (locked(window)) errors.push('[Nested] the lock was not fully released')
  }

  // 8c) The calendar search shares the presence lifecycle but is not a modal —
  //     it covers the calendar instead of dimming it, and G13/G14 must leave it
  //     exactly as it was.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'NonModal')
    await wait(300)
    const doc = window.document

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Suche'))
      errors.push('[NonModal] Suche button not found')
    await wait(200)
    if (!doc.querySelector('input[placeholder="Termine durchsuchen"]'))
      errors.push('[NonModal] the search overlay did not open')
    if (locked(window))
      errors.push('[NonModal] the search overlay locked the page although it is not modal')
    if (doc.querySelector('.ov-root'))
      errors.push('[NonModal] the search overlay rendered an overlay root')

    // Its own autofocus still holds the focus, and Tab is not trapped.
    if (doc.activeElement !== doc.querySelector('input[placeholder="Termine durchsuchen"]'))
      errors.push('[NonModal] the search field lost its autofocus')
    const e = press(window, 'Tab')
    if (e.defaultPrevented) errors.push('[NonModal] Tab was trapped in the search overlay')

    console.log(`\n=== NonModal (Kalendersuche) ===\n  locked=${locked(window)} ov-root=${!!doc.querySelector('.ov-root')} tab trapped=${e.defaultPrevented}`)

    // The scrolling surfaces the lock must not touch are still scroll containers.
    window.__restoreConsole?.()
    if (!doc.querySelector('.overflow-y-auto'))
      errors.push('[NonModal] the calendar lost its own scroll container')
  }

  // 8d) The sheet's own body and the sidebar's nav keep scrolling — the lock is
  //     on the document scroller only.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'Scrollers')
    await wait(250)
    const doc = window.document

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Filter'))
      errors.push('[Scrollers] Filter button not found')
    await wait(200)
    const body = doc.querySelector('.ov-root [role="dialog"] > .overflow-y-auto')
    if (!body) errors.push('[Scrollers] the sheet body is no longer a scroll container')
    if (!body?.className.includes('overscroll-contain'))
      errors.push('[Scrollers] the sheet body lost its overscroll containment')
    press(window, 'Escape')
    await wait(450)

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Menü öffnen'))
      errors.push('[Scrollers] Menü button not found')
    await wait(200)
    const aside = doc.querySelector('aside[role="dialog"]')
    if (!aside) errors.push('[Scrollers] the sidebar is not announced as a dialog')
    if (aside?.getAttribute('aria-modal') !== 'true')
      errors.push('[Scrollers] the sidebar is not announced as modal')
    if (!aside?.getAttribute('aria-label'))
      errors.push('[Scrollers] the sidebar has no accessible name')
    if (!aside?.querySelector('nav.overflow-y-auto'))
      errors.push('[Scrollers] the sidebar nav is no longer a scroll container')
    console.log(`\n=== Scrollers (Sheet-Body + Sidebar-Nav) ===\n  sheet body=${!!body} sidebar dialog=${!!aside} nav scrollable=${!!aside?.querySelector('nav.overflow-y-auto')}`)
    window.__restoreConsole?.()
  }

  // 8e) The handoff G13 has to get right: EventDetailSheet → "Bearbeiten"
  //     closes the sheet and opens the EventForm in the same breath. The
  //     leaving sheet must not take the focus back off the form that has just
  //     taken it — that would land on a calendar entry behind two overlays.
  {
    const window = makeDom('#/kalender')
    mount(window, code, 'Handoff')
    await wait(300)
    const doc = window.document

    const bar = [...doc.querySelectorAll('button, [role="button"]')].find(
      (el) => el.textContent.trim() === 'Familientreffen'
    )
    if (!bar) errors.push('[Handoff] event bar not found')
    bar?.focus()
    bar?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(200)

    if (!click(window, (el) => el.textContent.trim() === 'Bearbeiten'))
      errors.push('[Handoff] "Bearbeiten" not clickable')
    // Past the sheet's 300ms exit, so the closing sheet has had its say.
    await wait(500)
    window.__restoreConsole?.()

    const form = doc.querySelector('input[placeholder="Titel des Termins"]')
    if (!form) errors.push('[Handoff] the edit form did not open')
    const roots = [...doc.querySelectorAll('.ov-root')]
    if (roots.length !== 1)
      errors.push(`[Handoff] expected exactly one overlay after the handoff, got ${roots.length}`)
    if (!roots[0]?.contains(doc.activeElement))
      errors.push('[Handoff] the focus is not in the form that took over')
    if (doc.activeElement === bar)
      errors.push('[Handoff] the closing sheet pulled the focus back onto the calendar')
    if (!locked(window)) errors.push('[Handoff] the page unlocked during the handoff')
    console.log(`\n=== Handoff (EventDetail → EventForm) ===\n  overlays=${roots.length} focus in form=${!!roots[0]?.contains(doc.activeElement)} locked=${locked(window)}`)
  }

  // 8f) Closing by hand (G5): drag-to-dismiss ends on the same onClose as the
  //     backdrop and Escape, so the focus has to come back the same way.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'DragClose')
    await wait(250)
    const doc = window.document

    const plus = [...doc.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === 'Neu erstellen'
    )
    plus?.focus()
    plus?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(200)

    const panel = doc.querySelector('.ov-panel-sheet')
    const handle = doc.querySelector('.ov-sheet-handle')
    if (!handle) errors.push('[DragClose] the sheet has no drag handle')
    // jsdom lays nothing out, so the sheet needs a height for the dismiss
    // threshold (a share of it) to mean anything.
    if (panel) panel.getBoundingClientRect = () => ({ height: 200, width: 390, top: 0, left: 0, right: 390, bottom: 200, x: 0, y: 0 })
    const pointer = (type, clientY) =>
      handle?.dispatchEvent(new window.PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0,
        pointerType: 'touch', clientX: 100, clientY,
      }))
    pointer('pointerdown', 0)
    pointer('pointermove', 20) // past the 8px slop — the drag engages
    pointer('pointermove', 120) // well past a quarter of the sheet's height
    pointer('pointerup', 120)
    await wait(500)
    window.__restoreConsole?.()

    if (doc.querySelector('.ov-root'))
      errors.push('[DragClose] the sheet was not dismissed by the drag')
    if (locked(window)) errors.push('[DragClose] the page stayed locked after a drag dismiss')
    if (doc.activeElement !== plus)
      errors.push('[DragClose] a drag dismiss did not hand the focus back to the trigger')
    console.log(`\n=== DragClose (G5 + Fokusrückgabe) ===\n  closed=${!doc.querySelector('.ov-root')} locked=${locked(window)} focus back=${doc.activeElement === plus}`)
  }

  // 8g) G4's exiting-to-open edge: reopening a sheet that is still sliding out
  //     keeps the same element and never remounts, so the lock must be held
  //     exactly once throughout — and released exactly once at the end.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'Reopen')
    await wait(250)
    const doc = window.document
    const plus = [...doc.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === 'Neu erstellen'
    )

    plus?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(200)
    press(window, 'Escape')
    await wait(100) // mid-exit, the panel is still on screen
    if (!locked(window)) errors.push('[Reopen] the page unlocked while the sheet was still leaving')
    plus?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(300)
    if (!doc.querySelector('.ov-root')) errors.push('[Reopen] the sheet did not come back')
    if (!locked(window)) errors.push('[Reopen] the reopened sheet lost the lock')

    press(window, 'Escape')
    await wait(500)
    window.__restoreConsole?.()
    if (doc.querySelector('.ov-root')) errors.push('[Reopen] the sheet did not close again')
    if (locked(window))
      errors.push('[Reopen] the lock was taken twice and released once — the page stays locked')
    console.log(`\n=== Reopen (Öffnen während exiting) ===\n  closed=${!doc.querySelector('.ov-root')} locked=${locked(window)}`)
  }

  // 9) The actionable toast joins the focus scope of whichever overlay is on
  //    top (G21). ToastHost renders at z-[60], outside every .ov-root, so the
  //    undo used to be hittable by pointer and unreachable by Tab. These cases
  //    seed one completable task, raise the real toast through the real flow,
  //    and then open real overlays over it.
  const seedTask = (extra = {}) => {
    const now = new Date().toISOString()
    return {
      id: 'seed-done', user_id: TEST_USER_ID, title: 'Erledigbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now, ...extra,
    }
  }
  const seedStore = (extra) => ({ tasks: [seedTask(extra)] })

  // 9a) A sheet opened while the undo is still on screen. The toast stays, it
  //     becomes the last Tab stop, both seam crossings work, the middle of the
  //     panel is still the browser's, and the pointer path is untouched.
  {
    const window = makeDom('#/aufgaben', seedStore())
    mount(window, code, 'ToastScope')
    await wait(250)
    const doc = window.document

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren'))
      errors.push('[ToastScope] the completion circle was not found')
    await wait(150)
    if (!undoButton(window)) errors.push('[ToastScope] the undo toast was not raised')

    // Open a sheet over the live toast — the flow the old note called
    // unreachable, because it only looked at where a toast is *raised*.
    const filter = [...doc.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === 'Filter'
    )
    filter?.focus()
    filter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(200)

    const root = doc.querySelector('.ov-root')
    if (!root) errors.push('[ToastScope] the filter sheet did not open')
    const undo = undoButton(window)
    if (!undo) errors.push('[ToastScope] the toast did not survive the sheet opening')
    if (root?.contains(undo)) errors.push('[ToastScope] the toast is inside the overlay root — the test proves nothing')
    if (!root?.contains(doc.activeElement))
      errors.push('[ToastScope] opening the sheet did not take the focus into it')

    const items = focusables(window, root)
    const scope = scopeOf(window, root)
    if (scope[scope.length - 1] !== undo)
      errors.push('[ToastScope] the toast is not the last stop of the scope')

    // Forward across the seam: the panel's last control → the toast.
    items[items.length - 1]?.focus()
    let e = press(window, 'Tab')
    if (!e.defaultPrevented || doc.activeElement !== undo)
      errors.push('[ToastScope] Tab off the last sheet control did not reach the toast')

    // Off the toast: wrap to the front of the panel.
    e = press(window, 'Tab')
    if (!e.defaultPrevented || doc.activeElement !== items[0])
      errors.push('[ToastScope] Tab off the toast did not wrap into the sheet')

    // Backwards around the front edge lands on the toast.
    items[0]?.focus()
    e = press(window, 'Tab', { shiftKey: true })
    if (!e.defaultPrevented || doc.activeElement !== undo)
      errors.push('[ToastScope] Shift+Tab off the first sheet control did not reach the toast')

    // ...and back across the seam the other way.
    e = press(window, 'Tab', { shiftKey: true })
    if (!e.defaultPrevented || doc.activeElement !== items[items.length - 1])
      errors.push('[ToastScope] Shift+Tab off the toast did not cross back into the sheet')

    // G13's own rule is untouched: the middle of the panel is still the
    // browser's, toast or no toast.
    if (items.length > 2) {
      items[0]?.focus()
      e = press(window, 'Tab')
      if (e.defaultPrevented)
        errors.push('[ToastScope] Tab inside the sheet was intercepted although it is not a seam')
    }

    // Entering from outside must land in the panel, never on the toast — the
    // one walk that tells "toast last" from "toast first" apart.
    filter?.focus()
    press(window, 'Tab')
    if (doc.activeElement === undo)
      errors.push('[ToastScope] a focus pulled in from outside landed on the toast instead of the sheet')
    if (!root?.contains(doc.activeElement))
      errors.push('[ToastScope] Tab did not pull an escaped focus back into the sheet')

    console.log(`\n=== ToastScope (Sheet + Undo-Toast) ===\n  sheet controls=${items.length} scope=${scope.length} toast last=${scope[scope.length - 1] === undo}`)

    // Escape belongs to the sheet, not to the toast — even with the toast
    // holding the focus.
    undo?.focus()
    press(window, 'Escape')
    await wait(450)
    if (doc.querySelector('.ov-root'))
      errors.push('[ToastScope] Escape did not close the sheet')
    if (!undoButton(window))
      errors.push('[ToastScope] Escape closed the toast instead of leaving it alone')
  }

  // 9b) Pointer regression (G21 must change nothing here): the undo still
  //     works by click while a sheet is open, and the plain follow-up toast it
  //     raises must not become a Tab stop.
  {
    const window = makeDom('#/aufgaben', seedStore())
    mount(window, code, 'ToastPointer')
    await wait(250)
    const doc = window.document

    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(150)
    click(window, (el) => el.getAttribute('aria-label') === 'Filter')
    await wait(200)
    const root = doc.querySelector('.ov-root')
    if (!root) errors.push('[ToastPointer] the filter sheet did not open')

    if (!click(window, (el) => el.textContent.trim() === 'Rückgängig'))
      errors.push('[ToastPointer] the undo was not clickable over an open sheet')
    await wait(200)
    window.__restoreConsole?.()
    const text = txt(window)
    if (!text.includes('Erledigbare Aufgabe'))
      errors.push('[ToastPointer] the pointer undo did not bring the task back')
    if (!text.includes('Aufgabe wieder offen'))
      errors.push('[ToastPointer] the follow-up toast did not win over the dismiss')
    if (!doc.querySelector('.ov-root'))
      errors.push('[ToastPointer] using the undo closed the sheet')

    // The follow-up carries no action, so it contributes nothing to the scope.
    const after = scopeOf(window, doc.querySelector('.ov-root'))
    const panelOnly = focusables(window, doc.querySelector('.ov-root'))
    if (after.length !== panelOnly.length)
      errors.push('[ToastPointer] a toast without an action joined the focus scope')
    console.log(`\n=== ToastPointer (Maus über offenem Sheet) ===\n  undo worked=${text.includes('Erledigbare Aufgabe')} plain toast in scope=${after.length !== panelOnly.length}`)
  }

  // 9c) Nesting (G21 × G13): with a ConfirmDialog over a sheet the toast has to
  //     belong to the *dialog's* scope, and go back to the sheet's when the
  //     dialog closes. The sheet's own controls stay unreachable throughout.
  {
    const today = new Date().toISOString().slice(0, 10)
    const window = makeDom('#/kalender', seedStore({ due_date: today }))
    mount(window, code, 'ToastNested')
    await wait(300)
    const doc = window.document

    if (!click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren'))
      errors.push('[ToastNested] no completable task in the day view')
    await wait(150)
    if (!undoButton(window)) errors.push('[ToastNested] the undo toast was not raised')

    if (!click(window, (el) => el.textContent.trim() === 'Familientreffen'))
      errors.push('[ToastNested] event bar not found')
    await wait(200)
    if (!click(window, (el) => el.textContent.trim() === 'Löschen'))
      errors.push('[ToastNested] "Löschen" not clickable')
    await wait(250)

    const sheetRoot = doc.querySelector('.ov-root')
    const dialogRoot = doc.querySelector('.ov-root .ov-root')
    if (!dialogRoot) errors.push('[ToastNested] the confirm dialog did not open')
    const undo = undoButton(window)
    if (!undo) errors.push('[ToastNested] the toast did not survive two overlays')

    const dialogItems = focusables(window, dialogRoot)
    const sheetOnly = focusables(window, sheetRoot).filter((el) => !dialogRoot?.contains(el))

    // Walk the whole ring from the dialog's last control and record where it
    // goes: dialog controls and the toast only, never the sheet underneath.
    dialogItems[dialogItems.length - 1]?.focus()
    const visited = []
    for (let i = 0; i < dialogItems.length + 2; i++) {
      press(window, 'Tab')
      visited.push(doc.activeElement)
    }
    if (!visited.includes(undo))
      errors.push('[ToastNested] the toast is not part of the dialog scope')
    if (visited.some((el) => sheetOnly.includes(el)))
      errors.push('[ToastNested] Tab reached the sheet underneath the dialog')

    // Escape takes the dialog and leaves the toast standing.
    press(window, 'Escape')
    await wait(350)
    if (doc.querySelector('.ov-root .ov-root'))
      errors.push('[ToastNested] Escape did not close the dialog')
    if (!doc.querySelector('.ov-root'))
      errors.push('[ToastNested] the same Escape closed the sheet as well')
    if (!undoButton(window))
      errors.push('[ToastNested] Escape closed the toast instead of the dialog')

    // ...and the toast is the sheet's last stop again, with no re-registration.
    const backItems = focusables(window, doc.querySelector('.ov-root'))
    backItems[backItems.length - 1]?.focus()
    const e = press(window, 'Tab')
    if (!e.defaultPrevented || doc.activeElement !== undoButton(window))
      errors.push('[ToastNested] the toast did not fall back to the sheet scope')
    console.log(`\n=== ToastNested (Sheet + ConfirmDialog + Toast) ===\n  dialog stops=${dialogItems.length} toast in dialog scope=${visited.includes(undo)} back to sheet=${doc.activeElement === undoButton(window)}`)
    window.__restoreConsole?.()
  }

  // 9d) The toast can run out while it holds the focus. The browser drops that
  //     focus on <body> — inside an open modal, the state G13 exists to
  //     prevent — so the active surface takes it back at once, not at the next
  //     Tab. TOAST_ACTION_MS is 5000, so this waits the real timer out rather
  //     than faking one.
  {
    const window = makeDom('#/aufgaben', seedStore())
    mount(window, code, 'ToastExpiry')
    await wait(250)
    const doc = window.document

    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(150)
    click(window, (el) => el.getAttribute('aria-label') === 'Filter')
    await wait(200)
    const root = doc.querySelector('.ov-root')
    const undo = undoButton(window)
    undo?.focus()
    if (doc.activeElement !== undo) errors.push('[ToastExpiry] the undo could not take the focus')

    await wait(5400) // past TOAST_ACTION_MS from when the toast was raised
    if (undoButton(window)) errors.push('[ToastExpiry] the toast outlived its timer')
    if (doc.activeElement === doc.body || !doc.activeElement)
      errors.push('[ToastExpiry] the focus fell to <body> when the toast expired')
    if (!root?.contains(doc.activeElement))
      errors.push('[ToastExpiry] the focus did not come back into the open sheet')

    // Both global keys work immediately afterwards, with no Tab needed first.
    const items = focusables(window, root)
    items[items.length - 1]?.focus()
    const e = press(window, 'Tab')
    if (!e.defaultPrevented || doc.activeElement !== items[0])
      errors.push('[ToastExpiry] the trap did not go back to the panel-only ring')
    console.log(`\n=== ToastExpiry (Toast läuft bei Fokus ab) ===\n  focus in sheet=${root?.contains(doc.activeElement)} body=${doc.activeElement === doc.body}`)

    press(window, 'Escape')
    await wait(450)
    window.__restoreConsole?.()
    if (doc.querySelector('.ov-root')) errors.push('[ToastExpiry] Escape stopped working after the expiry')
  }

  // 9e) The other direction: the overlay closes while the toast holds the
  //     focus. G13's shouldRestore must keep its answer — something else has
  //     the focus, so the leaving sheet does not pull it back to its trigger.
  {
    const window = makeDom('#/aufgaben', seedStore())
    mount(window, code, 'ToastRestore')
    await wait(250)
    const doc = window.document

    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(150)
    const filter = [...doc.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === 'Filter'
    )
    filter?.focus()
    filter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(200)

    const undo = undoButton(window)
    undo?.focus()
    press(window, 'Escape')
    await wait(450)
    window.__restoreConsole?.()
    if (doc.querySelector('.ov-root')) errors.push('[ToastRestore] the sheet did not close')
    if (doc.activeElement === filter)
      errors.push('[ToastRestore] the closing sheet pulled the focus off the toast onto its trigger')
    if (doc.activeElement !== undo)
      errors.push('[ToastRestore] the toast lost the focus it held across the close')
    console.log(`\n=== ToastRestore (Overlay schließt bei Toast-Fokus) ===\n  focus stayed on the toast=${doc.activeElement === undo}`)
  }

  // 9f) A non-modal presence must be left exactly as it was: the calendar
  //     search has no trap, so a live toast may not create one.
  {
    const today = new Date().toISOString().slice(0, 10)
    const window = makeDom('#/kalender', seedStore({ due_date: today }))
    mount(window, code, 'ToastNonModal')
    await wait(300)
    const doc = window.document

    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(150)
    if (!undoButton(window)) errors.push('[ToastNonModal] the undo toast was not raised')

    click(window, (el) => el.getAttribute('aria-label') === 'Suche')
    await wait(200)
    window.__restoreConsole?.()
    if (!doc.querySelector('input[placeholder="Termine durchsuchen"]'))
      errors.push('[ToastNonModal] the search overlay did not open')
    if (locked(window)) errors.push('[ToastNonModal] the toast made a non-modal surface lock the page')
    const e = press(window, 'Tab')
    if (e.defaultPrevented)
      errors.push('[ToastNonModal] the toast created a focus trap on a non-modal surface')
    console.log(`\n=== ToastNonModal (Kalendersuche + Toast) ===\n  trapped=${e.defaultPrevented} locked=${locked(window)}`)
  }

  // 9g) The toast leaves instead of blinking away (G18), and stops being a Tab
  //     stop the moment it starts leaving. Both halves in one window, because
  //     the second only exists while the first is on screen: the card is still
  //     in the DOM, playing `toast-out`, and must already be out of the scope
  //     G21 built for it — otherwise Tab lands on a control that is about to
  //     disappear under the finger.
  //
  //     Polled rather than timed. The exit is 180ms wide and starts 5s after
  //     the toast was raised; hitting that window with a single wait would be
  //     a coin toss, so the loop watches for it and asserts inside it.
  {
    const window = makeDom('#/aufgaben', seedStore())
    mount(window, code, 'ToastExit')
    await wait(250)
    const doc = window.document
    const card = () => doc.querySelector('[role="status"] [class*="animate-toast"]')

    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(150)
    if (!card()?.className.includes('animate-toast-in'))
      errors.push('[ToastExit] the toast did not enter with animate-toast-in')

    click(window, (el) => el.getAttribute('aria-label') === 'Filter')
    await wait(200)
    const root = doc.querySelector('.ov-root')
    if (!root) errors.push('[ToastExit] the filter sheet did not open')
    const items = focusables(window, root ?? doc.body)

    let sawExit = false
    let inertWhileLeaving = false
    let wrappedIntoPanel = false
    let focusReachedLeavingToast = false
    for (let i = 0; i < 300 && !sawExit; i++) {
      await wait(20)
      const el = card()
      if (!el?.className.includes('animate-toast-out')) continue
      sawExit = true
      inertWhileLeaving = el.hasAttribute('inert')
      // The ring Tab actually walks, asked of the real trap: from the panel's
      // last control it has to wrap to the front, not cross the seam into a
      // card that is leaving.
      items[items.length - 1]?.focus()
      const e = press(window, 'Tab')
      wrappedIntoPanel = e.defaultPrevented && doc.activeElement === items[0]
      focusReachedLeavingToast = doc.activeElement === undoButton(window)
    }

    await wait(300)
    window.__restoreConsole?.()
    if (!sawExit)
      errors.push('[ToastExit] the toast was dropped without playing an exit')
    if (!inertWhileLeaving)
      errors.push('[ToastExit] the leaving toast was not inert')
    if (!wrappedIntoPanel || focusReachedLeavingToast)
      errors.push('[ToastExit] the leaving toast was still a Tab stop')
    if (card()) errors.push('[ToastExit] the toast never left the DOM after its exit')
    if (!doc.querySelector('.ov-root'))
      errors.push('[ToastExit] the toast expiry took the sheet with it')
    console.log(`\n=== ToastExit (Toast verlässt den Bildschirm) ===\n  exit played=${sawExit} inert=${inertWhileLeaving} out of the scope=${wrappedIntoPanel && !focusReachedLeavingToast} removed=${!card()}`)
  }

  // 9h) The replacement is untouched by the exit (G18 × G8): the undo raises a
  //     follow-up while the dismissed toast is still leaving, and that
  //     follow-up must be the live, entering one — not a card on its way out.
  {
    const window = makeDom('#/aufgaben', seedStore())
    mount(window, code, 'ToastReplace')
    await wait(250)
    const doc = window.document
    const card = () => doc.querySelector('[role="status"] [class*="animate-toast"]')

    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(150)
    if (!click(window, (el) => el.textContent.trim() === 'Rückgängig'))
      errors.push('[ToastReplace] the undo was not clickable')
    await wait(60)
    window.__restoreConsole?.()
    const text = txt(window)
    if (!text.includes('Aufgabe wieder offen'))
      errors.push('[ToastReplace] the follow-up toast did not win over the dismiss')
    if (text.includes('Rückgängig'))
      errors.push('[ToastReplace] the dismissed toast is still on screen behind the follow-up')
    if (!card()?.className.includes('animate-toast-in'))
      errors.push('[ToastReplace] the replacing toast did not remount into its entry')
    if (card()?.hasAttribute('inert'))
      errors.push('[ToastReplace] the replacing toast inherited the exit of the one it replaced')
    console.log(`\n=== ToastReplace (Folge-Toast während des Exits) ===\n  entering=${card()?.className.includes('animate-toast-in')} text=${text.includes('Aufgabe wieder offen')}`)
  }

  // 10) The task-detail menu (G15). It grows out of the button it hangs from
  //     and leaves the same way instead of vanishing, Escape closes it with the
  //     focus handed back to that button, and the tap-outside path it always
  //     had is untouched. Deliberately no overlay: the menu must never become
  //     the topmost surface, or it would take Escape from a sheet underneath.
  {
    const window = makeDom('#/aufgaben/seed-done', seedStore())
    mount(window, code, 'Menu')
    await wait(250)
    const doc = window.document
    const panel = () => doc.querySelector('[class*="animate-menu"]')
    const trigger = () =>
      [...doc.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Mehr')
    const catcher = () => doc.querySelector('header div.fixed.inset-0')
    const tap = (el) =>
      el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))

    if (!trigger()) errors.push('[Menu] the overflow trigger was not found')
    trigger()?.focus()
    tap(trigger())
    await wait(30)
    if (!panel()?.className.includes('animate-menu-in'))
      errors.push('[Menu] the menu did not enter with animate-menu-in')
    if (!panel()?.className.includes('origin-top-right'))
      errors.push('[Menu] the menu does not grow out of its trigger')
    if (trigger()?.getAttribute('aria-expanded') !== 'true')
      errors.push('[Menu] the trigger does not report the open menu')
    if (!catcher()) errors.push('[Menu] the tap-outside catcher is missing while the menu is open')

    // Escape from inside the menu: it leaves, stops being a control while it
    // does, and the focus is back on the trigger at once — not on <body>.
    ;[...(panel()?.querySelectorAll('button') ?? [])][0]?.focus()
    press(window, 'Escape')
    await wait(20)
    const leaving = panel()
    if (!leaving?.className.includes('animate-menu-out'))
      errors.push('[Menu] Escape dropped the menu without an exit')
    if (!leaving?.hasAttribute('inert'))
      errors.push('[Menu] the leaving menu was not inert')
    if (doc.activeElement !== trigger())
      errors.push('[Menu] Escape did not hand the focus back to the trigger')
    if (catcher())
      errors.push('[Menu] the tap-outside catcher outlived the open menu')
    await wait(250)
    if (panel()) errors.push('[Menu] the menu never left the DOM after its exit')
    if (trigger()?.getAttribute('aria-expanded') !== 'false')
      errors.push('[Menu] the trigger still reports an open menu')

    // The tap-outside path is exactly what it was: it closes the menu.
    tap(trigger())
    await wait(30)
    tap(catcher())
    await wait(250)
    if (panel()) errors.push('[Menu] a tap outside no longer closes the menu')

    // Re-opening mid-exit continues instead of being closed by the exit that
    // was already running (§7).
    tap(trigger())
    await wait(30)
    press(window, 'Escape')
    await wait(40)
    tap(trigger())
    await wait(200)
    window.__restoreConsole?.()
    if (!panel()?.className.includes('animate-menu-in'))
      errors.push('[Menu] re-opening during the exit was swallowed by it')
    console.log(`\n=== Menu (TaskDetail-Popover) ===\n  enter=${!!panel()} escape+focus back=${doc.activeElement === trigger() || !!panel()} reopen=${!!panel()}`)
  }

  // 11) The Heute screen. Everything below is behaviour the pure tests in
  //     tools/homeLogic.mjs cannot see: that the screen mounts its two live
  //     cards, that each list scrolls in its own box rather than lengthening
  //     the page, that the scope switch moves only the task list, that a task
  //     can be completed from here with the way back the rest of the app
  //     offers, and that an event opens the same detail sheet the calendar
  //     opens. jsdom does no layout, so what is checked is the structure the
  //     scrolling follows from — the measured behaviour is verified in a
  //     browser, not here.
  {
    const window = makeDom('#/')
    mount(window, code, 'Heute')
    await wait(300)
    const doc = window.document
    const card = (id) => doc.querySelector(`[data-home-card="${id}"]`)
    const scroller = (id) => card(id)?.querySelector('.overscroll-contain')
    const rows = (sel) => [...doc.querySelectorAll(sel)]
    const circles = () =>
      rows('button').filter((el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    const taskTitles = () =>
      circles().map((el) => el.parentElement?.nextElementSibling?.textContent?.trim())

    // ── the lead: greeting, date, quote ──────────────────────────────────
    const text = txt(window)
    const greeting = ['Guten Morgen', 'Guten Tag', 'Guten Abend'].find((g) => text.includes(g))
    if (!greeting) errors.push('[Heute] no time-of-day greeting was rendered')
    const quoteEl = doc.querySelector('.line-clamp-2')
    if (!quoteEl) errors.push('[Heute] the motivation line is not clamped to two lines')
    const quote = quoteEl?.textContent.trim() || ''
    if (quote.length < 20) errors.push('[Heute] the motivation line is empty')

    // ── two cards, two independent scroll boxes ──────────────────────────
    if (!card('agenda')) errors.push('[Heute] the Termine card is missing')
    if (!card('tasks')) errors.push('[Heute] the Aufgaben card is missing')
    if (!text.includes('Termine heute')) errors.push('[Heute] the Termine heading is missing')
    for (const id of ['agenda', 'tasks']) {
      const box = scroller(id)
      if (!box) {
        errors.push(`[Heute] the ${id} list is not a scroll box of its own`)
        continue
      }
      // A height budget, or the card grows with the data and the page with it.
      if (!/max-height/.test(box.getAttribute('style') || ''))
        errors.push(`[Heute] the ${id} list has no height budget`)
      // Its own box: the scroll must not chain into the page behind it.
      if (!box.className.includes('overflow-y-auto'))
        errors.push(`[Heute] the ${id} list does not scroll`)
    }
    const a = scroller('agenda')
    const t = scroller('tasks')
    if (a && t && (a.contains(t) || t.contains(a)))
      errors.push('[Heute] the two lists share one scroll container')

    // ── the agenda is the whole day, not a preview ───────────────────────
    // The local seed puts two all-day bars and six timed events on today.
    const agendaRows = rows('[data-agenda-row]').length
    if (agendaRows < 8)
      errors.push(`[Heute] the agenda shows ${agendaRows} of the seeded day's 8 events`)
    if (!text.includes(`${agendaRows} Termine`))
      errors.push('[Heute] the Termine count does not match the rows in the list')
    // The list opens on the part of the day that is still ahead — unless the
    // whole day is over, in which case there is nothing to open on.
    const nextRows = rows('[data-agenda-next]').length
    if (nextRows > 1) errors.push('[Heute] more than one agenda row is marked as the next one')

    // ── the scope switch moves the task list and nothing else ────────────
    const scopeButton = (label) =>
      [...(card('tasks')?.querySelectorAll('button') || [])].find(
        (el) => el.textContent.trim() === label
      )
    if (scopeButton('Heute')?.getAttribute('aria-pressed') !== 'true')
      errors.push('[Heute] the task scope does not start on Heute')
    const today = taskTitles()
    scopeButton('Diese Woche')?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await wait(60)
    const week = taskTitles()
    if (scopeButton('Diese Woche')?.getAttribute('aria-pressed') !== 'true')
      errors.push('[Heute] the switch does not report the selected scope')
    if (week.length < today.length)
      errors.push('[Heute] Diese Woche shows fewer tasks than Heute')
    for (const title of today) {
      if (!week.includes(title))
        errors.push(`[Heute] "${title}" disappeared when the scope was widened`)
    }
    if (rows('[data-agenda-row]').length !== agendaRows)
      errors.push('[Heute] switching the task scope changed the agenda')
    scopeButton('Heute')?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await wait(60)
    if (taskTitles().join() !== today.join())
      errors.push('[Heute] switching back did not restore the Heute list')

    // ── completing a task from here, with the way back ───────────────────
    const before = taskTitles()
    circles()[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(150)
    const after = taskTitles()
    if (after.length !== before.length - 1)
      errors.push('[Heute] completing a task did not take its row off the screen')
    if (!undoButton(window))
      errors.push('[Heute] completing a task from Heute offers no undo')
    undoButton(window)?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await wait(150)
    if (taskTitles().length !== before.length)
      errors.push('[Heute] the undo did not bring the task back')

    // ── an event opens the app's own detail sheet ────────────────────────
    rows('[data-agenda-row]')[0]?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await wait(300)
    window.__restoreConsole?.()
    if (!doc.querySelector('.ov-root'))
      errors.push('[Heute] tapping an event did not open the detail sheet')
    console.log(
      `\n=== Heute (Startseite) ===\n  greeting=${greeting} agenda=${agendaRows} heute=${today.length} woche=${week.length} sheet=${!!doc.querySelector('.ov-root')}`
    )
  }

  // 11b) The quote is a function of the calendar day: leaving the screen and
  //      coming back — a remount, which is what a reload is here — must show
  //      the same line, not a fresh draw.
  {
    const readQuote = async (hash) => {
      const window = makeDom(hash)
      mount(window, code, 'HeuteQuote')
      await wait(250)
      window.__restoreConsole?.()
      return window.document.querySelector('.line-clamp-2')?.textContent.trim() || ''
    }
    const first = await readQuote('#/')
    const second = await readQuote('#/')
    if (!first) errors.push('[HeuteQuote] no quote was rendered')
    if (first !== second)
      errors.push(`[HeuteQuote] a reload changed the quote: "${first}" → "${second}"`)
    console.log(`\n=== HeuteQuote (stabil über einen Reload) ===\n  stable=${first === second}`)
  }

  // ── 12) The data foundation ───────────────────────────────────────────────
  //
  // Everything below is about where personal data lives. These are the checks
  // that would have caught the old behaviour, where the app looked healthy on
  // every device precisely because each device had its own database.

  // 12a) No backend configured → the app says so and stores nothing. It used
  //      to open a private localStorage database here instead, which is the
  //      whole reason two devices never agreed on anything.
  {
    const unconfigured = await bundle({ configured: false })
    const window = makeDom('#/', {}, { signedIn: false })
    // Any request at all would already be wrong — there is no project to ask.
    window.fetch = () => {
      errors.push('[NoBackend] the app made a request although nothing is configured')
      return Promise.reject(new Error('no backend'))
    }
    mount(window, unconfigured, 'NoBackend')
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== NoBackend (ohne Konfiguration) ===\n  ${text.slice(0, 120)}`)
    for (const needle of ['Keine Datenbank verbunden', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      if (!text.includes(needle)) errors.push(`[NoBackend] missing "${needle}"`)
    }
    if (window.document.querySelector('[data-topbar]') || text.includes('Willkommen zurück'))
      errors.push('[NoBackend] the app rendered its screens without a backend')
    const keys = Object.keys(window.localStorage)
    if (keys.length) errors.push(`[NoBackend] wrote to localStorage: ${keys.join(', ')}`)
  }

  // 12b) Configured but no session → login, and not one row is requested.
  {
    const window = makeDom('#/aufgaben', {}, { signedIn: false })
    mount(window, code, 'SignedOut')
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    const restCalls = window.__backend.calls.filter((c) => c.path.startsWith('/rest/v1/'))
    console.log(`\n=== SignedOut (angemeldet: nein) ===\n  rest=${restCalls.length} :: ${text.slice(0, 90)}`)
    if (!text.includes('Anmelden')) errors.push('[SignedOut] no login screen')
    if (text.includes('Überfällig')) errors.push('[SignedOut] task data was rendered without a session')
    if (restCalls.length)
      errors.push(`[SignedOut] ${restCalls.length} data request(s) were made without a session`)
  }

  // 12c) Session restoration: a stored session must survive a reload without
  //      a login screen flashing in between.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'Session')
    await wait(60)
    const early = txt(window)
    if (early.includes('Willkommen zurück'))
      errors.push('[Session] the login screen flashed although a session was stored')
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    const reads = window.__backend.calls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/tasks')
    console.log(`\n=== Session (Wiederherstellung) ===\n  reads=${reads.length} :: ${text.slice(0, 90)}`)
    if (!text.includes('Überfällig')) errors.push('[Session] the restored session shows no tasks')
    if (!reads.length) errors.push('[Session] the task list was not read from the database')
    if (!reads.some((c) => c.search.includes(`user_id=eq.${TEST_USER_ID}`)))
      errors.push('[Session] the read was not scoped to the signed-in user')
  }

  // 12d) Login: the wrong password says so, the right one gets in.
  {
    const window = makeDom('#/', {}, { signedIn: false })
    mount(window, code, 'Login')
    await wait(250)

    typeInto(window, 'input[type="email"]', TEST_EMAIL)
    typeInto(window, 'input[type="password"]', 'falsches-passwort')
    await wait(30)
    click(window, (el) => el.textContent.trim() === 'Anmelden')
    await wait(200)
    let text = txt(window)
    if (!text.includes('E-Mail oder Passwort stimmt nicht.'))
      errors.push('[Login] a wrong password produced no readable error')
    if (text.includes('Heute')) errors.push('[Login] a wrong password got into the app')

    typeInto(window, 'input[type="password"]', TEST_PASSWORD)
    await wait(30)
    click(window, (el) => el.textContent.trim() === 'Anmelden')
    await wait(400)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`\n=== Login ===\n  ${text.slice(0, 110)}`)
    if (!text.includes('Heute')) errors.push('[Login] the correct password did not get into the app')
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) errors.push('[Login] no session was persisted, so a reload would sign the user out')
  }

  // 12e) Password reset: the mail is requested, and the screen never reveals
  //      whether that address has an account.
  {
    const window = makeDom('#/', {}, { signedIn: false })
    mount(window, code, 'Reset')
    await wait(250)
    click(window, (el) => el.textContent.trim() === 'Passwort vergessen?')
    await wait(80)
    typeInto(window, 'input[type="email"]', 'wer-auch-immer@example.com')
    await wait(30)
    click(window, (el) => el.textContent.trim() === 'Link senden')
    await wait(200)
    window.__restoreConsole?.()
    const text = txt(window)
    const asked = window.__backend.auth.recoverEmails
    console.log(`\n=== Reset (Passwort vergessen) ===\n  recover=${asked.length} :: ${text.slice(0, 110)}`)
    if (!asked.includes('wer-auch-immer@example.com'))
      errors.push('[Reset] no reset mail was requested')
    if (!text.includes('Wenn es zu dieser Adresse ein Konto gibt'))
      errors.push('[Reset] no confirmation was shown')
  }

  // 12f) Coming back from the reset mail: set a new password, then straight
  //      into the app — no second login.
  {
    const window = makeDom('#/', {}, { search: '?recovery=1' })
    mount(window, code, 'Recovery')
    await wait(300)
    let text = txt(window)
    if (!text.includes('Neues Passwort'))
      errors.push('[Recovery] ?recovery=1 did not lead to the new-password screen')
    if (text.includes('Aufgaben'))
      errors.push('[Recovery] the app was reachable before the password was set')

    const fields = [...window.document.querySelectorAll('input[type="password"]')]
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    for (const field of fields) {
      setter.call(field, 'neues-sicheres-passwort')
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
    }
    await wait(30)
    click(window, (el) => el.textContent.trim() === 'Passwort speichern')
    await wait(300)
    window.__restoreConsole?.()
    text = txt(window)
    console.log(`\n=== Recovery (neues Passwort) ===\n  gesetzt=${window.__backend.auth.newPasswords.length} :: ${text.slice(0, 90)}`)
    if (!window.__backend.auth.newPasswords.includes('neues-sicheres-passwort'))
      errors.push('[Recovery] the new password was never sent')
    if (!text.includes('Heute')) errors.push('[Recovery] setting a password did not continue into the app')
  }

  // 12g) Logout: from the sidebar, ends the session and the screen behind it.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'Logout')
    await wait(300)
    click(window, (el) => el.getAttribute('aria-label') === 'Menü öffnen')
    await wait(200)
    if (!click(window, (el) => el.textContent.trim() === 'Abmelden'))
      errors.push('[Logout] no "Abmelden" in the sidebar')
    await wait(300)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Logout ===\n  signedOut=${window.__backend.auth.signedOut} :: ${text.slice(0, 90)}`)
    if (!window.__backend.auth.signedOut) errors.push('[Logout] the session was not ended server-side')
    if (!text.includes('Willkommen zurück')) errors.push('[Logout] the login screen did not come back')
    if (text.includes('Überfällig')) errors.push('[Logout] task data was still on screen after signing out')
  }

  // 12h) A write goes to the database, and a second device sees it. This is
  //      the whole point of the change: the row outlives this browser.
  {
    const window = makeDom('#/aufgaben', { tasks: [] })
    mount(window, code, 'Write')
    await wait(300)
    if (!click(window, (el) => el.getAttribute('aria-label') === 'Neu erstellen'))
      errors.push('[Write] the plus button was not found')
    await wait(200)
    if (!click(window, (el) => el.textContent.trim() === 'Neue Aufgabe'))
      errors.push('[Write] the action sheet has no "Neue Aufgabe"')
    await wait(250)
    if (!typeInto(window, 'input[placeholder="Titel der Aufgabe"]', 'Auf allen Geräten'))
      errors.push('[Write] the title field was not found')
    await wait(30)
    if (!click(window, (el) => el.textContent.trim() === 'Erstellen'))
      errors.push('[Write] "Erstellen" was not found')
    await wait(300)
    window.__restoreConsole?.()

    const stored = window.__backend.tables.tasks
    console.log(`\n=== Write (Gerät A schreibt) ===\n  rows=${stored.length} :: ${stored[0]?.title}`)
    if (stored.length !== 1 || stored[0].title !== 'Auf allen Geräten')
      errors.push('[Write] the new task did not reach the database')
    if (stored[0] && stored[0].user_id !== TEST_USER_ID)
      errors.push('[Write] the stored row does not belong to the signed-in user')

    // Device B: a different browser, same database.
    const deviceB = makeDom('#/aufgaben', {}, { backend: window.__backend, hub: window.__hub })
    mount(deviceB, code, 'Read')
    await wait(300)
    deviceB.__restoreConsole?.()
    const text = txt(deviceB)
    console.log(`=== Read (Gerät B liest) ===\n  ${text.slice(0, 110)}`)
    if (!text.includes('Auf allen Geräten'))
      errors.push('[Read] the second device does not see what the first one wrote')
  }

  // 12i) A database that cannot be reached is said out loud, not swallowed
  //      into an empty screen.
  {
    const window = makeDom('#/aufgaben', { failTable: 'tasks' })
    mount(window, code, 'Down', { expectErrors: true })
    await wait(400)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== Down (Datenbank antwortet 500) ===\n  ${text.slice(0, 130)}`)
    if (!text.includes('konnten nicht geladen werden') && !text.includes('Keine Internetverbindung'))
      errors.push('[Down] a failing database produced no visible error')
    const keys = Object.keys(window.localStorage).filter((k) => k !== STORAGE_KEY)
    if (keys.length)
      errors.push(`[Down] the app fell back to local storage: ${keys.join(', ')}`)
  }

  // 12j) The standing guarantee, checked on a window that did real work: the
  //      only thing this app is allowed to keep in the browser is the session.
  {
    const window = makeDom('#/aufgaben')
    mount(window, code, 'NoLocalData')
    await wait(300)
    click(window, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(200)
    window.__restoreConsole?.()
    const keys = Object.keys(window.localStorage)
    console.log(`\n=== NoLocalData (localStorage nach Nutzung) ===\n  keys=${JSON.stringify(keys)}`)
    const strays = keys.filter((k) => k !== STORAGE_KEY)
    if (strays.length)
      errors.push(`[NoLocalData] personal data was written to the browser: ${strays.join(', ')}`)
  }

  // 13) Echtzeit-Synchronisation zwischen Geräten.
  //
  //     The point of the feature, and the only way to test it honestly: two
  //     windows are two devices on one account, sharing one stubbed database
  //     and one Realtime hub. A write in one window travels the whole way —
  //     PostgREST, the stub's change notification, the websocket frame,
  //     @supabase/realtime-js, our subscription, the context, the screen — and
  //     has to show up in the other without anybody reloading anything.
  {
    const hub = makeRealtimeHub()
    const backend = makeBackend({
      tasks: [], events: [], password: TEST_PASSWORD, onChange: hub.emit,
    })
    // What goes on the wire: @supabase/realtime-js prefixes every channel name
    // with `realtime:`, so this is `channelTopic()` from src/lib/realtimeSync.js
    // as the server sees it.
    const tasksTopic = `realtime:sync:tasks:${TEST_USER_ID}`
    const eventsTopic = `realtime:sync:events:${TEST_USER_ID}`
    const reads = (table) =>
      backend.calls.filter((c) => c.method === 'GET' && c.path === `/rest/v1/${table}`).length

    // A change made by another device: the plain PostgREST request a second
    // browser would send. The stub reports it exactly like Postgres does.
    const otherDevice = async (method, table, search = '', body = null) => {
      const res = await backend.fetch(`${SUPABASE_URL}/rest/v1/${table}${search}`, {
        method,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${backend.session.access_token}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      return res.json()
    }

    const deviceA = makeDom('#/aufgaben', {}, { backend, hub })
    mount(deviceA, code, 'RealtimeA')
    await wait(300)
    const socketA = hub.sockets[hub.sockets.length - 1]

    const deviceB = makeDom('#/aufgaben', {}, { backend, hub })
    mount(deviceB, code, 'RealtimeB')
    await wait(300)
    const socketB = hub.sockets[hub.sockets.length - 1]

    const deviceC = makeDom('#/kalender', {}, { backend, hub })
    mount(deviceC, code, 'RealtimeC')
    await wait(300)

    // 13a) Subscriptions: one channel per table per device, created once — not
    //      once per render, which is the failure mode that quietly opens a
    //      dozen sockets.
    const topics = hub.joinedTopics()
    const joinedTasks = topics.filter((t) => t === tasksTopic).length
    const joinedEvents = topics.filter((t) => t === eventsTopic).length
    console.log(`\n=== Realtime (Abonnements) ===\n  sockets=${hub.openSockets().length} tasks=${joinedTasks} events=${joinedEvents} joins=${hub.joinCount(tasksTopic)}`)
    if (hub.openSockets().length !== 3)
      errors.push(`[Realtime] expected one socket per device, got ${hub.openSockets().length}`)
    if (joinedTasks !== 3 || joinedEvents !== 3)
      errors.push(`[Realtime] expected one channel per table per device, got tasks=${joinedTasks} events=${joinedEvents}`)
    if (hub.joinCount(tasksTopic) !== 3)
      errors.push(`[Realtime] the tasks channel was joined ${hub.joinCount(tasksTopic)}× — a re-subscribe on every render`)

    // 13b) Create on device A, through the real UI. Device B must show it, and
    //      must not have re-read the table to do so.
    const readsBefore = reads('tasks')
    click(deviceA, (el) => el.getAttribute('aria-label') === 'Neu erstellen')
    await wait(200)
    click(deviceA, (el) => el.textContent.trim() === 'Neue Aufgabe')
    await wait(250)
    if (!typeInto(deviceA, 'input[placeholder="Titel der Aufgabe"]', 'Vom Handy erstellt'))
      errors.push('[Realtime] the title field was not found on device A')
    await wait(30)
    click(deviceA, (el) => el.textContent.trim() === 'Erstellen')
    await wait(350)
    console.log(`=== Realtime (Create) ===\n  B: ${txt(deviceB).slice(0, 90)}`)
    if (!txt(deviceB).includes('Vom Handy erstellt'))
      errors.push('[Realtime] a task created on device A never reached device B')
    if (reads('tasks') !== readsBefore)
      errors.push('[Realtime] the change triggered a full reload instead of a single-row update')

    const created = backend.tables.tasks[0]

    // 13c) Completing on A removes the row from B's active list.
    click(deviceA, (el) => el.getAttribute('aria-label') === 'Als erledigt markieren')
    await wait(350)
    console.log(`=== Realtime (Erledigt) ===\n  B: ${txt(deviceB).slice(0, 90)}`)
    if (txt(deviceB).includes('Vom Handy erstellt'))
      errors.push('[Realtime] completing on device A did not update device B')

    // 13d) An edit from a third device reaches both open ones.
    await otherDevice('PATCH', 'tasks', `?id=eq.${created.id}`, {
      title: 'Umbenannt', is_completed: false, completed_at: null,
    })
    await wait(300)
    console.log(`=== Realtime (Update) ===\n  A: ${txt(deviceA).slice(0, 70)}\n  B: ${txt(deviceB).slice(0, 70)}`)
    if (!txt(deviceA).includes('Umbenannt') || !txt(deviceB).includes('Umbenannt'))
      errors.push('[Realtime] an edit made elsewhere did not reach both open devices')

    // 13e) The Papierkorb is a soft delete — an update, and it must hide the row.
    await otherDevice('PATCH', 'tasks', `?id=eq.${created.id}`, {
      is_deleted: true, deleted_at: new Date().toISOString(),
    })
    await wait(300)
    if (txt(deviceB).includes('Umbenannt'))
      errors.push('[Realtime] a task moved to the Papierkorb elsewhere stayed visible')

    // 13f) A real delete removes the row for good.
    await otherDevice('DELETE', 'tasks', `?id=eq.${created.id}`)
    await wait(300)
    console.log(`=== Realtime (Delete) ===\n  A: ${txt(deviceA).slice(0, 70)}`)
    if (backend.tables.tasks.length !== 0)
      errors.push('[Realtime] the delete did not reach the database')

    // 13g) Events: create, update and delete, seen by the open calendar.
    const today = new Date().toISOString().slice(0, 10)
    const [event] = await otherDevice('POST', 'events', '', {
      user_id: TEST_USER_ID,
      title: 'Zahnarzt',
      start_at: `${today}T09:00`,
      end_at: `${today}T10:00`,
    })
    await wait(300)
    console.log(`=== Realtime (Termin) ===\n  C: ${txt(deviceC).slice(0, 90)}`)
    if (!txt(deviceC).includes('Zahnarzt'))
      errors.push('[Realtime] an event created elsewhere never reached the open calendar')

    await otherDevice('PATCH', 'events', `?id=eq.${event.id}`, { title: 'Arzttermin' })
    await wait(300)
    if (!txt(deviceC).includes('Arzttermin'))
      errors.push('[Realtime] an edited event did not update the open calendar')

    await otherDevice('DELETE', 'events', `?id=eq.${event.id}`)
    await wait(300)
    if (txt(deviceC).includes('Arzttermin'))
      errors.push('[Realtime] a deleted event stayed on the open calendar')

    // 13h) Nothing of another account, ever. The insert is dropped by the
    //      server-side filter; the delete that follows cannot be filtered by
    //      Supabase at all and is dropped by the client, which is the guard
    //      that matters (see src/lib/realtimeSync.js).
    const OTHER_USER = '99999999-8888-4777-8666-555555555555'
    const [foreign] = await otherDevice('POST', 'tasks', '', {
      user_id: OTHER_USER, title: 'Fremde Aufgabe', sort_order: 1,
    })
    await otherDevice('POST', 'tasks', '', {
      user_id: TEST_USER_ID, title: 'Eigene Aufgabe', sort_order: 2,
    })
    await wait(300)
    console.log(`=== Realtime (fremde Daten) ===\n  A: ${txt(deviceA).slice(0, 90)}`)
    if (txt(deviceA).includes('Fremde Aufgabe'))
      errors.push('[Realtime] another user’s row became visible over Realtime')
    if (!txt(deviceA).includes('Eigene Aufgabe'))
      errors.push('[Realtime] our own row did not arrive alongside it')

    await otherDevice('DELETE', 'tasks', `?id=eq.${foreign.id}`)
    await wait(250)
    if (!txt(deviceA).includes('Eigene Aufgabe'))
      errors.push('[Realtime] a foreign delete removed one of our own rows')

    // 13i) Reconnect: the socket drops, changes happen unheard, and the
    //      rejoin has to restore a consistent list — without a skeleton and
    //      without the user doing anything.
    socketB.close(1006, 'test: connection lost')
    await wait(50)
    await otherDevice('POST', 'tasks', '', {
      user_id: TEST_USER_ID, title: 'Waehrend der Funkstille', sort_order: 3,
    })
    await wait(200)
    const missedIt = !txt(deviceB).includes('Waehrend der Funkstille')
    if (!missedIt)
      errors.push('[Realtime] device B was supposed to be disconnected but still heard the change')
    if (!txt(deviceA).includes('Waehrend der Funkstille'))
      errors.push('[Realtime] device A missed a change while device B was offline')
    // @supabase/realtime-js reconnects after ~1s; the second SUBSCRIBED is what
    // triggers the catch-up read.
    await wait(1800)
    console.log(`=== Realtime (Reconnect) ===\n  B offline gemerkt=${missedIt} :: ${txt(deviceB).slice(0, 90)}`)
    if (!txt(deviceB).includes('Waehrend der Funkstille'))
      errors.push('[Realtime] device B did not catch up after reconnecting')
    if (hub.joinedTopics().filter((t) => t === tasksTopic).length !== 3)
      errors.push('[Realtime] device B did not rejoin its channel after reconnecting')
    if (!socketA.channels.size)
      errors.push('[Realtime] device A lost its channels while device B reconnected')

    deviceA.__restoreConsole?.()
    deviceB.__restoreConsole?.()
    deviceC.__restoreConsole?.()
  }

  // 13j) Signing out unmounts the providers — and must take the subscriptions
  //      with them. A channel that outlives its provider is a leak that also
  //      keeps writing into dead state.
  {
    const hub = makeRealtimeHub()
    const window = makeDom('#/aufgaben', {}, { hub })
    mount(window, code, 'RealtimeUnmount')
    await wait(300)
    const before = hub.joinedTopics().length
    click(window, (el) => el.getAttribute('aria-label') === 'Menü öffnen')
    await wait(200)
    if (!click(window, (el) => el.textContent.trim() === 'Abmelden'))
      errors.push('[RealtimeUnmount] no "Abmelden" in the sidebar')
    await wait(400)
    window.__restoreConsole?.()
    const after = hub.joinedTopics().length
    console.log(`\n=== Realtime (Abmelden) ===\n  Kanäle vorher=${before} nachher=${after}`)
    // tasks, events, google_connections, google_calendars — one channel per
    // live table. The number is asserted rather than "> 0" because a table
    // that quietly stops being live is exactly the bug this section exists for.
    if (before !== 4)
      errors.push(`[RealtimeUnmount] expected four channels while signed in, got ${before}`)
    if (after !== 0)
      errors.push(`[RealtimeUnmount] ${after} channel(s) survived the sign-out`)
  }

  console.log('\n--- result ---')
  if (errors.length) {
    console.log('FAILURES:')
    for (const e of errors) console.log('  -', e)
    process.exit(1)
  }
  console.log('OK: all routes + detail + form mounted and rendered without errors.')
  // Mounted components keep timers alive (e.g. the calendar's live clock), which
  // would otherwise stop node from exiting — finish deterministically.
  process.exit(0)
}

run().catch((e) => {
  console.error('smoke harness error:', e)
  process.exit(1)
})
