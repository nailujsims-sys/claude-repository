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

// ── Overlay stack ───────────────────────────────────────────────────────────
//
// Overlays nest — a ConfirmDialog on top of an EventDetailSheet — and only the
// topmost one may act on a global key. Registration follows mount order, so the
// last overlay to register is the topmost one.
//
// The stack started out as the Escape stack (G4) and is now the one place that
// answers "which overlay is currently the active surface?" — for Escape (G4)
// and for the focus trap (G13) alike. Registration therefore no longer depends
// on an overlay having an `onEscape`: every active overlay is in the stack, and
// the individual features decide for themselves whether they apply. (The scroll
// lock, G14, does not ask — it counts holders of its own, see
// src/lib/scrollLock.js, because it has to keep holding through the exit, where
// an overlay is no longer the active surface.)
//
// `claim` stays Escape-specific. The event is marked as claimed as well as
// checked against the top of the stack: checking the top alone would leave the
// outcome depending on the order the window listeners happen to fire in and on
// when React flushes the state update that pops the entry; claiming the event
// settles it either way. A Tab keypress needs none of that — the trap acts
// once, on the top entry, and never lets the event through.
export function createOverlayStack() {
  const entries = []
  const claimed = new WeakSet()

  const remove = (entry) => {
    const i = entries.indexOf(entry)
    if (i !== -1) entries.splice(i, 1)
  }

  return {
    // Returns its own remover so an effect can just `return stack.push(entry)`.
    push(entry) {
      entries.push(entry)
      return () => remove(entry)
    },
    remove,
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

export const overlayStack = createOverlayStack()
