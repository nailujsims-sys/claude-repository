import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const ToastContext = createContext(null)

// How long a toast stays. Two values, not a per-call argument: an actionable
// toast has to be read, decided on and reached, which 2s does not allow — and
// letting every call site pick its own number would turn a system value into a
// literal (§15/§16). The duration therefore follows from the payload.
export const TOAST_PLAIN_MS = 2000
export const TOAST_ACTION_MS = 5000

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

  const showToast = useCallback((message, options = {}) => {
    const { actionLabel = null, onAction = null } = options
    const action = actionLabel && onAction ? { actionLabel, onAction } : null
    if (timer.current) clearTimeout(timer.current)
    setToast({ message, ...action, id: Date.now() })
    timer.current = setTimeout(
      () => setToast(null),
      action ? TOAST_ACTION_MS : TOAST_PLAIN_MS
    )
  }, [])

  const dismissToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setToast(null)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

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
