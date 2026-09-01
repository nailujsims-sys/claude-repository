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
