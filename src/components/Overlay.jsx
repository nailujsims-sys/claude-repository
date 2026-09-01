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
  acceptsEscape,
  overlayStack,
} from '../lib/overlayPresence'
import {
  FOCUSABLE_SELECTOR,
  initialFocus,
  nextFocus,
  shouldRestore,
} from '../lib/focusScope'
import { scrollLock } from '../lib/scrollLock'

// How long after the nominal duration we stop waiting for `transitionend`.
// The event is the primary signal; this only covers the cases where it never
// arrives — a panel whose transition is suppressed, a tab that was backgrounded
// mid-exit, `prefers-reduced-motion` with transitions off at the OS level.
const FALLBACK_SLACK = 120

const OverlayContext = createContext(null)

// The focusable elements inside a scope, in tab order. `[inert]` is filtered
// out rather than left to the browser: a panel on its way out carries the
// attribute (see `panel()` below), and a leaving panel must not be a Tab stop
// even while it is still on screen.
function focusableWithin(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('hidden') && !el.closest('[inert]')
  )
}

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
 *
 * `modal` is what separates the two. <Overlay> passes it; the calendar search
 * does not, and stays exactly what it is — a full-screen view that covers the
 * calendar rather than a dialog over it, with no backdrop, no trapped focus and
 * no locked page behind it. Everything G13 and G14 add hangs off this flag, so
 * a non-modal presence keeps the behaviour it had before them.
 */
export function usePresence(
  open,
  { duration = 300, onEscape = null, modal = false, rootRef = null } = {}
) {
  const [phase, setPhase] = useState(CLOSED)
  const send = (event) => setPhase((p) => nextPhase(p, event))

  useEffect(() => {
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

  // The overlay's place in the stack. `listens` is the phase window in which it
  // is the active surface — an overlay already on its way out has handed
  // control back and must not answer a key a second time. Registration is
  // deliberately unconditional: the stack answers "who is on top?" for Escape,
  // for the focus trap and for the scroll lock alike, so an overlay without an
  // `onEscape` still has to be in it.
  const entryRef = useRef(null)
  if (entryRef.current === null) entryRef.current = {}

  const listens = acceptsEscape(phase)
  useEffect(() => {
    if (!listens) return
    return overlayStack.push(entryRef.current)
  }, [listens])

  // Escape closes the topmost overlay only, so a second Escape reaches the one
  // underneath instead of closing two at once. Declared after the registration
  // effect on purpose: effects run in order, so the entry is on the stack
  // before this listener can be asked to claim anything.
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  const hasEscape = !!onEscape
  useEffect(() => {
    if (!hasEscape || !listens) return
    const entry = entryRef.current
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (!overlayStack.claim(entry, e)) return
      escapeRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasEscape, listens])

  // ── Focus scope (G13) ─────────────────────────────────────────────────
  // The panel takes the focus when it opens and gives it back when it closes.
  // Bound to `mounted`, not to `listens`, so the whole exit runs inside one
  // effect: reopening mid-exit (G4's `exiting + open → open`) never leaves this
  // window, so it neither re-focuses nor restores — the sheet simply keeps the
  // focus it already had.
  //
  // The decisions are in src/lib/focusScope.js; this only reads and writes the
  // DOM. `preventScroll` throughout: the trigger of an overlay generally sits
  // in a scroll container, and handing the focus back must not scroll the page
  // underneath a panel that is still on screen.
  const mounted = isMounted(phase)
  useEffect(() => {
    if (!modal || !mounted) return
    const root = rootRef?.current
    const doc = root?.ownerDocument
    if (!root || !doc) return

    // Whatever had the focus when the overlay opened — the button that opened
    // it, in every case the app has today.
    const returnTo = doc.activeElement
    const target = initialFocus({
      elements: focusableWithin(root),
      // A sheet may have focused itself already: React applies `autoFocus`
      // during the commit, so the Neue-Aufgabe title field holds the focus by
      // the time this effect runs, and overruling it would be worse than
      // leaving it alone.
      focusAlreadyInside: !!doc.activeElement && root.contains(doc.activeElement),
    })
    // Nothing focusable at all still needs somewhere to stand, or the very
    // next Tab would start at the top of the document again — the root itself
    // is `tabIndex={-1}` for exactly this.
    ;(target || root).focus?.({ preventScroll: true })

    return () => {
      const active = doc.activeElement
      const current = rootRef?.current
      const restore = shouldRestore({
        activeInsideRoot: !!(current && active && current.contains(active)),
        activeIsBody: !active || active === doc.body,
        targetConnected: !!returnTo?.isConnected,
      })
      if (restore) returnTo.focus?.({ preventScroll: true })
    }
  }, [modal, mounted, rootRef])

  // ── Scroll lock (G14) ─────────────────────────────────────────────────
  // Held for as long as the overlay is on screen — `mounted`, not `listens`,
  // so the page is still locked while a sheet slides out. That window matters:
  // `.ov-root` drops its pointer events while exiting (see src/index.css) so
  // the trigger underneath is reachable again, and without the lock a gesture
  // in those 300ms would scroll the page behind the leaving panel.
  //
  // Keyed on the same boolean as the focus scope, which is what keeps the
  // count balanced across G4's `exiting + open → open` edge: reopening mid-exit
  // never leaves the mounted window, so the effect does not re-run and the lock
  // is held exactly once throughout.
  useEffect(() => {
    if (!modal || !mounted) return
    return scrollLock.acquire()
  }, [modal, mounted])

  // Tab stays inside the active overlay (G13). Same "topmost only" rule the
  // Escape listener uses, and for the same reason: a ConfirmDialog opened from
  // a sheet is a DOM *descendant* of that sheet, so the background cannot be
  // made unreachable by setting `inert` on it — that would take the dialog with
  // it. Asking the stack who is on top instead is correct by construction: the
  // sheet stops trapping the moment the dialog registers above it, and starts
  // again when the dialog is gone.
  //
  // Only the two edges are claimed (see nextFocus); everything in between stays
  // the browser's. Pointer events are never touched — a tap behind the panel is
  // already the backdrop's business, and G5's drag must keep every event it has.
  useEffect(() => {
    if (!modal || !listens) return
    const entry = entryRef.current
    const onKey = (e) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      if (!overlayStack.isTop(entry)) return
      const root = rootRef?.current
      if (!root) return
      const doc = root.ownerDocument
      const target = nextFocus({
        elements: focusableWithin(root),
        current: doc.activeElement,
        backwards: e.shiftKey,
      })
      if (!target) return
      e.preventDefault()
      target.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, listens, rootRef])

  const handleTransitionEnd = (e) => {
    // Only the panel's own movement ends the exit — never a transition
    // bubbling up from inside it (a toggle knob, a nested dialog's panel).
    if (e.target !== e.currentTarget) return
    if (e.propertyName !== 'transform' && e.propertyName !== 'opacity') return
    send(EXITED)
  }

  const panel = (motion, className = '') => ({
    className: `ov-panel ${motion} ${className}`.trim(),
    'data-phase': phase,
    // React 18 doesn't know `inert`; an empty string renders the bare
    // attribute, a boolean would warn. `undefined` omits it entirely.
    inert: phase === EXITING ? '' : undefined,
    onTransitionEnd: handleTransitionEnd,
  })

  return { phase, mounted: isMounted(phase), style: { '--ov-dur': `${duration}ms` }, panel }
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
  const rootRef = useRef(null)
  const presence = usePresence(open, {
    duration,
    onEscape: onClose,
    modal: true,
    rootRef,
  })

  if (!presence.mounted) return null

  return (
    <OverlayContext.Provider value={presence}>
      <div
        ref={rootRef}
        className={`ov-root fixed inset-0 ${z}`}
        data-phase={presence.phase}
        style={presence.style}
        // The focus scope's boundary and its last-resort focus target (G13).
        // -1 keeps it out of the tab order, so nothing about tabbing changes;
        // it only makes the box scriptable-focusable for a panel that has no
        // focusable content of its own.
        tabIndex={-1}
      >
        <div
          className="ov-backdrop absolute inset-0 bg-black/60"
          data-phase={presence.phase}
          onClick={onClose}
          aria-hidden
        />
        {/* The column every panel is positioned in ends at the *visible*
            bottom, not at the layout one (G20). `position: fixed` — and with
            it `.ov-root` above — resolves against the layout viewport, which
            on iOS keeps reaching underneath a browser's own bottom bar; a
            panel at `bottom: 0` therefore ends up behind that bar. This is
            G19's case on a second surface, so it reuses G19's number:
            `--browser-bottom-inset` is `100lvh - 100dvh` where a bar overlays
            and 0px everywhere else, which is why iPad Safari, iPhone, Android
            and desktop are unchanged.

            One offset here covers every panel because they all position
            themselves inside this column — the sheets (`bottom-0` and the
            full-screen `inset-0`), the sidebar (`inset-y-0`) and the confirm
            dialog's centring box. Their own heights, overflow and scrolling
            are untouched, so G5's drag stays exactly as it was: the panel is
            the same size, only higher up, and its dismiss threshold is a share
            of that unchanged height.

            The backdrop deliberately keeps `inset-0`: it still covers the
            whole layout viewport, so while a bar retracts the strip below a
            panel shows the dimmed app rather than a bright gap. */}
        <div
          className={`absolute inset-x-0 top-0 bottom-[var(--browser-bottom-inset)] flex ${
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
