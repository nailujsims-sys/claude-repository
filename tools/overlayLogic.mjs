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
  createEscapeStack,
} from './src/lib/overlayPresence.js'

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

// ── Escape stack ────────────────────────────────────────────────────────────
// The bug this replaces: an EventDetailSheet with a ConfirmDialog on top of it
// closed BOTH on a single Escape, because each listened for itself.
{
  const stack = createEscapeStack()
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
  const stack = createEscapeStack()
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
