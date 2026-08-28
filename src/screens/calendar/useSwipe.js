import { useRef } from 'react'
import {
  SWIPE_SLOP,
  shouldNavigate,
  swipeAxis,
  swipeHint,
  trackSample,
  velocityFrom,
} from '../../lib/swipeNav'

// Horizontal swipe navigation for the calendar views. A left swipe advances to
// the next period, a right swipe goes back — in every view (day / week / month).
//
// It only reacts to clearly-horizontal, single-finger swipes, and ignores any
// gesture that starts on a timed event (those are event move/resize drags in the
// Tag/Woche views) so the two never fight.
//
// G6 added the two things §10 and §12 asked for, without turning the calendar
// into a pager. While the finger is down the current view trails it, damped and
// rubber-banded (`swipeHint`), so the gesture is visibly understood before it is
// released; and the release is judged by distance **or** velocity, so a short
// flick navigates and a slow crawl past the threshold still does too.
//
// Two things it still deliberately does not do. It never calls preventDefault
// and never sets touch-action, so vertical scrolling, the long-press event grab
// in useTimedGesture.js and the task reorder keep exactly the gesture budget
// they had. And it never mounts the neighbouring period: the hint is a hint.
export function useSwipe(onSwipe, trackRef) {
  const start = useRef(null)

  // The view trails the finger through a custom property; the attribute switches
  // the transition off so it tracks instead of interpolating. Same pattern as
  // G5's `--ov-drag` / `data-drag`, and as with G5 the release simply removes
  // both — whatever happens next continues from the position on screen.
  const paint = (offset) => {
    const el = trackRef?.current
    if (!el) return
    el.style.setProperty('--cal-drag', `translateX(${offset}px)`)
    el.dataset.cal = 'live'
  }
  const release = () => {
    const el = trackRef?.current
    if (!el) return
    delete el.dataset.cal
    el.style.removeProperty('--cal-drag')
  }

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) {
      start.current = null
      return
    }
    const onEvent = !!e.target.closest?.('[data-ev-id]')
    const t = e.touches[0]
    start.current = {
      x: t.clientX,
      y: t.clientY,
      onEvent,
      axis: null,
      samples: [{ t: e.timeStamp, y: t.clientX }],
    }
  }

  const onTouchMove = (e) => {
    const s = start.current
    if (!s || s.onEvent) return
    if (e.touches.length !== 1) {
      // A second finger arrived — this is a pinch or a two-finger scroll now.
      release()
      start.current = null
      return
    }
    const t = e.touches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y

    // Velocity is sampled with the helpers G5 already tests. They are written
    // for a vertical drag, so the horizontal coordinate travels in their `y`
    // field: the maths only ever sees one axis at a time.
    s.samples = trackSample(s.samples, { t: e.timeStamp, y: t.clientX })

    if (s.axis === null) s.axis = swipeAxis(dx, dy)
    if (s.axis !== 'x') return // still undecided, or the finger is scrolling

    paint(swipeHint(dx))
  }

  const onTouchEnd = (e) => {
    const s = start.current
    start.current = null
    if (!s || s.onEvent) return
    const t = e.changedTouches[0]
    if (!t) {
      release()
      return
    }
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    // A very fast swipe can end before a single touchmove was delivered; judge
    // the axis on the final delta in that case rather than dropping the gesture.
    const axis = s.axis ?? swipeAxis(dx, dy)

    const dir =
      axis === 'x'
        ? shouldNavigate({ dx, dy, velocity: velocityFrom(s.samples) })
        : 0

    if (dir) {
      // Deliberately no release here. The track keeps the offset the finger
      // left it at, and the period change takes over from exactly there
      // (Kalender.jsx) — so a committed swipe never jumps to a fixed starting
      // offset the way the keyframe this replaced did.
      onSwipe(dir)
      return
    }
    release() // nothing committed — this is the snap back
  }

  const onTouchCancel = () => {
    start.current = null
    release()
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
