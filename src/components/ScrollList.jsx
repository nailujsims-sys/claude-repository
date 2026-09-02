import { useCallback, useEffect, useRef, useState } from 'react'

// ── A list that scrolls inside its own box ──────────────────────────────────
//
// The Heute screen shows two live lists whose length is not under its control.
// Letting them grow makes the page longer with every new event or task until
// the second card is below the fold and the screen stops being an overview. So
// each list gets a height budget and scrolls inside it, and the page keeps its
// shape no matter how much data arrives.
//
// Three things make that behave the way a phone user expects:
//
//   • `overscroll-contain` — scrolling past the end of the list stops there
//     instead of handing the gesture to the page underneath. Without it a flick
//     inside the agenda scrolls the whole screen the moment the list runs out,
//     which is exactly what "beide Listen scrollen unabhängig" must not do.
//   • the edges fade — a list that is cut off flat looks like a list that
//     simply ends. The gradient appears only on the side that actually has
//     more content, so it is a statement about the data, not decoration: it is
//     absent when everything fits, and the top one appears as soon as
//     something has been scrolled past.
//   • nothing is truncated — the caller passes the whole list. What is off
//     screen is reachable by scrolling, not lost.
//
// The fades are opacity transitions on a gradient in the card's own colour, so
// there is no movement to remove under reduced motion (§22) and nothing to
// interrupt (§7): they follow the scroll position frame by frame.
export default function ScrollList({
  maxHeight,
  className = '',
  innerRef,
  children,
}) {
  const ownRef = useRef(null)
  const ref = innerRef || ownRef
  const [edges, setEdges] = useState({ top: false, bottom: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    // 1px of slack: fractional layout sizes otherwise report "more below" on a
    // list that is exactly full.
    const top = el.scrollTop > 1
    const bottom = el.scrollTop < max - 1
    setEdges((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom }
    )
  }, [ref])

  // Re-measure when the content changes (a task completed, an event added, the
  // scope switched) and when the box itself is resized — a rotation or a
  // desktop window drag changes how much fits without any scrolling happening.
  //
  // `children` is in the deps for both halves of that: it re-measures, and it
  // re-points the observer at the node that is actually in the box now. A list
  // that swaps between a skeleton, an empty line and the rows themselves does
  // not keep one child element, and observing only the scroller would miss the
  // growth — the scroller's own height is capped, its content's is not.
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [measure, ref, children])

  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        onScroll={measure}
        className="overflow-y-auto overscroll-contain"
        style={{ maxHeight }}
      >
        {children}
      </div>

      <Edge side="top" show={edges.top} />
      <Edge side="bottom" show={edges.bottom} />
    </div>
  )
}

function Edge({ side, show }) {
  const top = side === 'top'
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 h-6 transition-opacity duration-150 ${
        top ? 'top-0 bg-gradient-to-b' : 'bottom-0 bg-gradient-to-t'
      } from-bg-card to-transparent ${show ? 'opacity-100' : 'opacity-0'}`}
    />
  )
}
