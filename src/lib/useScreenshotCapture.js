import { useEffect, useRef, useState } from 'react'
import { fileFromTransfer, screenshotFromPaste, transferMayCarryFiles } from './trading'

// Drag & drop and Strg+V / Cmd+V for a screenshot, on the whole page, for as
// long as `enabled` is true. Used by the setup form (the screenshot goes into
// the slot) and by the library (the screenshot opens a new setup with it).
//
// Listening on the document rather than on the drop zone is the point: on a
// desktop a screenshot is dropped roughly where the window is, and pasted
// wherever the focus happens to be. Which paste is meant as text and which as
// the screenshot is decided by `screenshotFromPaste` (src/lib/trading.js) —
// typing or pasting text into a field keeps working exactly as before.
//
// It also stops the browser's own reaction to a dropped file — navigating away
// from the app to show it — anywhere on the page while enabled. Outside the
// module nothing changes: the listeners exist only while `enabled`.
//
// The same handlers serve Safari on iOS, where a picture held in Fotos and
// carried over with a second finger arrives as these very events — there is
// no touch emulation here, only the browser's own drag & drop. What differs
// is how much a drag reveals before the drop; `transferMayCarryFiles` takes
// that into account.
//
// `onFile` is read through a ref, so a new callback every render does not
// re-register the listeners.
export default function useScreenshotCapture({ enabled, onFile }) {
  const [dragActive, setDragActive] = useState(false)
  const latest = useRef(onFile)
  useEffect(() => {
    latest.current = onFile
  }, [onFile])

  useEffect(() => {
    if (!enabled) {
      setDragActive(false)
      return undefined
    }
    // dragenter/dragleave fire for every child crossed; a counter is the
    // reliable way to know when the file has really left the window.
    let depth = 0

    const onDragEnter = (e) => {
      if (!transferMayCarryFiles(e.dataTransfer)) return
      e.preventDefault()
      depth += 1
      setDragActive(true)
    }
    const onDragOver = (e) => {
      if (!transferMayCarryFiles(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e) => {
      if (!transferMayCarryFiles(e.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = (e) => {
      // Decided by what actually arrived, not by what the drag announced: on
      // iOS the file is only readable now.
      const file = fileFromTransfer(e.dataTransfer)
      if (!file && !transferMayCarryFiles(e.dataTransfer)) return
      e.preventDefault()
      depth = 0
      setDragActive(false)
      if (file) latest.current?.(file)
    }
    const onPaste = (e) => {
      const file = screenshotFromPaste(e.clipboardData, e.target)
      if (!file) return
      e.preventDefault()
      latest.current?.(file)
    }

    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('paste', onPaste)
    }
  }, [enabled])

  return { dragActive }
}
