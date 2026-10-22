import { useRef } from 'react'
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { SCREENSHOT_ACCEPT } from '../../lib/trading'

// The screenshot slot at the top of the setup form.
//
// Empty, it is one large target: a tap or click opens the file picker (on a
// phone that is the system sheet with Fotos and Dateien — no `capture`
// attribute, so the camera is offered but never forced), and on a desktop the
// lines underneath say that dropping and pasting work too. Dropping and
// pasting themselves are handled by the form for the WHOLE sheet, not by this
// box: a screenshot dropped a few pixels beside the zone, or pasted while the
// name field has focus, is still obviously meant as the screenshot.
//
// Filled, it shows the whole image — `object-contain`, never cropped, at most
// half the screen high so the fields stay reachable — with "Ersetzen" and
// "Entfernen" directly beneath it.
export default function ScreenshotField({ previewUrl, error, dragActive, onPick, onRemove, disabled = false }) {
  const inputRef = useRef(null)
  const openPicker = () => inputRef.current?.click()

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={SCREENSHOT_ACCEPT}
      className="hidden"
      aria-hidden
      tabIndex={-1}
      data-screenshot-input=""
      onChange={(e) => {
        const file = e.target.files?.[0]
        // Cleared so picking the same file again after "Entfernen" still fires.
        e.target.value = ''
        if (file) onPick(file)
      }}
    />
  )

  return (
    <div>
      {input}
      {previewUrl ? (
        <div>
          <div
            className={`overflow-hidden rounded-card border bg-bg-base transition-colors motion-reduce:transition-none ${
              dragActive ? 'border-accent' : 'border-subtle'
            }`}
          >
            <img
              src={previewUrl}
              alt="Vorschau des Screenshots"
              draggable={false}
              className="block max-h-[50vh] w-full object-contain"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={openPicker}
              disabled={disabled}
              className="press-tint flex flex-1 items-center justify-center gap-2 rounded-btn bg-bg-input py-3 text-ui font-semibold text-text-primary"
            >
              <RefreshCw size={16} /> Ersetzen
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              className="press-tint flex flex-1 items-center justify-center gap-2 rounded-btn bg-bg-input py-3 text-ui font-semibold text-danger"
            >
              <Trash2 size={16} /> Entfernen
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          data-drop-zone=""
          className={`press-tint flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-5 py-8 text-center transition-colors motion-reduce:transition-none ${
            dragActive ? 'border-accent bg-accent/10' : 'border-white/10 bg-bg-input'
          }`}
        >
          <ImagePlus size={28} className={dragActive ? 'text-accent' : 'text-text-secondary'} />
          <span className="text-body font-semibold text-text-primary">
            {dragActive ? 'Loslassen, um den Screenshot einzufügen' : 'Screenshot hinzufügen'}
          </span>
          {!dragActive && <Hint />}
        </button>
      )}
      {error && (
        <p className="mt-2 px-1 text-caption text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// What the zone promises depends on the device: a desktop learns about drag &
// drop and the shortcut with its own modifier key, a phone about its photos.
function Hint() {
  const fine =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const mac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
  return (
    <span className="text-caption text-text-secondary">
      {fine
        ? `Hierher ziehen, mit ${mac ? '⌘V' : 'Strg+V'} einfügen oder Datei auswählen`
        : 'Foto oder Datei auswählen'}
      <span className="mt-0.5 block text-text-muted">PNG, JPG oder WebP · bis 10 MB</span>
    </span>
  )
}
