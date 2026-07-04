import { useEffect, useState } from 'react'

// Ticking clock for the calendar's live "now" indicator. Re-renders on a fixed
// interval (default 30s — enough to move the red time line smoothly) and also
// resyncs whenever the tab becomes visible again, so a backgrounded app snaps
// back to the correct time on return.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])

  return now
}
