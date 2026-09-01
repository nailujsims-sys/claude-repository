// Pure-logic tests for the overlay focus scope (G13).
// The React/DOM plumbing in src/components/Overlay.jsx is deliberately thin —
// the decisions ("where does the focus land?", "may Tab leave?", "may we hand
// the focus back?") live in exported pure functions, so they can be checked
// here without a browser. Bundled with esbuild like overlayLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  FOCUSABLE_SELECTOR, initialFocus, nextFocus, shouldRestore,
} from './src/lib/focusScope.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// The scope only ever sees an ordered list, so plain strings stand in for the
// elements of a sheet: close button, title field, save button.
const SHEET = ['close', 'title', 'save']

// ── initial focus ───────────────────────────────────────────────────────────
ok('opening moves the focus to the first control in the panel',
   initialFocus({ elements: SHEET }) === 'close')
ok('a panel that focused itself keeps its own focus (the autofocused title)',
   initialFocus({ elements: SHEET, focusAlreadyInside: true }) === null)
ok('a panel with nothing focusable asks the caller to take the root',
   initialFocus({ elements: [] }) === null)
ok('...and does not fall over without a list at all',
   initialFocus({ elements: undefined }) === null)

// ── Tab: the browser keeps the middle, the trap keeps the edges ─────────────
ok('tabbing inside the panel is left to the browser',
   nextFocus({ elements: SHEET, current: 'close' }) === null &&
   nextFocus({ elements: SHEET, current: 'title' }) === null)
ok('tab off the last control wraps to the first',
   nextFocus({ elements: SHEET, current: 'save' }) === 'close')
ok('shift+tab off the first control wraps to the last',
   nextFocus({ elements: SHEET, current: 'close', backwards: true }) === 'save')
ok('shift+tab inside the panel is left to the browser',
   nextFocus({ elements: SHEET, current: 'save', backwards: true }) === null)

// A focus that is not in the scope at all gets pulled back to the near end.
// This is the state an overlay inherits from before the trap existed: inert
// dropped the focus on <body>, so the very next Tab has to find its way in.
ok('tab from outside the scope enters at the top',
   nextFocus({ elements: SHEET, current: 'bottom-nav' }) === 'close')
ok('shift+tab from outside the scope enters at the bottom',
   nextFocus({ elements: SHEET, current: null, backwards: true }) === 'save')
ok('tab with the focus on nothing enters at the top',
   nextFocus({ elements: SHEET, current: null }) === 'close')

// A dialog with a single control traps onto itself rather than letting go —
// the confirm dialog is two buttons, but a one-control panel must not escape.
ok('a single control wraps onto itself in both directions',
   nextFocus({ elements: ['only'], current: 'only' }) === 'only' &&
   nextFocus({ elements: ['only'], current: 'only', backwards: true }) === 'only')
ok('an empty panel has nowhere to send Tab', nextFocus({ elements: [], current: null }) === null)

// ── restoring the focus on close ────────────────────────────────────────────
const trigger = { targetConnected: true }
ok('closing hands the focus back to the trigger when the panel still had it',
   shouldRestore({ ...trigger, activeInsideRoot: true, activeIsBody: false }) === true)
ok('...and when the panel has already dropped it on <body>',
   shouldRestore({ ...trigger, activeInsideRoot: false, activeIsBody: true }) === true)

// EventDetailSheet → "Bearbeiten" → EventForm: the sheet closes and the form
// opens in the same breath. By the time the sheet unmounts the form holds the
// focus, and taking it back would land on a calendar entry behind two overlays.
ok('a sheet that handed over to another overlay does not take the focus back',
   shouldRestore({ ...trigger, activeInsideRoot: false, activeIsBody: false }) === false)

// The trigger may not have survived the overlay — deleting a task from its
// sheet takes the row that opened it with it.
ok('a trigger that has left the document is never focused',
   shouldRestore({ targetConnected: false, activeInsideRoot: true, activeIsBody: true }) === false)
ok('no trigger recorded at all is not restored either',
   shouldRestore({ targetConnected: false, activeInsideRoot: false, activeIsBody: true }) === false)

// ── the selector ────────────────────────────────────────────────────────────
// tabindex="-1" is script-focusable but never a Tab stop, and the overlay root
// itself carries it — including it would wrap Tab onto the scope's own box.
ok('the selector skips tabindex="-1"', FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'))
ok('the selector skips disabled controls', FOCUSABLE_SELECTOR.includes('button:not([disabled])'))
ok('the selector covers links, fields and custom stops',
   ['a[href]', 'input', 'select', 'textarea'].every((s) => FOCUSABLE_SELECTOR.includes(s)))

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'focusLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/focusLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
