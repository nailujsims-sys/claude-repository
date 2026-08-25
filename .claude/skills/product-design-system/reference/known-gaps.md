# Known gaps — current app vs. design system

Status: **audit only, nothing changed yet** (2026-08).

This file records where the existing implementation deviates from
`design-system-full.md`. It exists so future sessions do not "discover" the same
issues again and do not start an unrequested refactor.

**Rules for this file**
- A gap is fixed **only** when the current task already touches that code, or the
  user explicitly asks for it (see SKILL.md → Rule 0).
- When a gap is closed, move it to *Closed* with the commit/date.
- When a new deviation is found, add it here instead of fixing it opportunistically.

---

## High impact (systemic, affects every module)

### G1 · No `prefers-reduced-motion` support anywhere — §22
Neither `src/index.css` nor `tailwind.config.js` contains a reduced-motion query.
Every keyframe animation (`sheet-up`, `slide-in-left`, `page-in`, `task-complete`,
`cal-enter-*`, `star-pop`, `toast-in`, `shimmer`) plays unconditionally.
*Direction:* one global `@media (prefers-reduced-motion: reduce)` block in
`src/index.css` that neutralises transforms and keeps opacity/feedback. Central,
low-risk, no component changes.

### G2 · Press feedback missing on most controls — §5
~64 `<button>` elements exist; press feedback is present on only a few
(`BottomNav` plus button `active:scale-95`, `.press-tint` in `Kalender.jsx` and
`MiniCalendar.jsx`). Everything else — `ConfirmDialog` buttons, `TaskForm` /
`EventForm` controls, `TaskDetail` actions, `FilterSheet`, `ActionSheet`,
`Sidebar`, `TaskRow`'s complete circle and `StarButton` — reacts only on click.
*Direction:* extend the existing `.press-tint` pattern (or a `.press-scale`
sibling) rather than adding per-component `active:` classes.

### G3 · No visible focus states — §22
`outline-none` is applied to inputs across `TaskForm`, `EventForm`, `Login`,
`TasksList`, `Kalender`; inputs recover a focus ring via `focus:ring-accent`, but
**no button anywhere has a `focus-visible` style**. Keyboard users get no
indication of position.
*Direction:* one global `:focus-visible` rule in `src/index.css`.

### G4 · Overlays animate in but never out — §11 spatial consistency, §7
`Overlay.jsx` returns `null` when `open` is false, so `BottomSheet`, `Sidebar`,
`ActionSheet`, `FilterSheet`, `EventDetailSheet` and `ConfirmDialog` slide/fade in
and then **disappear instantly**. A panel that enters from the right/bottom must
leave the same way. Also means no interruptible open→close reversal.
*Direction:* add an exit phase in `Overlay.jsx` only — every sheet inherits it.
Touches one shared file; verify all five consumers.

---

## Medium impact (single interaction)

### G5 · Sheets cannot be dragged to dismiss — §6, §7, §13
`BottomSheet.jsx` renders a grabber bar (`h-1 w-9 rounded-full bg-white/15`) that
is purely decorative: there is no drag handling, no rubber-banding, no velocity
dismissal. The affordance promises direct manipulation the component does not
deliver.
*Direction:* either implement drag-to-dismiss (reusing the pointer-capture
approach of `useTimedGesture.js`) or drop the grabber. Do not leave it decorative.

### G6 · Swipe navigation is discrete, not continuous — §10, §12
`useSwipe.js` reads only the net delta on `touchend` (threshold 48px, ratio 1.4)
and then plays a fixed 220ms `cal-enter-*` animation. The design system asks for
continuous feedback during the gesture and for release velocity to influence the
result; §12 explicitly warns against relying solely on a final "swipe detected"
event. The user gets no feedback while dragging and no momentum.
*Direction:* deferred — a continuous pager is a real rework of the calendar
views. Candidate for the polish phase (§26), not for incidental changes.

### G7 · Task completion is a blocking 300ms timer — §5, §7, §19
`TaskRow.jsx` sets `completing` and commits via `setTimeout(…, 300)`. The
animation is not interruptible, the action cannot be cancelled once the circle is
tapped, and there is no undo afterwards.
*Direction:* pair with G8 (undo in the toast) before touching the timing.

### G8 · No undo anywhere; deletes always confirm — §18, §19
`ToastContext`/`ToastHost` support message-only toasts (2s, no action slot).
Every destructive path instead opens `ConfirmDialog` ("Are you sure?"), which the
design system asks us to avoid where an action can reasonably be reversed. Task
deletion is already a *soft* delete (Papierkorb) — the ideal undo candidate.
*Direction:* add an optional action to the toast, then replace the soft-delete
confirmation with delete + undo. Keep `ConfirmDialog` for genuinely irreversible
actions.

---

## Low impact

### G9 · `StarButton` pop is a fixed 220ms timer — §7
`setTimeout(() => setPop(false), 220)`; rapid re-taps restart rather than
continue from the current visual state. Minor.

### G10 · Typography values are literals, not tokens — §15
Sizes are written inline as `text-[15px]`, `text-[17px]`, `text-[12px]`,
`text-[11px]` across screens and components. The scale is *de facto* consistent
but is not defined as a system, so each new module re-invents it.
*Direction:* define the scale in `tailwind.config.js` (`fontSize` extension) and
adopt it in new code first; migrate existing call sites only when already editing
them.

### G11 · `BottomNav` blur is an ad-hoc material — §25
`BottomNav.jsx` sets `backdropFilter: blur(20px)` with an inline rgba background
— the one translucency in the app, while §25 defers a glass/material system.
Not a bug; documented so it is not copied into new modules until a material
system is decided.

### G12 · `ConfirmDialog` bypasses `Overlay` — §2 consistency
It renders its own `fixed inset-0` backdrop at `z-[55]` instead of reusing
`Overlay.jsx`, so it does not inherit Esc handling or the phone-frame column, and
it will not inherit the G4 exit animation.

---

## Explicitly conformant (do not "fix")

- `src/screens/calendar/useTimedGesture.js` — long-press grab, pointer capture,
  continuous tracking, slop thresholds, cancel on `pointercancel`, commit on
  release. This is the reference implementation for §5–§7.
- `.press-tint` in `src/index.css` — correctly restricts `:hover` to real
  pointers so a tap does not leave a stuck tint.
- `src/config/navigation.js` — config-driven navigation; scales to new modules
  without component edits (§2).
- Dark-first token set in `tailwind.config.js` with a single accent (§14).

## Closed

_(none yet)_
