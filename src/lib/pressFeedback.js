// Central press-feedback controller (G2).
//
// Every interactive surface in the app must show that it is being pressed the
// moment the pointer goes down, without the action being committed early. The
// semantics are the ones useTimedGesture.js already established for the
// calendar, applied to plain taps instead of drags:
//
//   pointerdown                       → feedback on
//   drift below PRESS_SLOP            → stays pressed (a fingertip is never still)
//   moved out of the activation area  → feedback off (the press is cancelled)
//   moved back in                     → feedback on again
//   pointerup                         → the browser's own click commits
//   pointercancel / scroll / drag     → feedback off, nothing committed
//
// Two deliberate non-goals keep this safe to drop under an app that is full of
// existing gestures:
//
//   • It never commits anything. The module only writes a `data-pressed`
//     attribute; the action still runs from the element's own onClick, and a
//     native click already means "released inside the element". So no existing
//     handler had to change, and none of them can fire early.
//   • It never calls preventDefault and never sets touch-action. Page
//     scrolling, the calendar swipe (useSwipe) and the dnd-kit task drag keep
//     the exact gesture budget they had before. When the browser takes the
//     gesture over for a scroll it sends pointercancel, which is our primary
//     and most reliable cancel path.
//
// One delegated listener pair serves every button in the app. Elements opt in
// by carrying one of the press classes (see the press block in index.css) —
// there is no per-button handler anywhere.

export const PRESS_SELECTOR = '.press-tint, .press-fade, .press-scale'

// The threshold useTimedGesture uses to tell a tap from a scroll. Small,
// unintended movement must not read as "left the button".
export const PRESS_SLOP = 8
// A fingertip resting on the edge shouldn't flicker the state.
export const EDGE_TOLERANCE = 4
// If the element itself moves under the finger — a dnd-kit drag lifted the row,
// a scroll container moved — this stopped being a plain press.
export const DRIFT_TOLERANCE = 2

const PRESSED_ATTR = 'data-pressed'
const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Spacebar'])

// ── Pure state machine (unit tested in tools/pressLogic.mjs) ────────────────

export function movedBeyondSlop(dx, dy, slop = PRESS_SLOP) {
  return Math.hypot(dx, dy) > slop
}

export function withinActivation(rect, x, y, tolerance = EDGE_TOLERANCE) {
  return (
    x >= rect.left - tolerance &&
    x <= rect.right + tolerance &&
    y >= rect.top - tolerance &&
    y <= rect.bottom + tolerance
  )
}

// Inside the slop circle the press always survives; past it the press follows
// the activation area, so leaving cancels and coming back re-arms.
export function shouldStayPressed({
  rect,
  startX,
  startY,
  x,
  y,
  slop = PRESS_SLOP,
  tolerance = EDGE_TOLERANCE,
}) {
  if (!movedBeyondSlop(x - startX, y - startY, slop)) return true
  return withinActivation(rect, x, y, tolerance)
}

export function rectMoved(a, b, tolerance = DRIFT_TOLERANCE) {
  return (
    Math.abs(a.left - b.left) > tolerance || Math.abs(a.top - b.top) > tolerance
  )
}

// ── Controller ──────────────────────────────────────────────────────────────

function isDisabled(el) {
  return el.disabled === true || el.getAttribute('aria-disabled') === 'true'
}

function paint(el, value) {
  if (!el) return
  if (value) el.setAttribute(PRESSED_ATTR, value === true ? '' : value)
  else el.removeAttribute(PRESSED_ATTR)
}

export function installPressFeedback(doc = globalThis.document) {
  if (!doc) return () => {}

  let pointer = null // { el, pointerId, startX, startY, rect, pressed }
  let keyed = null // element currently held down via Enter/Space

  const endPointer = () => {
    if (!pointer) return
    paint(pointer.el, false)
    pointer = null
  }
  const endKeyed = () => {
    if (!keyed) return
    paint(keyed, false)
    keyed = null
  }

  const onPointerDown = (e) => {
    endPointer()
    // Secondary touches and right/middle mouse buttons never activate anything.
    if (!e.isPrimary) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.target?.closest?.(PRESS_SELECTOR)
    if (!el || isDisabled(el)) return
    pointer = {
      el,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      rect: el.getBoundingClientRect(),
      pressed: true,
    }
    paint(el, true)
  }

  const onPointerMove = (e) => {
    const s = pointer
    if (!s || e.pointerId !== s.pointerId) return
    // Note: while an ancestor holds pointer capture (the calendar grid does)
    // the events retarget to that ancestor, so the hit test deliberately runs
    // against the element's own remembered rect, never against e.target.
    const now = s.el.getBoundingClientRect()
    if (rectMoved(now, s.rect)) {
      endPointer()
      return
    }
    const pressed = shouldStayPressed({
      rect: s.rect,
      startX: s.startX,
      startY: s.startY,
      x: e.clientX,
      y: e.clientY,
    })
    if (pressed === s.pressed) return
    s.pressed = pressed
    paint(s.el, pressed)
  }

  const onPointerEnd = (e) => {
    if (pointer && e.pointerId !== pointer.pointerId) return
    endPointer()
  }

  // Keyboard activation gets the same feedback, marked so the CSS can use a
  // wash instead of an opacity dip and leave the focus ring fully readable.
  const onKeyDown = (e) => {
    if (e.repeat || !ACTIVATION_KEYS.has(e.key)) return
    const el = e.target?.closest?.(PRESS_SELECTOR)
    if (!el || isDisabled(el)) return
    if (keyed && keyed !== el) endKeyed()
    keyed = el
    paint(el, 'key')
  }
  const onKeyUp = (e) => {
    if (ACTIVATION_KEYS.has(e.key)) endKeyed()
  }
  // An element losing focus while it is held down with the keyboard ends that
  // press — but only for the element that was actually holding the key.
  const onFocusOut = (e) => {
    if (keyed && e.target === keyed) endKeyed()
  }
  // Only the window itself losing focus (app switch, devtools) cancels a press.
  // This one deliberately listens on the bubble phase and checks the target:
  // capture propagation starts at the window, so a capturing blur listener here
  // would see *every* element blur in the document — and since pointerdown
  // moves focus (blurring whatever held it), that would wipe the pressed state
  // the very moment it was set.
  const onWindowBlur = (e) => {
    if (e.target !== doc.defaultView) return
    endPointer()
    endKeyed()
  }

  // Capture phase so a stopPropagation() further down can never leave a button
  // stuck in its pressed state; passive because we never preventDefault.
  const opts = { capture: true, passive: true }
  const bound = []
  const on = (target, type, fn) => {
    target.addEventListener(type, fn, opts)
    bound.push(() => target.removeEventListener(type, fn, opts))
  }

  if (typeof globalThis.PointerEvent !== 'undefined') {
    on(doc, 'pointerdown', onPointerDown)
    on(doc, 'pointermove', onPointerMove)
    on(doc, 'pointerup', onPointerEnd)
    on(doc, 'pointercancel', onPointerEnd)
  }
  on(doc, 'keydown', onKeyDown)
  on(doc, 'keyup', onKeyUp)
  // A scroll means the browser took the gesture over — end the press without
  // committing anything. Capture catches scrolling containers too, not just
  // the page, since `scroll` does not bubble.
  on(doc, 'scroll', endPointer)
  on(doc, 'blur', onFocusOut)
  if (doc.defaultView) {
    const view = doc.defaultView
    const bubbleOpts = { capture: false, passive: true }
    view.addEventListener('blur', onWindowBlur, bubbleOpts)
    bound.push(() => view.removeEventListener('blur', onWindowBlur, bubbleOpts))
  }

  return () => {
    endPointer()
    endKeyed()
    for (const off of bound) off()
  }
}
