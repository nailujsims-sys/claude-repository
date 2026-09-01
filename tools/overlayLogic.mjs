// Pure-logic tests for the overlay presence machine and the Escape stack (G4).
// The React/DOM plumbing in src/components/Overlay.jsx is deliberately thin —
// the decisions ("may this still unmount?", "whose Escape is this?") live in
// exported pure functions, so they can be checked here without a browser.
// Bundled with esbuild like calendarLogic.mjs and pressLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  CLOSED, ENTERING, OPEN, EXITING,
  OPEN_EVENT, CLOSE_EVENT, PRIMED, EXITED,
  nextPhase, isMounted, acceptsEscape,
  createOverlayStack,
} from './src/lib/overlayPresence.js'
import { createScrollLock, LOCK_ATTR } from './src/lib/scrollLock.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// Feed a whole sequence of events through the machine.
const run = (start, ...events) => events.reduce(nextPhase, start)

// ── the happy path both ways ────────────────────────────────────────────────
ok('starts closed and opens into entering', nextPhase(CLOSED, OPEN_EVENT) === ENTERING)
ok('entering becomes open once the closed position is painted',
   nextPhase(ENTERING, PRIMED) === OPEN)
ok('open closes into exiting', nextPhase(OPEN, CLOSE_EVENT) === EXITING)
ok('exiting unmounts only when the transition has finished',
   nextPhase(EXITING, EXITED) === CLOSED)
ok('a full open/close cycle lands back at closed',
   run(CLOSED, OPEN_EVENT, PRIMED, CLOSE_EVENT, EXITED) === CLOSED)

// ── G4's two interruption cases ─────────────────────────────────────────────
// Reopening mid-exit must NOT pass through closed: that would remount the
// panel, restart it from its closed position and throw away the form inside.
ok('reopening while exiting goes straight back to open',
   nextPhase(EXITING, OPEN_EVENT) === OPEN)
ok('exiting → open never reports itself as unmountable',
   isMounted(nextPhase(EXITING, OPEN_EVENT)))
ok('close → reopen → close again still ends in a proper exit',
   run(OPEN, CLOSE_EVENT, OPEN_EVENT, CLOSE_EVENT) === EXITING)
ok('open/close hammered repeatedly never unmounts mid-flight',
   run(CLOSED, OPEN_EVENT, PRIMED, CLOSE_EVENT, OPEN_EVENT, CLOSE_EVENT, OPEN_EVENT) === OPEN)

// Closing during "entering" is the one case with nothing to animate: the panel
// is still parked at its closed position, so it may unmount straight away.
ok('closing while still entering unmounts immediately',
   nextPhase(ENTERING, CLOSE_EVENT) === CLOSED)
ok('...and does not leave a dangling exit', run(CLOSED, OPEN_EVENT, CLOSE_EVENT) === CLOSED)

// ── the machine has to be safe to feed from a bubbling transitionend ────────
// The *opening* transition ends too, and that event must not close anything.
ok('the end of the opening transition is ignored', nextPhase(OPEN, EXITED) === OPEN)
ok('a stray transitionend while entering is ignored', nextPhase(ENTERING, EXITED) === ENTERING)
ok('a stray transitionend while closed is ignored', nextPhase(CLOSED, EXITED) === CLOSED)
ok('a stray prime while open is ignored', nextPhase(OPEN, PRIMED) === OPEN)
ok('a stray prime while exiting does not cancel the exit',
   nextPhase(EXITING, PRIMED) === EXITING)
ok('opening an already-open overlay changes nothing', nextPhase(OPEN, OPEN_EVENT) === OPEN)
ok('closing an already-closed overlay changes nothing', nextPhase(CLOSED, CLOSE_EVENT) === CLOSED)
ok('an unknown event is a no-op', nextPhase(OPEN, 'nonsense') === OPEN)
ok('an unknown phase is a no-op', nextPhase('bogus', OPEN_EVENT) === 'bogus')

// ── selectors ───────────────────────────────────────────────────────────────
ok('closed is the only unmounted phase',
   !isMounted(CLOSED) && isMounted(ENTERING) && isMounted(OPEN) && isMounted(EXITING))
ok('an overlay on its way out no longer answers Escape',
   acceptsEscape(ENTERING) && acceptsEscape(OPEN) && !acceptsEscape(EXITING) && !acceptsEscape(CLOSED))

// ── Overlay stack ───────────────────────────────────────────────────────────
// The bug this replaces: an EventDetailSheet with a ConfirmDialog on top of it
// closed BOTH on a single Escape, because each listened for itself.
{
  const stack = createOverlayStack()
  const sheet = { name: 'sheet' }
  const dialog = { name: 'dialog' }
  const popSheet = stack.push(sheet)
  const popDialog = stack.push(dialog)

  ok('both overlays are registered', stack.size() === 2)
  ok('the last one registered is the top', stack.isTop(dialog) && !stack.isTop(sheet))

  const escape = {} // one keypress, offered to every listener
  ok('the dialog claims the keypress', stack.claim(dialog, escape) === true)
  ok('the sheet underneath does not close on the same keypress',
     stack.claim(sheet, escape) === false)

  // Even if the dialog were popped before the sheet's listener ran, the event
  // is already spent — so the outcome cannot depend on listener order or on
  // when React flushes the state update.
  popDialog()
  ok('the sheet is the top again once the dialog is gone', stack.isTop(sheet))
  ok('...but still cannot claim the keypress it already lost',
     stack.claim(sheet, escape) === false)

  const second = {}
  ok('a second keypress does reach the sheet', stack.claim(sheet, second) === true)

  popSheet()
  ok('the stack empties', stack.size() === 0)
  ok('nothing claims a keypress on an empty stack', stack.claim(sheet, {}) === false)
}

{
  const stack = createOverlayStack()
  const a = {}, b = {}, c = {}
  const popA = stack.push(a), popB = stack.push(b), popC = stack.push(c)
  // Overlays do not necessarily unmount in the order they were opened.
  popB()
  ok('removing from the middle keeps the top intact', stack.isTop(c) && stack.size() === 2)
  popC()
  ok('the one below becomes top again', stack.isTop(a))
  popA()
  ok('removing twice is harmless', (popA(), stack.size() === 0))
}

// The stack now also carries the focus trap (G13) and the scroll lock (G14),
// so an overlay without an onEscape has to be in it too — and remove() is
// available on its own, not only as push's return value.
{
  const stack = createOverlayStack()
  const search = {} // no Escape handler of its own
  const sheet = {}
  stack.push(search)
  stack.push(sheet)
  ok('an overlay registers regardless of an Escape handler', stack.size() === 2)
  ok('the later overlay is the one that traps', stack.isTop(sheet))
  stack.remove(sheet)
  ok('remove(entry) works without the returned remover', stack.isTop(search))
  stack.remove({})
  ok('removing an unknown entry is harmless', stack.size() === 1)
  stack.remove(search)
  ok('nothing is top on an empty stack', !stack.isTop(search) && stack.size() === 0)
}

// ── Scroll lock (G14) ───────────────────────────────────────────────────────
// Overlays stack and release out of order, and the same React effect cleanup
// can run twice — the count has to survive all of it, because a count that
// never reaches zero leaves the page permanently unscrollable.
{
  const applied = []
  const lock = createScrollLock((locked) => applied.push(locked))

  const sheet = lock.acquire()
  ok('the first overlay locks the page', lock.locked() && applied.join() === 'true')

  const dialog = lock.acquire()
  ok('a dialog on top does not lock a second time', applied.join() === 'true')
  ok('...but is counted', lock.count() === 2)

  dialog()
  ok('closing the dialog leaves the lock the sheet still holds',
     lock.locked() && applied.join() === 'true')
  sheet()
  ok('the last overlay to close unlocks', !lock.locked() && applied.join() === 'true,false')

  // A cleanup that runs twice must not push the count below what is held.
  const a = lock.acquire()
  const b = lock.acquire()
  a(); a(); a()
  ok('releasing the same holder repeatedly is harmless', lock.count() === 1 && lock.locked())
  b()
  ok('...and the page still unlocks exactly once', !lock.locked())
  ok('the page was locked and unlocked twice, never more',
     applied.join() === 'true,false,true,false')
}

// G4's exiting-to-open edge is what keeps the count balanced: the
// overlay never leaves the mounted window, so the effect holding the lock is
// never torn down and re-run.
{
  const phases = [CLOSED, ENTERING, OPEN, EXITING, OPEN, EXITING, CLOSED]
  const mounted = phases.map(isMounted)
  ok('the overlay stays mounted from the first open to the final close',
     mounted.join() === 'false,true,true,true,true,true,false')
  ok('so a lock keyed on mounted is taken once and released once',
     mounted.filter((m, i) => i > 0 && m !== mounted[i - 1]).length === 2)
}

ok('the lock is applied as an attribute, not an inline style',
   LOCK_ATTR === 'data-ov-scroll-locked')

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'overlayLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/overlayLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
