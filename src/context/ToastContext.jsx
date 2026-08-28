import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  dismissToast,
  expireToast,
  initialToastState,
  pushToast,
  takeToastAction,
} from '../lib/toastState'

const ToastContext = createContext(null)

// Lightweight top-of-screen toast, one slot. `showToast(message)` still behaves
// exactly as it always did; passing `{ actionLabel, onAction }` adds an undo
// button and stretches the toast to 5s (G8).
//
// All the decisions live in `src/lib/toastState.js`; this is the React shell
// around them — state, the timer, and running the action safely.
export function ToastProvider({ children }) {
  const [state, setState] = useState(initialToastState)
  // The state as of the last call, not as of the last render: two toasts raised
  // in the same tick must still get two different ids.
  const stateRef = useRef(state)

  const apply = useCallback((next) => {
    stateRef.current = next
    setState(next)
  }, [])

  const showToast = useCallback(
    (message, options) => apply(pushToast(stateRef.current, message, options)),
    [apply]
  )

  const hideToast = useCallback(
    () => apply(dismissToast(stateRef.current)),
    [apply]
  )

  const runToastAction = useCallback(
    (id) => {
      const { state: next, action } = takeToastAction(stateRef.current, id)
      apply(next)
      if (!action) return
      // Undo goes through the normal optimistic mutation, which rejects if the
      // repository does. That surfaces through ErrorBanner already, so it is
      // swallowed here rather than becoming an unhandled rejection out of a
      // click handler.
      try {
        Promise.resolve(action()).catch(() => {})
      } catch {
        /* a synchronous throw from the undo must not take the toast down with it */
      }
    },
    [apply]
  )

  // One timer, armed for the toast actually on screen. Replacing the toast
  // changes `state.toast`, so the cleanup clears the old timer before the new
  // one is armed — and `expireToast` refuses a stale id even if one slipped
  // through.
  useEffect(() => {
    const current = state.toast
    if (!current) return undefined
    const timer = setTimeout(() => {
      apply(expireToast(stateRef.current, current.id))
    }, current.duration)
    return () => clearTimeout(timer)
  }, [state.toast, apply])

  return (
    <ToastContext.Provider
      value={{ toast: state.toast, showToast, hideToast, runToastAction }}
    >
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
