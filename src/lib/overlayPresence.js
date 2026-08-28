// Presence state machine for overlays (G4).
//
// An overlay that unmounts the moment it is closed cannot animate out — there
// is nothing left on screen to animate. And an overlay that remounts on every
// open replays its entry keyframe from the very beginning, which is the visual
// jump this machine exists to prevent. So the mount lifecycle is driven by a
// phase instead of directly by the `open` flag:
//
//   closed ──open──▶ entering ──primed──▶ open ──close──▶ exiting ──exited──▶ closed
//                        │                                   │
//                        └──close──▶ closed                  └──open──▶ open
//
// Two edges carry the whole point of G4:
//
//   • exiting + open → open, never by way of closed. The element stays
//     mounted, so the CSS transition just retargets and continues from
//     wherever it currently is: no remount, no lost form state, no jump.
//   • entering + close → closed directly. `entering` lasts until the closed
//     position has been painted, so nothing has moved yet and there is nothing
//     to animate out.
//
// Everything else is deliberately a no-op, which is what makes the machine
// safe to feed from a bubbling `transitionend`: the `exited` event only means
// something while the overlay is actually exiting, so the end of the *opening*
// transition cannot close anything.
//
// Pure on purpose — no React, no DOM — so tools/overlayLogic.mjs can check it.

export const CLOSED = 'closed'
export const ENTERING = 'entering'
export const OPEN = 'open'
export const EXITING = 'exiting'

export const OPEN_EVENT = 'open'
export const CLOSE_EVENT = 'close'
export const PRIMED = 'primed' // the closed position has been painted
export const EXITED = 'exited' // the exit transition finished (or timed out)

const TABLE = {
  [CLOSED]: { [OPEN_EVENT]: ENTERING },
  [ENTERING]: { [CLOSE_EVENT]: CLOSED, [PRIMED]: OPEN },
  [OPEN]: { [CLOSE_EVENT]: EXITING },
  [EXITING]: { [OPEN_EVENT]: OPEN, [EXITED]: CLOSED },
}

export function nextPhase(phase, event) {
  return TABLE[phase]?.[event] ?? phase
}

// The overlay is in the DOM for every phase but `closed`.
export function isMounted(phase) {
  return phase !== CLOSED
}

// An overlay on its way out has already handed control back, so it must not
// answer Escape a second time.
export function acceptsEscape(phase) {
  return phase === ENTERING || phase === OPEN
}

// ── Escape stack ────────────────────────────────────────────────────────────
//
// Overlays nest — a ConfirmDialog on top of an EventDetailSheet — and until now
// each mounted overlay listened for Escape on its own, so a single keypress
// tore down the whole stack at once. Registration follows mount order, so the
// last overlay to register is the topmost one and only it may act.
//
// The event is marked as claimed as well as checked against the top of the
// stack. Checking the top alone would leave the outcome depending on the order
// the window listeners happen to fire in and on when React flushes the state
// update that pops the entry; claiming the event settles it either way.
export function createEscapeStack() {
  const entries = []
  const claimed = new WeakSet()

  return {
    push(entry) {
      entries.push(entry)
      return () => {
        const i = entries.indexOf(entry)
        if (i !== -1) entries.splice(i, 1)
      }
    },
    size() {
      return entries.length
    },
    isTop(entry) {
      return entries.length > 0 && entries[entries.length - 1] === entry
    },
    claim(entry, event) {
      if (entries[entries.length - 1] !== entry) return false
      if (claimed.has(event)) return false
      claimed.add(event)
      return true
    },
  }
}

export const escapeStack = createEscapeStack()
