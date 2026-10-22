import {
  CLIPBOARD_MESSAGES,
  CONVERSION_FAILED_MESSAGE,
  MAX_CONVERT_BYTES,
  MAX_SCREENSHOT_BYTES,
  clipboardFailure,
  convertibleType,
  pickClipboardType,
  validateScreenshot,
} from './trading'

// The two places a screenshot enters the app that need the browser itself:
// reading the clipboard on a button press, and turning an iOS format (HEIC,
// TIFF) into one the bucket accepts. The rules — which type to read, which
// message to show — are pure and live in src/lib/trading.js; this file only
// talks to the APIs. No dependency: decoding is the browser's own (Safari reads
// HEIC natively), encoding is a <canvas>.

// „Einfügen": the image on the clipboard, as { ok: true, file } or
// { ok: false, message }.
//
// THE ORDER MATTERS ON iOS. Safari only lets `clipboard.read()` run inside the
// user's tap, so it is called first and synchronously — no await, no check
// that could yield before it. Safari then shows its own small „Einfügen"
// bubble next to the button; that bubble IS the permission, there is no
// separate prompt and nothing for the app to draw. Tapping beside it rejects
// with NotAllowedError, which reads as "denied" below.
//
// Feature detection rather than user-agent sniffing: a browser without
// `clipboard.read` (older Firefox, some in-app browsers) gets the fallback
// sentence, whatever it calls itself. An installed iOS web app uses the same
// WebKit and the same bubble; if a version refuses there, it arrives as one
// of these same answers.
export async function readClipboardImage() {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
  if (!clipboard || typeof clipboard.read !== 'function') {
    const insecure = typeof window !== 'undefined' && window.isSecureContext === false
    return { ok: false, message: CLIPBOARD_MESSAGES[insecure ? 'insecure' : 'unsupported'] }
  }

  let items
  try {
    items = await clipboard.read()
  } catch (err) {
    return { ok: false, message: CLIPBOARD_MESSAGES[clipboardFailure(err)] }
  }

  for (const item of Array.from(items ?? [])) {
    const type = pickClipboardType(item?.types)
    if (!type) continue
    try {
      const blob = await item.getType(type)
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' }[type] ?? type.split('/')[1]
      return { ok: true, file: toFile(blob, `Screenshot.${ext}`, type) }
    } catch (err) {
      return { ok: false, message: CLIPBOARD_MESSAGES[clipboardFailure(err)] }
    }
  }
  return { ok: false, message: CLIPBOARD_MESSAGES.empty }
}

// Any incoming file → one the form can show and the bucket accepts, as
// { ok: true, file, type } or { ok: false, message }.
//
// A supported file passes untouched — the original bytes are what is stored,
// a chart is never re-encoded without need. An iOS format is decoded and
// written out as PNG (lossless, the right choice for a chart); only when that
// PNG would exceed the limit does it become a high-quality JPEG instead, so a
// large photo still fits. Anything else gets validation's own sentence.
export async function prepareScreenshot(file) {
  const verdict = validateScreenshot(file)
  if (verdict.ok) return { ok: true, file, type: verdict.type }

  const source = convertibleType(file)
  if (!source) return verdict
  if (typeof file.size === 'number' && file.size > MAX_CONVERT_BYTES) return verdict

  try {
    const canvas = await decodeToCanvas(file)
    const base = String(file.name || 'Screenshot').replace(/\.[^.]+$/, '')
    let blob = await canvasBlob(canvas, 'image/png')
    let type = 'image/png'
    if (blob.size > MAX_SCREENSHOT_BYTES) {
      blob = await canvasBlob(canvas, 'image/jpeg', 0.9)
      type = 'image/jpeg'
    }
    const converted = toFile(blob, `${base}.${type === 'image/png' ? 'png' : 'jpg'}`, type)
    const check = validateScreenshot(converted)
    return check.ok ? { ok: true, file: converted, type: check.type } : check
  } catch {
    return { ok: false, message: CONVERSION_FAILED_MESSAGE }
  }
}

const DECODE_TIMEOUT_MS = 10000

function toFile(blob, name, type) {
  if (typeof File === 'function') {
    try {
      return new File([blob], name, { type, lastModified: Date.now() })
    } catch {
      // Very old WebKit had no File constructor; the Blob is uploaded the same way.
    }
  }
  return Object.assign(blob, { name, lastModified: Date.now() })
}

async function decodeToCanvas(file) {
  if (typeof document === 'undefined') throw new Error('Kein Dokument zum Umwandeln.')
  let source
  let width
  let height
  let cleanup = () => {}
  if (typeof createImageBitmap === 'function') {
    source = await createImageBitmap(file)
    width = source.width
    height = source.height
    cleanup = () => source.close?.()
  } else {
    const url = URL.createObjectURL(file)
    cleanup = () => URL.revokeObjectURL(url)
    // Bounded: an image element that never reports back must not leave the
    // „Einfügen" button waiting for ever.
    source = await new Promise((resolve, reject) => {
      const img = new Image()
      const timer = setTimeout(() => reject(new Error('Bild nicht lesbar.')), DECODE_TIMEOUT_MS)
      img.onload = () => {
        clearTimeout(timer)
        resolve(img)
      }
      img.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Bild nicht lesbar.'))
      }
      img.src = url
    })
    width = source.naturalWidth
    height = source.naturalHeight
  }
  try {
    if (!width || !height) throw new Error('Bild ohne Größe.')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Kein Canvas.')
    ctx.drawImage(source, 0, 0)
    return canvas
  } finally {
    cleanup()
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') return reject(new Error('Kein toBlob.'))
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Leeres Bild.'))), type, quality)
  })
}
