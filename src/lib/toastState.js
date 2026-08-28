// Toast state, as pure functions (G8).
//
// The toast is a single slot: a new message replaces whatever is on screen.
// That was already true, but it becomes load-bearing once a toast can carry an
// undo — a stale timer must never close the toast that replaced its own, and an
// undo must never run twice. Both are decided here rather than in the React
// layer, so `tools/toastLogic.mjs` can check them without a browser.
//
// Every transition is keyed by the toast's id. Ids come from a counter, not
// from `Date.now()`, so two toasts raised in the same millisecond are still
// distinguishable — the previous implementation used a timestamp and could
// hand out the same id twice.

// A plain message is a glance; one carrying an undo has to be read, aimed at
// and hit, and it sits at the top of the frame, away from the thumb.
export const TOAST_DURATION = 2000
export const TOAST_ACTION_DURATION = 5000

export function initialToastState() {
  return { toast: null, seq: 0 }
}

// An action needs both halves to be usable: a handler with no label cannot be
// reached, and a label with no handler is a button that does nothing. Either
// one alone degrades to a plain message rather than rendering a dead control.
export function normalizeAction(options) {
  if (!options) return null
  const { actionLabel, onAction } = options
  if (typeof onAction !== 'function') return null
  if (typeof actionLabel !== 'string' || actionLabel.trim() === '') return null
  return { actionLabel, onAction }
}

export function pushToast(state, message, options) {
  const action = normalizeAction(options)
  const seq = state.seq + 1
  return {
    seq,
    toast: {
      id: seq,
      message,
      actionLabel: action ? action.actionLabel : null,
      onAction: action ? action.onAction : null,
      duration: action ? TOAST_ACTION_DURATION : TOAST_DURATION,
    },
  }
}

// Returns the same object when there is nothing to dismiss, so a repeated
// dismiss cannot cause a render.
export function dismissToast(state) {
  if (!state.toast) return state
  return { ...state, toast: null }
}

// The guard that makes replacement safe: a timer armed for toast 3 is ignored
// once toast 4 is on screen.
export function expireToast(state, id) {
  if (!state.toast || state.toast.id !== id) return state
  return { ...state, toast: null }
}

// Taking the action both closes the toast and hands back the callback to run.
// Because the toast is gone afterwards, a second call — a double tap, or a
// click on a toast that has since been replaced — finds nothing and returns
// null: the undo can only ever happen once.
export function takeToastAction(state, id) {
  const current = state.toast
  if (!current || current.id !== id || !current.onAction) {
    return { state, action: null }
  }
  return { state: { ...state, toast: null }, action: current.onAction }
}
