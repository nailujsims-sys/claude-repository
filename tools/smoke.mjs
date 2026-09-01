// Runtime smoke test: bundle the app with esbuild and mount it in jsdom so we
// actually execute React (catching crash-on-mount / bad-hook / import errors
// that a production build alone won't surface). No network or browser needed.
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { webcrypto } from 'node:crypto'

async function bundle() {
  const result = await build({
    entryPoints: ['src/main.jsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: {
      'import.meta.env': '{"MODE":"test","DEV":false,"PROD":true}',
      'process.env.NODE_ENV': '"production"',
    },
    write: false,
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

function makeDom(hash, storage) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="root"></div></body></html>`,
    { url: `http://localhost/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' }
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
  if (storage) {
    for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v)
  }
  return window
}

const errors = []
function mount(window, code, name) {
  window.addEventListener('error', (e) => errors.push(`[${name}] ${e.message}`))
  const orig = console.error
  console.error = (...a) => errors.push(`[${name}] console.error: ${a.join(' ').slice(0, 200)}`)
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
      id: 'seed-1', user_id: 'local-julian', title: 'Testaufgabe Detail',
      category: 'Uni', subcategory: 'Test', details: 'Ein Detailtext.',
      due_date: mondayIso, due_time: null, due_type: 'week',
      is_favorite: true, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0, created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben/seed-1', {
      'mw.tasks.local-julian': JSON.stringify([task]),
    })
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
      id: 'seed-del', user_id: 'local-julian', title: 'Löschbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben/seed-del', {
      'mw.tasks.local-julian': JSON.stringify([task]),
    })
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
      id: 'seed-done', user_id: 'local-julian', title: 'Erledigbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben', {
      'mw.tasks.local-julian': JSON.stringify([task]),
    })
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
      id: 'seed-visible', user_id: 'local-julian', title: 'Sichtbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben', {
      'mw.tasks.local-julian': JSON.stringify([task]),
    })
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
      id, user_id: 'local-julian', title,
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
    const window = makeDom('#/aufgaben', {
      'mw.tasks.local-julian': JSON.stringify(seeded),
    })
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
      id: 'seed-trash', user_id: 'local-julian', title: 'Gelöschte Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: true,
      completed_at: null, deleted_at: now, sort_order: 0,
      created_at: now, updated_at: now,
    }
    const window = makeDom('#/aufgaben/seed-trash', {
      'mw.tasks.local-julian': JSON.stringify([task]),
    })
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
    await wait(450)
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
      id: 'seed-done', user_id: 'local-julian', title: 'Erledigbare Aufgabe',
      category: 'Privat', subcategory: null, details: null,
      due_date: null, due_time: null, due_type: 'day',
      is_favorite: false, is_completed: false, is_deleted: false,
      completed_at: null, deleted_at: null, sort_order: 0,
      created_at: now, updated_at: now, ...extra,
    }
  }
  const seedStore = (extra) => ({ 'mw.tasks.local-julian': JSON.stringify([seedTask(extra)]) })

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
