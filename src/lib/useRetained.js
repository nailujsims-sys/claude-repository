import { useRef } from 'react'

// Returns the current value, or — while it is null/undefined — the last value
// that wasn't.
//
// Overlays now stay on screen while they animate out (G4), but the state that
// filled them is usually cleared the moment they are closed: `taskForm` goes
// null, so "Aufgabe bearbeiten" would flip to "Neue Aufgabe" halfway down the
// screen, and the event detail sheet would empty out while still visible.
// Holding the last real value keeps the exit showing what the user was
// actually looking at. On the next open the live value takes over immediately,
// so nothing stale can survive into a new session of the overlay.
export default function useRetained(value) {
  const last = useRef(value)
  if (value != null) last.current = value
  return value != null ? value : last.current
}
