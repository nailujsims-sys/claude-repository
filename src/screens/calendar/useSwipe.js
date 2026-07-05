import { useRef } from 'react'

// Horizontal swipe navigation for the calendar views. A left swipe advances to
// the next period, a right swipe goes back — in every view (day / week / month).
//
// It only reacts to clearly-horizontal, single-finger swipes, and ignores any
// gesture that starts on a timed event (those are event move/resize drags in the
// Tag/Woche views) so the two never fight. Vertical scrolling is untouched — we
// never preventDefault, we just read the net delta on touchend.
const THRESHOLD = 48 // min horizontal travel (px) to count as a swipe
const RATIO = 1.4 // horizontal must dominate vertical by this factor

export function useSwipe(onSwipe) {
  const start = useRef(null)

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) {
      start.current = null
      return
    }
    const onEvent = !!e.target.closest?.('[data-ev-id]')
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, onEvent }
  }

  const onTouchEnd = (e) => {
    const s = start.current
    start.current = null
    if (!s || s.onEvent) return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * RATIO) return
    onSwipe(dx < 0 ? 1 : -1) // swipe left → next, swipe right → previous
  }

  return { onTouchStart, onTouchEnd }
}
