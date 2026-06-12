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

async function run() {
  const code = await bundle()

  // 1) Each route mounts and renders.
  for (const [name, hash] of [
    ['Home (/)', '#/'],
    ['Aufgaben (/aufgaben)', '#/aufgaben'],
    ['Mehr (/mehr)', '#/mehr'],
    ['Kalender (/kalender)', '#/kalender'],
  ]) {
    const window = makeDom(hash)
    mount(window, code, name)
    await wait(250)
    window.__restoreConsole?.()
    const text = txt(window)
    console.log(`\n=== ${name} ===\n  len=${text.length} :: ${text.slice(0, 150)}`)
    if (text.length < 20) errors.push(`[${name}] rendered almost nothing`)
  }

  // 2) Detail view for a known, pre-seeded task (exercises formatDueLabel etc.).
  {
    const now = new Date().toISOString()
    const task = {
      id: 'seed-1', user_id: 'local-julian', title: 'Testaufgabe Detail',
      category: 'Uni', subcategory: 'Test', details: 'Ein Detailtext.',
      due_date: '2026-06-08', due_time: null, due_type: 'week',
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
    for (const needle of ['Testaufgabe Detail', 'Bearbeiten', 'Löschen', 'KW 24']) {
      if (!text.includes(needle)) errors.push(`[Detail] missing "${needle}"`)
    }
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

  console.log('\n--- result ---')
  if (errors.length) {
    console.log('FAILURES:')
    for (const e of errors) console.log('  -', e)
    process.exit(1)
  }
  console.log('OK: all routes + detail + form mounted and rendered without errors.')
}

run().catch((e) => {
  console.error('smoke harness error:', e)
  process.exit(1)
})
