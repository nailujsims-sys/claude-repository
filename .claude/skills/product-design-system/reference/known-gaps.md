# Known gaps — current app vs. design system

Status: G1, G2 and G3 implemented (2026-08); G4–G12 still open.

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

### G2 · Press feedback — closed 2026-08 (`src/lib/pressFeedback.js`, `src/index.css`)
Solved centrally, as the direction asked: one delegated pointer listener
(`installPressFeedback`, wired once in `main.jsx`) writes a `data-pressed`
attribute; no per-component `active:` classes and no per-button handlers. The
semantics are the ones `useTimedGesture.js` already established — feedback on
down, an 8px slop so a fingertip's drift is not a cancel, leaving the activation
area cancels, re-entering re-arms, `pointercancel`/scroll aborts. It commits
nothing: the action still runs from the element's own `onClick`, i.e. the native
click, which already means "released inside the element". It never calls
`preventDefault` and never sets `touch-action`, so page scrolling, `useSwipe`
and the dnd-kit reorder keep the gesture budget they had.

Three classes, extending `.press-tint` rather than replacing it:
`.press-tint` (white wash, layered as an inset box-shadow so it sits *over* an
element's own background — a selected chip stays visibly selected while pressed,
keeping press distinct from the app's active states), `.press-fade` (opacity dip,
for bare icons and text links) and `.press-scale` (the FAB's pre-existing 0.95
scale, moved off `:active` onto the controller so it cancels like everything
else). No new colour, no added scaling, no sounds or haptics.

Deliberately *not* `:active`: it also matches the ancestors of the pressed node
(pressing the star would have tinted the whole task row), it has no movement
threshold, and on touch it is delayed while the browser decides whether the
gesture is a scroll.

Also folded in: the ~20 duplicated header icon buttons became one `IconButton`,
and 11 unguarded `hover:bg-white/5` / `hover:text-*` utilities moved onto the
press classes' `(hover: hover)`-guarded hover, which removed sticky hover at
those call sites.

**Interaction with G1 and G3.** Reduced motion stays a single block: only
`.press-scale` is neutralised there (a transform is movement — it still changes
state, just instantly, exactly as G1 treated the FAB before), while the wash and
the fade keep their 120ms release easing because box-shadow and opacity carry no
movement. G3's inset focus ring and G2's inset wash compose rather than collide:
the wash paints just above the background, the outline paints last, so a focused
row that is pressed shows both. Keyboard activation writes `data-pressed="key"`
so `.press-fade` uses the wash instead of an opacity dip and never dims the ring.
The floating action button carries `.press-scale` only — its glow is an inline
style, which beats any class rule, so a wash could never paint there.

`tools/pressLogic.mjs` unit-tests the state machine (slop, activation area,
rect drift) and runs as part of `npm run test:logic`.


### G1 · Reduced motion — closed 2026-08 (`src/index.css`)
One `@media (prefers-reduced-motion: reduce)` block. Spatial animations
(`sheet-up`, `slide-in-left`, `toast-in`, `cal-enter-*`) keep their duration and
easing but animate `reduced-fade-in` instead of travelling; `task-completing`
fades out over the same 300ms the list waits for, so completion still commits
identically. `star-pop` and the looping skeleton `shimmer` are switched off — the
star's colour change and the placeholder blocks remain as the feedback.
Movement transitions (`transition-transform`, `transition-all` — toggle knobs,
chevrons, the FAB press scale) become instant state changes.
Untouched on purpose: opacity-only animations (`fade-in`, `page`) and colour
transitions (`press-tint`, `transition-colors`) carry no movement, and the
calendar drag/resize plus the dnd-kit reorder are direct manipulation — the rows
shifting aside *are* the drop-target feedback (§6/§22), so removing them would
remove feedback rather than motion.

### G3 · Focus states — closed 2026-08 (`src/index.css`, `src/screens/TasksList.jsx`)
One central `:focus-visible` rule: a 2px accent outline at 2px offset for links,
buttons, `summary`, `[role=button|tab|switch]` and anything with a real
`tabindex`. Text fields get the same outline **only** when they would otherwise
show nothing — fields carrying their own `focus:ring-accent`, and fields inside a
`focus-within:ring-*` wrapper, are excluded, so no control ever shows two
indicators. This closed the previously indicator-less search fields (Aufgaben,
Kalender) and the EventForm location/notes/time fields.

**Follow-up: the ring was being clipped.** An outline paints *outside* the
element, so anything flush against a clipping edge lost most of it — a focused
task row showed only the one horizontal segment that happened to fall between two
rows. Two different causes, two fixes:

1. *Full-bleed surfaces inside a clipping container* (task rows filling their
   card, option rows in cards, calendar event blocks) draw the same ring just
   **inside** their own edge (`outline-offset: -2px`). Free-standing controls keep
   the outset ring — several are accent-filled, where an inset accent ring would
   vanish. So: surfaces ring inside, controls ring outside; colour and width are
   identical either way.
2. *The horizontal category row* (`overflow-x-auto`) clips vertically and had no
   top padding, cutting a chip's ring by 4px. `mt-3` became `mt-2 pt-1` — same
   12px above the chips, 4px of room inside the scroll box. Verified pixel-exact:
   chip, section label and card all keep their previous positions.

Measured with real Tab navigation across all four routes and the EventForm sheet:
75 focusable elements, 0 clipped rings.
