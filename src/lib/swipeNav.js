// Decision logic for the calendar's horizontal period swipe (G6).
//
// The gesture used to be judged only by the net delta on `touchend`: a 40px
// flick did nothing, a 60px crawl over a second and a half navigated, and
// nothing moved while the finger was down. §10 asks that release velocity
// influence the result, §12 that a gesture give feedback and be tracked rather
// than decided by one final "swipe detected" event.
//
// This module is the *decisions* only — which axis the gesture is on, how far
// the view may lag behind the finger, and whether a release navigates. The
// sampling and the resistance curve are imported rather than rewritten: they
// are the ones G5 already ships and tests.
//
// Pure on purpose — no React, no DOM — so tools/swipeLogic.mjs can check it.

import { rubberBand } from './sheetDrag'

export { trackSample, velocityFrom } from './sheetDrag'

// Unchanged from the original gesture: the distance that has always counted as
// a swipe, and the margin by which horizontal must beat vertical before the
// calendar treats a diagonal drag as navigation rather than as scrolling.
export const SWIPE_DISTANCE = 48
export const SWIPE_RATIO = 1.4

// Movement needed before the gesture commits to an axis. The value
// useTimedGesture.js uses to tell a drag from a tap, so a fingertip's drift
// never picks an axis on its own.
export const SWIPE_SLOP = 8

// px/ms (500px/s). A horizontal throw across a phone is a longer, faster motion
// than the vertical pull G5 tuned at 0.6, and the ratio guard above already
// rejects the accidental ones — so the bar for "that was a flick" sits a little
// lower here.
export const SWIPE_FLICK = 0.5

// How far the view may trail the finger. Deliberately not the viewport width:
// this is a hint that the gesture was understood, not a pager, so the offset
// approaches 48px asymptotically and never runs away. At the distance that
// commits, the view has moved ~17px — clearly visible, obviously not a page.
export const SWIPE_HINT_MAX = 48

/** Does horizontal movement dominate by enough to mean navigation? */
export function isHorizontal(dx, dy, ratio = SWIPE_RATIO) {
  return Math.abs(dx) >= Math.abs(dy) * ratio
}

/**
 * Which axis the gesture is on, or null while it is still too small to tell.
 * Vertical locks the gesture out of navigation for good, so a scroll can never
 * drag the calendar sideways halfway through.
 */
export function swipeAxis(dx, dy, slop = SWIPE_SLOP, ratio = SWIPE_RATIO) {
  if (Math.hypot(dx, dy) < slop) return null
  return isHorizontal(dx, dy, ratio) ? 'x' : 'y'
}

/**
 * The damped offset to paint for a raw horizontal delta. All movement here is
 * against a boundary — there is no neighbouring period mounted to drag into —
 * so the whole range rubber-bands (§13) rather than tracking 1:1.
 */
export function swipeHint(dx, max = SWIPE_HINT_MAX) {
  const magnitude = rubberBand(Math.abs(dx), max)
  return dx < 0 ? -magnitude : magnitude
}

/**
 * Which way a release navigates: +1 next, -1 previous, 0 stay.
 *
 * Distance **or** velocity, and direction beats both — the same shape as G5's
 * `shouldDismiss`. A short fast flick navigates, a long slow drag navigates,
 * and a fast pull back the other way keeps the period even when the finger had
 * already travelled past the distance on its way out.
 */
export function shouldNavigate({
  dx,
  dy,
  velocity = 0,
  distance = SWIPE_DISTANCE,
  flick = SWIPE_FLICK,
  ratio = SWIPE_RATIO,
}) {
  if (!dx || !Number.isFinite(dx)) return 0
  if (!isHorizontal(dx, dy, ratio)) return 0

  const speed = Number.isFinite(velocity) ? velocity : 0
  const sameWay = speed < 0 === dx < 0
  // Thrown back against the drag: the user is visibly taking it back.
  if (Math.abs(speed) >= flick && !sameWay) return 0

  const far = Math.abs(dx) >= distance
  const fast = Math.abs(speed) >= flick && sameWay
  if (!far && !fast) return 0

  return dx < 0 ? 1 : -1 // swipe left → next period, swipe right → previous
}
