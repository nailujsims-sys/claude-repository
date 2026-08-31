import { useToast } from '../context/ToastContext'

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
            className={`animate-toast-in flex max-w-full items-center rounded-btn bg-bg-elevated border border-subtle text-[14px] font-medium text-text-primary shadow-lg shadow-black/40 ${
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
