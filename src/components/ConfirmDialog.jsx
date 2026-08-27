// Small centered confirmation dialog shared by destructive actions (deleting a
// task, deleting an event). One implementation keeps the look, colors and
// animation identical everywhere.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Löschen',
  cancelLabel = 'Abbrechen',
  onCancel,
  onConfirm,
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center px-8">
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onCancel} />
      <div className="relative w-full max-w-[320px] animate-fade-in rounded-card border border-subtle bg-bg-elevated p-5">
        <h3 className="text-[17px] font-bold text-text-primary">{title}</h3>
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
    </div>
  )
}
