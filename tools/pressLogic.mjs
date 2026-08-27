// Pure-logic tests for the press-feedback state machine (G2). The DOM plumbing
// in src/lib/pressFeedback.js is thin on purpose — the decisions ("is this
// still a press?") live in exported pure functions, so they can be checked here
// without a browser. Bundled with esbuild like calendarLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  movedBeyondSlop,
  withinActivation,
  shouldStayPressed,
  rectMoved,
  PRESS_SLOP,
  EDGE_TOLERANCE,
  installPressFeedback,
} from './src/lib/pressFeedback.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

// A 100×40 button at (50, 100).
const rect = { left: 50, top: 100, right: 150, bottom: 140 }
const at = (x, y) => shouldStayPressed({ rect, startX: 100, startY: 120, x, y })

// ── slop: small, unintended movement must never read as a cancel ────────────
ok('slop constant matches useTimedGesture TAP_SLOP', PRESS_SLOP === 8)
ok('no movement is under slop', !movedBeyondSlop(0, 0))
ok('7px diagonal-ish is under slop', !movedBeyondSlop(5, 4))
ok('exactly slop is not beyond', !movedBeyondSlop(8, 0))
ok('9px is beyond slop', movedBeyondSlop(9, 0))

// ── activation area ─────────────────────────────────────────────────────────
ok('centre is inside', withinActivation(rect, 100, 120))
ok('corner is inside', withinActivation(rect, 50, 100))
ok('just past the edge is still inside (tolerance)', withinActivation(rect, 150 + EDGE_TOLERANCE, 120))
ok('well past the edge is outside', withinActivation(rect, 200, 120) === false)
ok('above the top is outside', withinActivation(rect, 100, 40) === false)

// ── the machine itself ──────────────────────────────────────────────────────
ok('still pressed without moving', at(100, 120) === true)
// A 6px drift leaves the rect vertically but stays inside the slop circle:
// the press must survive it, which is the whole point of the threshold.
ok('tiny drift outside the rect still counts as pressed', at(100, 143) === true)
ok('dragged far off the button cancels', at(100, 400) === false)
ok('dragged sideways off the button cancels', at(400, 120) === false)
// …and coming back re-arms, from the cancelled position, without a new press.
ok('dragging back in re-arms', at(120, 130) === true)
ok('far but still over the button stays pressed', at(148, 138) === true)

// ── element moving under the finger (dnd-kit lift, scroll) ──────────────────
ok('same rect has not moved', !rectMoved(rect, { left: 50, top: 100 }))
ok('1px of jitter is not a move', !rectMoved(rect, { left: 51, top: 100 }))
ok('a lifted row has moved', rectMoved(rect, { left: 50, top: 160 }))
ok('a scrolled container has moved', rectMoved(rect, { left: 90, top: 100 }))

// ── install/teardown must be safe where there is no DOM at all ──────────────
let threw = false
try { installPressFeedback(undefined)() } catch { threw = true }
ok('installing without a document is a no-op', !threw)

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'pressLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/pressLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
