import { useEffect, useState } from 'react'

// Live pixel width of an element (ResizeObserver, with a resize-listener
// fallback). The Tag / Woche grids feed it into the event layout so the number
// of events placed next to each other follows the space that is actually there
// — on a 320px phone as well as on the 430px frame.
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return width
}
