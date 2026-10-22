import { useRef } from 'react'
import { ClipboardPaste, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { SCREENSHOT_ACCEPT } from '../../lib/trading'

// The screenshot slot at the top of the setup form.
//
// Empty, it is one dashed drop zone with the two ways in that work on every
// device as real buttons inside it: „Einfügen" reads a copied screenshot
// straight from the clipboard (the iPhone way: screenshot → Kopieren → here,
// one tap), „Fotos auswählen" opens the system picker (on a phone that is the
// sheet with Fotomediathek and Dateien — no `capture` attribute, so the camera
// is offered but never forced). Both are 44 px tall and sit in the middle of
// the zone, where a thumb reaches them. A click on the rest of the zone still
// opens the picker, as before.
//
// Dropping and pasting (Strg+V / Cmd+V) are handled by the form for the WHOLE
// sheet, not by this box: a screenshot dropped a few pixels beside the zone,
// or pasted while the name field has focus, is still obviously meant as the
// screenshot. On iOS the same applies to a picture carried over from Fotos.
//
// Filled, it shows the whole image — `object-contain`, never cropped, at most
// half the screen high so the fields stay reachable — with „Einfügen",
// „Ersetzen" and „Entfernen" directly beneath it.
export default function ScreenshotField({
  previewUrl,
  error,
  dragActive,
  onPick,
  onPaste,
  onRemove,
  pasting = false,
  disabled = false,
}) {
  const inputRef = useRef(null)
  const openPicker = () => inputRef.current?.click()
  const fine = finePointer()

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

  const pasteButton = (className) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onPaste()
      }}
      disabled={disabled || pasting}
      aria-busy={pasting}
      data-paste-button=""
      className={`press-tint flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn text-ui font-semibold text-text-primary disabled:opacity-60 ${className}`}
    >
      <ClipboardPaste size={16} /> Einfügen
    </button>
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
            {pasteButton('bg-bg-input')}
            <button
              type="button"
              onClick={openPicker}
              disabled={disabled}
              className="press-tint flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn bg-bg-input text-ui font-semibold text-text-primary"
            >
              <RefreshCw size={16} /> Ersetzen
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              className="press-tint flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn bg-bg-input text-ui font-semibold text-danger"
            >
              <Trash2 size={16} /> Entfernen
            </button>
          </div>
        </div>
      ) : (
        // Not a <button>: it holds two. The zone stays clickable for the
        // picker; keyboard and screen-reader users reach both actions through
        // the real buttons inside it.
        <div
          onClick={() => !disabled && openPicker()}
          data-drop-zone=""
          className={`flex min-h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-5 py-6 text-center transition-colors motion-reduce:transition-none ${
            dragActive ? 'border-accent bg-accent/10' : 'border-white/10 bg-bg-input'
          }`}
        >
          <ImagePlus size={28} className={dragActive ? 'text-accent' : 'text-text-secondary'} />
          <span className="text-body font-semibold text-text-primary">
            {dragActive ? 'Loslassen, um den Screenshot einzufügen' : 'Screenshot hinzufügen'}
          </span>
          {!dragActive && (
            <>
              <Hint fine={fine} />
              <div className="mt-2 flex w-full max-w-[320px] gap-2">
                {pasteButton('bg-bg-elevated')}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openPicker()
                  }}
                  disabled={disabled}
                  className="press-tint flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn bg-bg-elevated text-ui font-semibold text-text-primary"
                >
                  <ImagePlus size={16} /> {fine ? 'Datei auswählen' : 'Fotos auswählen'}
                </button>
              </div>
              <span className="text-caption text-text-muted">PNG, JPG oder WebP · bis 10 MB</span>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="mt-2 px-1 text-caption text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function finePointer() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}

// What the zone promises depends on the device: a desktop learns about drag &
// drop and the shortcut with its own modifier key, a phone about copying the
// screenshot first.
function Hint({ fine }) {
  const mac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
  return (
    <span className="text-caption text-text-secondary">
      {fine
        ? `Hierher ziehen oder mit ${mac ? '⌘V' : 'Strg+V'} einfügen`
        : 'Screenshot kopieren und einfügen – oder aus deinen Fotos wählen'}
    </span>
  )
}
