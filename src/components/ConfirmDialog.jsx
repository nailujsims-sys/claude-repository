import { useId } from 'react'
import Overlay, { useOverlayPanel } from './Overlay'

// Small centered confirmation dialog shared by destructive actions (deleting a
// task, deleting an event). One implementation keeps the look, colors and
// animation identical everywhere.
//
// It keeps its own centered, fading appearance — it is not a sheet — but runs
// on the same presence lifecycle as every other overlay, so it fades out on
// close instead of blinking away (G4). Sitting above the sheet it can be
// opened from, it also takes Escape ahead of that sheet.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Löschen',
  cancelLabel = 'Abbrechen',
  onCancel,
  onConfirm,
}) {
  return (
    <Overlay open={open} onClose={onCancel} duration={200} z="z-[55]">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
        <Dialog
          title={title}
          message={message}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </div>
    </Overlay>
  )
}

function Dialog({ title, message, confirmLabel, cancelLabel, onCancel, onConfirm }) {
  const titleId = useId()
  const panel = useOverlayPanel(
    'ov-panel-fade',
    'pointer-events-auto relative w-full max-w-[320px] rounded-card border border-subtle bg-bg-elevated p-5'
  )

  return (
    <div {...panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-[17px] font-bold text-text-primary">
        {title}
      </h3>
      {message && (
        <p className="mt-2 text-[14px] leading-snug text-text-secondary">{message}</p>
      )}
      <div className="mt-5 flex gap-3">
        <button
          onClick={onCancel}
          className="press-tint flex-1 rounded-btn border border-subtle py-2.5 text-[15px] font-semibold text-text-secondary"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          className="press-tint flex-1 rounded-btn bg-danger py-2.5 text-[15px] font-semibold text-white"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
