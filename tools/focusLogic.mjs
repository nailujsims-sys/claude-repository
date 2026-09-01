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
  FOCUSABLE_SELECTOR, initialFocus, nextFocus, scopeElements, shouldRestore,
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

// ── the scope with an actionable toast (G21) ────────────────────────────────
// The toast renders outside every .ov-root but floats above the panel, so it
// joins the scope as a second, detached part. \`seam\` is where it begins.
const TOAST = ['undo']

const withToast = scopeElements({ overlayElements: SHEET, toastElements: TOAST })
// Pinned against literals, not against the function's own output: a rotated
// ring walks identically, so only the ends and the seam can tell "toast last"
// from "toast first" apart.
ok('an actionable toast joins the scope at the end',
   withToast.elements.join() === 'close,title,save,undo')
ok('the panel still owns the front of the scope',
   withToast.elements[0] === 'close')
ok('the toast owns the back of it',
   withToast.elements[withToast.elements.length - 1] === 'undo')
ok('the seam sits where the panel ends', withToast.seam === SHEET.length)

// The regression that matters most: nothing about an overlay without a toast
// may differ from G13. Same list, and a seam that no branch can ever match.
const noToast = scopeElements({ overlayElements: SHEET, toastElements: [] })
ok('no toast leaves the panel list exactly as it was',
   noToast.elements === SHEET && noToast.seam === -1)
ok('a toast that contributes nothing focusable is not in the scope',
   scopeElements({ overlayElements: SHEET, toastElements: undefined }).elements === SHEET)
ok('the scope survives being asked with nothing at all',
   scopeElements({}).elements.length === 0 && scopeElements({}).seam === -1)

// Crossing the seam is claimed, because the browser's natural order does not
// lead from the panel's last control to a toast rendered elsewhere in the tree.
const S = withToast.elements, seam = withToast.seam
ok('tab off the last panel control crosses to the toast',
   nextFocus({ elements: S, current: 'save', seam }) === 'undo')
ok('tab off the toast wraps to the first panel control',
   nextFocus({ elements: S, current: 'undo', seam }) === 'close')
ok('shift+tab off the first panel control wraps around to the toast',
   nextFocus({ elements: S, current: 'close', backwards: true, seam }) === 'undo')
ok('shift+tab off the toast crosses back to the last panel control',
   nextFocus({ elements: S, current: 'undo', backwards: true, seam }) === 'save')

// Everything that is not a seam or an edge still belongs to the browser — the
// G13 rule the seam was invented to preserve.
ok('tabbing inside the panel is still left to the browser with a toast present',
   nextFocus({ elements: S, current: 'close', seam }) === null &&
   nextFocus({ elements: S, current: 'title', seam }) === null)
ok('shift+tab inside the panel is still left to the browser with a toast present',
   nextFocus({ elements: S, current: 'save', backwards: true, seam }) === null)

// A one-control panel plus a toast is exactly two stops, and they point at
// each other in both directions.
const tiny = scopeElements({ overlayElements: ['only'], toastElements: TOAST })
ok('a one-control panel plus a toast is exactly two stops',
   tiny.elements.length === 2 &&
   nextFocus({ elements: tiny.elements, current: 'only', seam: tiny.seam }) === 'undo' &&
   nextFocus({ elements: tiny.elements, current: 'undo', seam: tiny.seam }) === 'only' &&
   nextFocus({ elements: tiny.elements, current: 'undo', backwards: true, seam: tiny.seam }) === 'only' &&
   nextFocus({ elements: tiny.elements, current: 'only', backwards: true, seam: tiny.seam }) === 'undo')

// The toast can run out while it holds the focus. The scope it leaves behind
// is the panel's own again, and a focus that is no longer in the list comes
// back to the near end — the same rule G13 already had for a stray Tab.
ok('a focus left over from a vanished toast returns to the near end',
   nextFocus({ elements: SHEET, current: 'undo' }) === 'close' &&
   nextFocus({ elements: SHEET, current: 'undo', backwards: true }) === 'save')
ok('the same holds once the focus has fallen to nothing',
   nextFocus({ elements: SHEET, current: null }) === 'close')

// Entering the scope from outside is the one walk a rotation *does* change:
// it must land on the panel the user opened, never on the transient toast.
ok('a focus pulled in from outside lands in the panel, not on the toast',
   nextFocus({ elements: S, current: 'bottom-nav', seam }) === 'close')
ok('...and backwards it still lands on the toast, the near end that way round',
   nextFocus({ elements: S, current: 'bottom-nav', backwards: true, seam }) === 'undo')

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
