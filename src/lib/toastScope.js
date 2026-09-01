// The actionable toast's place in the focus scope (G21).
//
// `ToastHost` renders at `z-[60]`, outside every `.ov-root`, so an actionable
// toast — "Aufgabe erledigt · Rückgängig" (G7/G8/G17) — floats above an open
// overlay. It was hittable by pointer but never a Tab stop inside the trapped
// scope, while `aria-modal="true"` told assistive technology that nothing
// outside the panel exists. Seeing an undo you cannot reach is the defect.
//
// It joins the *scope*, not the overlay stack. A stack entry would make the
// toast the topmost surface, and it would then take Escape (closing the toast
// instead of the sheet the user is working in) and the trap (Tab circling one
// button while a whole form sits underneath). The toast dims nothing and
// blocks nothing; claiming modality for it would be a lie.
//
// One slot, because ToastContext has one slot. Module-level rather than React
// context on purpose: `usePresence` runs inside every overlay, so a context
// would re-render every open sheet on every toast. Same shape as
// src/lib/scrollLock.js and the overlay stack in src/lib/overlayPresence.js —
// a factory around a small core plus one exported instance.

export function createToastScope() {
  let node = null
  const listeners = new Set()

  return {
    /**
     * Register the actionable toast's card. Returns its own remover, so an
     * effect can just `return toastScope.register(el)`.
     */
    register(el) {
      node = el
      return () => {
        if (node !== el) return
        node = null
        // Only the departure is announced. A toast can run out on its own
        // timer while it holds the focus, and the browser then drops that
        // focus on <body> — inside an open modal, which is the state G13
        // exists to prevent. Whoever is the active surface has to take it
        // back; see src/components/Overlay.jsx.
        for (const fn of [...listeners]) fn()
      }
    },
    current: () => node,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export const toastScope = createToastScope()
