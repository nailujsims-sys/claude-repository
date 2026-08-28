import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  CLOSED,
  ENTERING,
  EXITING,
  OPEN_EVENT,
  CLOSE_EVENT,
  PRIMED,
  EXITED,
  nextPhase,
  isMounted,
  isActive,
  escapeStack,
  focusStack,
} from '../lib/overlayPresence'
import { focusablesIn, wrapTab } from '../lib/focusTrap'
import { lockScroll, unlockScroll } from '../lib/scrollLock'

// How long after the nominal duration we stop waiting for `transitionend`.
// The event is the primary signal; this only covers the cases where it never
// arrives — a panel whose transition is suppressed, a tab that was backgrounded
// mid-exit, `prefers-reduced-motion` with transitions off at the OS level.
const FALLBACK_SLACK = 120

const OverlayContext = createContext(null)

/**
 * Drives an overlay's mount lifecycle (see src/lib/overlayPresence.js) and
 * hands back everything a panel needs to animate itself:
 *
 *   mounted  — keep rendering while this is true, even after `open` went false
 *   phase    — closed | entering | open | exiting
 *   style    — carries `--ov-dur` so panel and backdrop share one duration
 *   panel()  — props for the animating element
 *
 * Most overlays get this through <Overlay>. The calendar search uses it
 * directly: it wants the lifecycle but not the backdrop and phone-frame column.
 */
export function usePresence(open, { duration = 300, onEscape = null } = {}) {
  const [phase, setPhase] = useState(CLOSED)
  const send = (event) => setPhase((p) => nextPhase(p, event))
  const panelRef = useRef(null)
  const restoreRef = useRef(null)

  useEffect(() => {
    // Remember what to hand focus back to (G13). This runs on the render where
    // `open` flipped true, and at that point `phase` is still `closed`, so the
    // panel is not mounted yet and nothing — including an `autoFocus` field
    // inside it — has moved focus away from the trigger.
    if (open) restoreRef.current = document.activeElement
    send(open ? OPEN_EVENT : CLOSE_EVENT)
  }, [open])

  // Let the browser paint the closed position before switching to the open
  // one, so the transition has a start value to interpolate from. Two frames:
  // a single rAF can still run before the paint it was meant to follow.
  useEffect(() => {
    if (phase !== ENTERING) return
    let second
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => send(PRIMED))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== EXITING) return
    const t = setTimeout(() => send(EXITED), duration + FALLBACK_SLACK)
    return () => clearTimeout(t)
  }, [phase, duration])

  // Escape closes the topmost overlay only — and an overlay already on its way
  // out is no longer topmost, so a second Escape reaches the one underneath
  // instead of closing two at once.
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  const entryRef = useRef(null)
  if (entryRef.current === null) entryRef.current = {}

  const hasEscape = !!onEscape
  const listens = isActive(phase)
  useEffect(() => {
    if (!hasEscape || !listens) return
    const entry = entryRef.current
    const remove = escapeStack.push(entry)
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (!escapeStack.claim(entry, e)) return
      escapeRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      remove()
    }
  }, [hasEscape, listens])

  // ── Scroll lock (G14) ─────────────────────────────────────────────────────
  //
  // Held for as long as the overlay is in the DOM, which deliberately includes
  // `exiting`: the panel is still on screen for those 300ms, and releasing at
  // the start of the exit would let the page slide underneath it. That is one
  // phase longer than the focus trap below, which hands control back the moment
  // the overlay starts leaving. Nesting is handled by the refcount in
  // scrollLock.js, not here.
  const mounted = isMounted(phase)
  useEffect(() => {
    if (!mounted) return
    lockScroll()
    return unlockScroll
  }, [mounted])

  // ── Focus (G13) ───────────────────────────────────────────────────────────
  //
  // Ownership follows the same "topmost wins" rule as Escape, through a second
  // instance of the same stack: while a ConfirmDialog is up, the sheet beneath
  // it stops trapping, and gets its trap back the moment the dialog leaves.
  // An overlay on its way out has already handed control back — `isActive`.
  const focusEntryRef = useRef(null)
  if (focusEntryRef.current === null) focusEntryRef.current = {}

  useEffect(() => {
    if (!listens) return
    return focusStack.push(focusEntryRef.current)
  }, [listens])

  // Initial focus goes to the panel container, never to the first control.
  // On a phone, focusing a control would open the on-screen keyboard where no
  // keyboard opens today; the container gives a keyboard user a starting point
  // and costs a touch user nothing. The three deliberate `autoFocus` fields
  // (TaskForm, EventForm, calendar search) have already claimed focus by now,
  // and the `contains` check leaves them alone.
  useEffect(() => {
    if (phase !== ENTERING) return
    const panel = panelRef.current
    if (!panel || panel.contains(document.activeElement)) return
    panel.focus({ preventScroll: true })
  }, [phase])

  useEffect(() => {
    if (!listens) return
    const onKey = (e) => {
      if (e.key !== 'Tab') return
      if (!focusStack.isTop(focusEntryRef.current)) return
      const panel = panelRef.current
      if (!panel) return
      const nodes = focusablesIn(panel)
      const active = document.activeElement
      const target = wrapTab({
        count: nodes.length,
        index: nodes.indexOf(active),
        onPanel: active === panel,
        shiftKey: e.shiftKey,
      })
      if (!target) return
      e.preventDefault()
      const el =
        target === 'panel' ? panel : target === 'first' ? nodes[0] : nodes[nodes.length - 1]
      el?.focus({ preventScroll: true })
    }
    // Capture, so the wrap is decided before anything inside the panel sees
    // the key — the trap only ever redirects Tab, it never swallows a keypress
    // a control was going to act on.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [listens])

  // Hand focus back once the overlay is gone, so it lands on the trigger rather
  // than on a detached node. For a nested overlay the trigger is the panel of
  // the overlay underneath, which is how focus returns into a sheet after its
  // ConfirmDialog closes.
  //
  // Only when nobody else has claimed focus in the meantime. One overlay can
  // hand straight over to another — the action sheet closes as the task form
  // opens — and the sheet's exit finishes last. Restoring unconditionally would
  // pull focus off the form's `autoFocus` field and back onto the button that
  // opened the sheet. Focus resting on `body` is the signal that the closing
  // overlay is still the one holding it.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (listens) {
      wasActiveRef.current = true
      return
    }
    if (phase !== CLOSED || !wasActiveRef.current) return
    wasActiveRef.current = false
    const el = restoreRef.current
    restoreRef.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    if (el && el.isConnected && typeof el.focus === 'function') {
      el.focus({ preventScroll: true })
    }
  }, [listens, phase])

  const handleTransitionEnd = (e) => {
    // Only the panel's own movement ends the exit — never a transition
    // bubbling up from inside it (a toggle knob, a nested dialog's panel).
    if (e.target !== e.currentTarget) return
    if (e.propertyName !== 'transform' && e.propertyName !== 'opacity') return
    send(EXITED)
  }

  const panel = (motion, className = '') => ({
    ref: panelRef,
    // Focusable only programmatically: it takes the initial focus and is the
    // wrap target when a panel holds no controls, but never joins the tab
    // order — and G3's focus ring deliberately skips `[tabindex="-1"]`, so
    // taking focus here paints nothing.
    tabIndex: -1,
    className: `ov-panel ${motion} ${className}`.trim(),
    'data-phase': phase,
    // React 18 doesn't know `inert`; an empty string renders the bare
    // attribute, a boolean would warn. `undefined` omits it entirely.
    inert: phase === EXITING ? '' : undefined,
    onTransitionEnd: handleTransitionEnd,
  })

  return { phase, mounted, style: { '--ov-dur': `${duration}ms` }, panel }
}

/** Props for the element that actually animates. Call inside <Overlay>. */
export function useOverlayPanel(motion, className) {
  return useContext(OverlayContext).panel(motion, className)
}

// Shared overlay scaffolding: a full-screen dim backdrop plus a column
// constrained to the phone-frame width, so panels (sheets, sidebar) stay
// aligned with the app on desktop. Children position themselves within the
// column and should set `pointer-events-auto`.
//
// The overlay now stays mounted until its exit animation has finished, so the
// panel inside can animate out instead of disappearing. Panels read their
// phase from the context rather than through props — see useOverlayPanel.
export default function Overlay({
  open,
  onClose,
  children,
  align = 'center',
  duration = 300,
  z = 'z-50',
}) {
  const presence = usePresence(open, { duration, onEscape: onClose })

  if (!presence.mounted) return null

  return (
    <OverlayContext.Provider value={presence}>
      <div
        className={`ov-root fixed inset-0 ${z}`}
        data-phase={presence.phase}
        style={presence.style}
      >
        <div
          className="ov-backdrop absolute inset-0 bg-black/60"
          data-phase={presence.phase}
          onClick={onClose}
          aria-hidden
        />
        <div
          className={`absolute inset-0 flex ${
            align === 'left' ? 'justify-start' : 'justify-center'
          } pointer-events-none`}
        >
          <div className="relative w-full max-w-app h-full pointer-events-none">
            {children}
          </div>
        </div>
      </div>
    </OverlayContext.Provider>
  )
}
