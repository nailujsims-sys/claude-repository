import { useCallback, useEffect, useRef, useState } from 'react'
import { draggedTimes, pxToMin } from '../../lib/calendar'

// Direct-manipulation gestures for timed events on the Tag / Woche grids.
//
// Feel matches the Aufgaben list exactly: a normal tap opens the event, and a
// long-press (250ms, the same delay the task drag uses) "grabs" it. Once grabbed
// the event enters edit mode — it lifts and shows top/bottom handles:
//   • drag the body   → move it (change start, keep duration; in the week view
//                        dragging sideways moves it to another day)
//   • drag a handle   → change just the start or the end
// Each release saves immediately and stays in edit mode so adjustments can be
// chained; tapping elsewhere (or scrolling / navigating) leaves edit mode.
//
// The hook is attached to the columns element (`gridRef`) and hit-tests events
// by their data-ev-id / data-handle attributes, so both views wire it the same
// way. All the snapping/clamping is in lib/calendar.js (draggedTimes) and unit
// tested — this layer only turns pointer motion into a minute/day delta.

const LONG_PRESS_MS = 250
const TAP_SLOP = 8 // a press that moves less than this (before long-press) is a tap/scroll
const MOVE_SLOP = 6 // movement needed to start a body-move once already editing

export function useTimedGesture({ gridRef, columns = 1, resolveEvent, onCommit, onOpen }) {
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(null) // { id, start_at, end_at } during a drag
  const g = useRef(null) // live gesture state (never triggers renders)
  const editRef = useRef(null)
  const draftRef = useRef(null)
  editRef.current = editId
  draftRef.current = draft

  // Block page scrolling only while an event drag is actually in flight. React's
  // onPointerMove is passive, so preventing the scroll needs a non-passive native
  // touchmove listener; gating it on an active mode keeps normal grid scrolling
  // (and the long-press wait) untouched.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return undefined
    const onTouchMove = (e) => {
      const s = g.current
      if (s && (s.mode === 'move' || s.mode === 'start' || s.mode === 'end')) {
        e.preventDefault()
      }
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [gridRef])

  const applyEdit = (id) => {
    editRef.current = id
    setEditId(id)
  }
  const applyDraft = (d) => {
    draftRef.current = d
    setDraft(d)
  }
  const clearEdit = useCallback(() => applyEdit(null), [])

  const colAt = (clientX, rect) => {
    if (columns <= 1) return 0
    const w = rect.width / columns
    return Math.min(columns - 1, Math.max(0, Math.floor((clientX - rect.left) / w)))
  }

  const onPointerDown = (e) => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return
    const blockEl = e.target.closest?.('[data-ev-id]')
    if (!blockEl) {
      // Tap on empty grid → leave edit mode.
      if (editRef.current) clearEdit()
      return
    }
    const id = blockEl.getAttribute('data-ev-id')
    const ev = resolveEvent(id)
    if (!ev) return
    const handle = e.target.closest?.('[data-handle]')?.getAttribute('data-handle') || null
    const editingThis = editRef.current === id

    let mode
    if (handle) mode = handle // 'start' | 'end' — resize immediately
    else if (editingThis) mode = 'pending-move' // body of the editing event
    else mode = 'pending-longpress' // long-press to grab

    g.current = {
      id,
      ev,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startCol: colAt(e.clientX, rect),
      rect,
      moved: false,
      timer: null,
    }
    try {
      gridRef.current.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }

    if (mode === 'pending-longpress') {
      g.current.timer = setTimeout(() => {
        const s = g.current
        if (!s) return
        s.timer = null
        s.mode = 'move'
        s.moved = true
        applyEdit(s.id)
        applyDraft({ id: s.id, start_at: s.ev.start_at, end_at: s.ev.end_at })
      }, LONG_PRESS_MS)
    }
  }

  const track = (s, e) => {
    const deltaMin = pxToMin(e.clientY - s.startY)
    const dayShift = s.mode === 'move' && columns > 1 ? colAt(e.clientX, s.rect) - s.startCol : 0
    applyDraft({ id: s.id, ...draggedTimes(s.ev, s.mode, deltaMin, dayShift) })
  }

  const onPointerMove = (e) => {
    const s = g.current
    if (!s) return
    const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY)

    if (s.mode === 'pending-longpress') {
      // Moving before the long-press fires means the user is scrolling — abort.
      if (dist > TAP_SLOP) {
        clearTimeout(s.timer)
        g.current = null
      }
      return
    }
    if (s.mode === 'pending-move') {
      if (dist < MOVE_SLOP) return
      s.mode = 'move'
    }
    e.preventDefault()
    s.moved = true
    track(s, e)
  }

  const finish = (commit) => {
    const s = g.current
    g.current = null
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    const d = draftRef.current
    applyDraft(null)

    if (s.mode === 'pending-longpress') {
      onOpen?.(s.ev) // a plain tap opens the detail
      return
    }
    if (s.mode === 'pending-move') {
      clearEdit() // a tap on the editing event leaves edit mode
      return
    }
    if (
      commit &&
      s.moved &&
      d &&
      (d.start_at !== s.ev.start_at || d.end_at !== s.ev.end_at)
    ) {
      onCommit?.(s.id, { start_at: d.start_at, end_at: d.end_at }, s.mode)
    }
    // Otherwise stay in edit mode (editId keeps the id) for further tweaks.
  }

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
  }

  return { editId, draft, clearEdit, handlers }
}
