import { useEffect, useRef } from 'react'
import { useToast } from '../context/ToastContext'
import { toastScope } from '../lib/toastScope'

// Renders the active toast near the top of the frame.
//
// The wrapper stays mounted even with nothing to show, so the live region
// exists *before* a message arrives — a `role="status"` that appears together
// with its own content is not reliably announced (§22).
//
// Pointer events follow the payload: a plain toast must keep letting taps
// through to the header underneath it, while an actionable one has a button
// that has to be hittable. So `pointer-events-auto` is on the card, and only
// when there is an action.
export default function ToastHost() {
  const { toast, dismissToast } = useToast()
  const actionable = !!(toast && toast.actionLabel && toast.onAction)

  // The card is on its way out (G18): still on screen, no longer a control.
  // It keeps its action rendered — dropping the button mid-exit would resize
  // the card while it leaves — and stops being one through `inert`.
  const leaving = !!toast?.leaving

  // An actionable toast joins the focus scope of whichever overlay is the
  // active surface (G21) — it floats above the panel, so being reachable by
  // pointer but not by Tab is the one thing it must not be. A plain toast
  // stays out: it is a message, not a control.
  //
  // Registered from an effect rather than through the ref itself, because the
  // cleanup then runs *after* the card has left the DOM. That ordering is what
  // lets the overlay see the focus has fallen to <body> and take it back; a
  // ref detached before the removal would still report the old focus.
  //
  // A leaving card stays registered for exactly that reason — the departure is
  // announced when it goes, not when it starts going. It is out of the scope
  // long before then: `focusableWithin` in Overlay.jsx filters `[inert]`, so an
  // exiting toast contributes nothing to walk, the same way a leaving panel
  // does not.
  const cardRef = useRef(null)
  useEffect(() => {
    if (!actionable) return
    return toastScope.register(cardRef.current)
  }, [actionable, toast?.id])

  // Retire the toast first, then run the action: both land in the same React
  // batch, so a follow-up toast raised by the action wins over the dismiss.
  const handleAction = () => {
    dismissToast()
    toast.onAction()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
    >
      <div className="w-full max-w-app flex justify-center px-5 pt-3">
        {toast && (
          <div
            key={toast.id}
            ref={cardRef}
            // React 18 doesn't know `inert`; an empty string renders the bare
            // attribute, a boolean would warn. Same as the exiting overlay
            // panel in Overlay.jsx.
            inert={leaving ? '' : undefined}
            className={`${
              leaving ? 'animate-toast-out' : 'animate-toast-in'
            } flex max-w-full items-center rounded-btn bg-bg-elevated border border-subtle text-[14px] font-medium text-text-primary shadow-lg shadow-black/40 ${
              actionable ? 'pointer-events-auto py-0.5 pl-4 pr-1' : 'px-4 py-2.5'
            }`}
          >
            <span className="min-w-0">{toast.message}</span>
            {actionable && (
              <button
                onClick={handleAction}
                className="press-tint ml-2 min-h-[44px] shrink-0 rounded-btn px-3 text-[14px] font-semibold text-accent"
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
