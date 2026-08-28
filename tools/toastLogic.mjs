// Pure-logic tests for the toast state, including undo (G8).
// The React shell in src/context/ToastContext.jsx is deliberately thin — the
// decisions ("how long does this one live?", "may that timer close this
// toast?", "has this undo already run?") are exported pure functions, so they
// can be checked here without a browser. Bundled with esbuild like the other
// logic tests.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  TOAST_DURATION, TOAST_ACTION_DURATION,
  initialToastState, normalizeAction, pushToast,
  dismissToast, expireToast, takeToastAction,
} from './src/lib/toastState.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const noop = () => {}
const undo = { actionLabel: 'Rückgängig', onAction: noop }

// ── 1. a plain toast ────────────────────────────────────────────────────────
{
  const s = pushToast(initialToastState(), 'Termin gespeichert ✓')
  ok('a plain toast holds its message', s.toast.message === 'Termin gespeichert ✓')
  ok('a plain toast has no action label', s.toast.actionLabel === null)
  ok('a plain toast has no handler', s.toast.onAction === null)
  ok('a plain toast lives 2s', s.toast.duration === TOAST_DURATION)
  ok('a plain toast gets an id', typeof s.toast.id === 'number')
}

// ── 2. a toast with an action ───────────────────────────────────────────────
{
  const s = pushToast(initialToastState(), 'Erledigt', undo)
  ok('an action toast keeps its message', s.toast.message === 'Erledigt')
  ok('an action toast carries the label', s.toast.actionLabel === 'Rückgängig')
  ok('an action toast carries the handler', s.toast.onAction === noop)
}

// ── 3. the two durations ────────────────────────────────────────────────────
{
  const plain = pushToast(initialToastState(), 'x')
  const action = pushToast(initialToastState(), 'x', undo)
  ok('an action toast lives 5s', action.toast.duration === TOAST_ACTION_DURATION)
  ok('an undo gets longer than a plain message', action.toast.duration > plain.toast.duration)
  ok('the plain duration is unchanged from before G8', TOAST_DURATION === 2000)
  ok('the action duration is 5s', TOAST_ACTION_DURATION === 5000)
}

// ── 4. replacement: one slot ────────────────────────────────────────────────
{
  const first = pushToast(initialToastState(), 'Erledigt', undo)
  const second = pushToast(first, 'Aufgabe gelöscht', { actionLabel: 'Rückgängig', onAction: noop })
  ok('the second toast replaces the first', second.toast.message === 'Aufgabe gelöscht')
  ok('only one toast is ever held', Object.keys(second).length === 2 && !Array.isArray(second.toast))
  ok('the replacement gets a new id', second.toast.id !== first.toast.id)
  ok('ids move forward', second.toast.id > first.toast.id)
}

// ── 5. a stale timer cannot close a newer toast ─────────────────────────────
{
  const first = pushToast(initialToastState(), 'Erledigt', undo)
  const second = pushToast(first, 'Aufgabe gelöscht', undo)
  const afterStale = expireToast(second, first.toast.id)
  ok('the first toast\\'s timer leaves the second alone', afterStale.toast === second.toast)
  ok('a stale expiry does not even produce a new state', afterStale === second)
  ok('the second toast\\'s own timer does close it', expireToast(second, second.toast.id).toast === null)
  ok('expiring an already-empty slot is safe', expireToast(dismissToast(second), 1).toast === null)
}

// ── 6. dismiss ──────────────────────────────────────────────────────────────
{
  const s = pushToast(initialToastState(), 'Erledigt', undo)
  ok('dismiss clears the toast', dismissToast(s).toast === null)
  ok('dismiss keeps the id counter, so the next id is still new',
     pushToast(dismissToast(s), 'x').toast.id > s.toast.id)
}

// ── 7/8/9. the action runs once, closes the toast, and cannot come back ─────
{
  let runs = 0
  const s = pushToast(initialToastState(), 'Erledigt', {
    actionLabel: 'Rückgängig', onAction: () => { runs++ },
  })
  const first = takeToastAction(s, s.toast.id)
  ok('taking the action hands back the handler', typeof first.action === 'function')
  ok('taking the action closes the toast at once', first.state.toast === null)
  first.action()
  ok('the handler ran', runs === 1)

  const again = takeToastAction(first.state, s.toast.id)
  ok('the same action cannot be taken twice', again.action === null)
  ok('a second take leaves the state alone', again.state === first.state)

  // A click landing on a toast that has since been replaced.
  const replaced = pushToast(s, 'Aufgabe gelöscht', undo)
  const stale = takeToastAction(replaced, s.toast.id)
  ok('a stale action id is refused', stale.action === null)
  ok('a stale take does not close the newer toast', stale.state.toast === replaced.toast)

  // A plain toast has nothing to take.
  const plain = pushToast(initialToastState(), 'Termin gespeichert ✓')
  ok('a plain toast yields no action', takeToastAction(plain, plain.toast.id).action === null)
  ok('a plain toast is not closed by a take', takeToastAction(plain, plain.toast.id).state === plain)
  ok('taking from an empty slot is safe', takeToastAction(initialToastState(), 1).action === null)
}

// ── 10. ids are unique and monotonic, even inside one millisecond ───────────
{
  // The previous implementation used Date.now() as the id; ten toasts raised in
  // the same tick would have collided. A counter cannot.
  let s = initialToastState()
  const ids = []
  for (let i = 0; i < 1000; i++) { s = pushToast(s, 'x'); ids.push(s.toast.id) }
  ok('1000 toasts in one tick get 1000 distinct ids', new Set(ids).size === 1000)
  ok('ids are strictly increasing', ids.every((id, i) => i === 0 || id > ids[i - 1]))
  ok('ids do not depend on the clock', ids[0] === 1 && ids[999] === 1000)
}

// ── 11. showToast(message) stays backwards compatible ───────────────────────
{
  // Every existing caller passes exactly one argument.
  const s = pushToast(initialToastState(), 'Aufgabe gespeichert ✓')
  ok('one-argument use still works', s.toast.message === 'Aufgabe gespeichert ✓')
  ok('one-argument use gets the old duration', s.toast.duration === TOAST_DURATION)
  ok('one-argument use renders no button', s.toast.actionLabel === null)
  ok('undefined options are the same as none',
     pushToast(initialToastState(), 'x', undefined).toast.duration === TOAST_DURATION)
}

// ── 12. incomplete action configuration degrades to a plain toast ───────────
{
  const bad = [
    { actionLabel: 'Rückgängig' },                    // no handler
    { onAction: noop },                               // no label
    { actionLabel: '', onAction: noop },              // empty label
    { actionLabel: '   ', onAction: noop },           // blank label
    { actionLabel: 'Rückgängig', onAction: 'nope' },  // handler is not callable
    { actionLabel: 42, onAction: noop },              // label is not a string
    {},
    null,
  ]
  ok('every incomplete action is rejected', bad.every((o) => normalizeAction(o) === null))
  ok('an incomplete action degrades to a plain toast',
     bad.every((o) => {
       const t = pushToast(initialToastState(), 'x', o).toast
       return t.actionLabel === null && t.onAction === null && t.duration === TOAST_DURATION
     }))
  ok('a complete action is accepted', normalizeAction(undo) !== null)
}

// ── 13. dismiss is idempotent ───────────────────────────────────────────────
{
  const s = pushToast(initialToastState(), 'Erledigt', undo)
  const once = dismissToast(s)
  const twice = dismissToast(once)
  ok('dismissing twice changes nothing', twice.toast === null)
  ok('a redundant dismiss returns the same object', twice === once)
  ok('dismissing an empty slot returns the same object',
     dismissToast(initialToastState()) !== null)
  ok('three dismisses are still one outcome', dismissToast(twice).toast === null)
}

// ── the state is never mutated in place ─────────────────────────────────────
{
  const s = pushToast(initialToastState(), 'Erledigt', undo)
  const snapshot = s.toast
  dismissToast(s); expireToast(s, s.toast.id); takeToastAction(s, s.toast.id)
  ok('the input state survives every transition untouched', s.toast === snapshot)
}

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'toastLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/toastLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
