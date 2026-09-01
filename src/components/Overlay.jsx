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
  escapeStack,
} from '../lib/overlayPresence'

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

  // Escape closes the topmost overlay only — and an overlay already on its way
  // out is no longer topmost, so a second Escape reaches the one underneath
  // instead of closing two at once.
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  const entryRef = useRef(null)
  if (entryRef.current === null) entryRef.current = {}

  const hasEscape = !!onEscape
  const listens = acceptsEscape(phase)
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
