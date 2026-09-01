import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const ToastContext = createContext(null)

// How long a toast stays. Two values, not a per-call argument: an actionable
// toast has to be read, decided on and reached, which 2s does not allow — and
// letting every call site pick its own number would turn a system value into a
// literal (§15/§16). The duration therefore follows from the payload.
export const TOAST_PLAIN_MS = 2000
export const TOAST_ACTION_MS = 5000

// How long the card takes to leave (G18). Mirrors the `toast-out` animation in
// tailwind.config.js: the toast is dropped when its exit has finished, not the
// moment its time is up.
export const TOAST_EXIT_MS = 180

// Lightweight top-of-screen toast. One slot: a new toast replaces the current
// one and restarts the timer.
//
// `options` may carry an action (G8):
//
//   showToast('Aufgabe gelöscht', { actionLabel: 'Rückgängig', onAction })
//
// The action is what makes a destructive step reversible instead of asking
// "Are you sure?" first (§18/§19). It is deliberately just a label and a
// callback: the toast knows nothing about tasks, and the caller keeps its own
// domain logic — so this stays one notification system, not two.
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const exit = useRef(null)

  // Retiring a toast is two steps (G18). It is first marked as `leaving`, so
  // ToastHost can play it out, and only dropped once that exit has run — a
  // toast that is simply removed when its time is up blinks away instead of
  // leaving, the one element in the app that arrives but never departs.
  //
  // The flag lives on the payload rather than in a presence machine per toast:
  // this provider has exactly one slot, and one slot with one flag is the whole
  // lifecycle. Deliberately so, because a machine keyed on "is there a toast?"
  // would swallow the replacement above — a new message would swap its text
  // with no motion at all instead of remounting into `toast-in`.
  //
  // Timer and dismissal share this path: an expiry and a tap on the action
  // leave the same way, and a second dismissal during the exit is a no-op.
  const dismissToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (exit.current) return
    setToast((t) => (t ? { ...t, leaving: true } : t))
    exit.current = setTimeout(() => {
      exit.current = null
      // Only a toast that is still the leaving one goes; anything raised in
      // the meantime has already cleared this timer and must survive it.
      setToast((t) => (t?.leaving ? null : t))
    }, TOAST_EXIT_MS)
  }, [])

  // A new toast takes the slot immediately, exit in progress or not: it carries
  // its own `id`, so it remounts and plays `toast-in` from the start, and the
  // live region announces it (§22). That is the behaviour the exit had to leave
  // untouched.
  const showToast = useCallback((message, options = {}) => {
    const { actionLabel = null, onAction = null } = options
    const action = actionLabel && onAction ? { actionLabel, onAction } : null
    if (timer.current) clearTimeout(timer.current)
    if (exit.current) clearTimeout(exit.current)
    exit.current = null
    setToast({ message, ...action, id: Date.now() })
    timer.current = setTimeout(
      dismissToast,
      action ? TOAST_ACTION_MS : TOAST_PLAIN_MS
    )
  }, [dismissToast])

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(exit.current)
    },
    []
  )

  return (
    <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
