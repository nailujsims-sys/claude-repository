# Known gaps — current app vs. design system

Status: G1, G2, G3, G4, G10 and G11 implemented (2026-08); G5–G9, G13–G16 open.

This file records where the existing implementation deviates from
`design-system-full.md`. It exists so future sessions do not "discover" the same
issues again and do not start an unrequested refactor.

**Rules for this file**
- A gap is fixed **only** when the current task already touches that code, or the
  user explicitly asks for it (see SKILL.md → Rule 0).
- When a gap is closed, move it to *Closed* with the commit/date.
- When a new deviation is found, add it here instead of fixing it opportunistically.

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

### G13 · No focus trap in any overlay — §22
Tab from an open sheet walks straight out of it into the page behind, which stays
reachable. Pre-existing and unchanged by G4 (verified A/B against `ebdd4ce`), and
deliberately left open: it is an accessibility concern in its own right, not a
motion one. `Overlay.jsx` is now the obvious single place to solve it — the
presence phase already knows exactly when a panel is the active one and when it
is on its way out.

### G14 · No scroll lock behind an open overlay — §22
The page behind a sheet still scrolls. Same story as G13: pre-existing, out of
G4's scope, and belongs in `Overlay.jsx` when it is picked up.

### G16 · The type scale is named but not yet coherent — §15, §17
Filed while closing G10, which deliberately renamed sizes without changing any
of them. Two things are now visible that were hidden inside the literals:

1. *Same role, different size.* Filter/category chips are `text-body-sm` in
   Aufgaben but `text-label` in Kalender and on the Startseite. Card and section
   headings are `text-card-title` (Startseite), `text-section-title`
   (TaskDetail) and `text-body` (EventDetailSheet). Empty-state headlines are
   `text-section-title` in `TasksList.jsx` but `text-body` in
   `calendar/parts.jsx`. Sheet titles are `text-panel-title`, except
   `EventDetailSheet`, which uses a 22px literal.
2. *Line-height is not part of the scale.* Every size inherits Tailwind
   preflight's 1.5; only 13 of 137 call sites override it. 1.5 is loose on the
   large steps — `leading-tight` at four title call sites already compensates by
   hand. §15 asks for line-height to be part of the system.

*Direction:* both halves are **visible** changes and need a design decision, not
a migration. Measured on the pre-G10 code: giving each step a tuned line-height
moves 72–99% of all elements per route, up to 34.8px on the Startseite. So this
belongs in the polish phase (§26) or in a dedicated task — never folded into
unrelated work. When it is picked up, the `fontSize` tuple form
(`['15px', { lineHeight: '20px' }]`) is the mechanism, and the tokens from G10
are the place to put it.

### G15 · The task-detail menu popover has no motion — §11
`TaskDetail.jsx` renders its own `absolute … z-20` menu with no enter or exit
animation, so it appears and vanishes instantly. It is a small anchored popover
rather than a modal overlay, so it deliberately stayed outside G4; if it is given
motion later it should originate from its trigger (§11), not slide like a sheet.

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

### G11 · `BottomNav` blur is an ad-hoc material — closed 2026-08 (`src/components/BottomNav.jsx`)
The bar was `background: rgba(8, 12, 20, 0.92)` plus `backdropFilter: blur(20px)`,
inline — the app's one translucency, while §25 defers a glass/material system.
It is now `bg-bg-base`, opaque, and only `paddingBottom: env(safe-area-inset-bottom)`
stays inline (`env()` has no Tailwind token).

**Measured before deciding, and the measurements changed the decision.** The gap
was filed as "not a bug, just documented". Two findings made removal the better
answer than documentation:

1. **The blur did nothing.** Over the whole bar, in four states: 20 of 88,920
   pixels differed between `blur(20px)` and no backdrop-filter at all, by 1/255.
   At 92% opacity only 8% of the backdrop reaches the bar, and in 4 of 5 sampled
   states the area behind the bar is uniformly the page colour anyway — every
   screen reserves `pb-28`, so content sits behind the bar only mid-scroll. Even
   with high-contrast stripes deliberately placed behind it, the blur only
   softened 20 levels of banding to 14. Scroll cost was identical (16.67 vs
   16.74 ms/frame, both vsync-bound).
2. **The app already had an answer for this surface.** `TasksList.jsx:202` — the
   other sticky chrome that content scrolls underneath — is `bg-bg-base`, opaque,
   no blur. So this was not only a §25 question but a §2 one: two materials for
   one job. Reusing the existing pattern is what closed it; `TasksList.jsx` was
   not touched.

Also gone: an unnamed colour literal. `rgba(8, 12, 20, 0.92)` was `bg-base` at
92% — the same class of thing G10 removed from typography.

**Verification against `ec90a42`.**
- Geometry: 44 states × 390px and 1280px, **8540 elements, 0 differences**, and
  0 computed-style differences. Border, `z-40`, `pointer-events`, safe-area
  padding and the FAB are byte-identical in the DOM.
- Pixels: 10 of 44 viewport screenshots byte-identical (the ones where a sheet
  covers the bar); in the other 34 **every differing pixel lies inside the bar** —
  nothing anywhere else on any screen changed.
- The bar's own difference decomposes into two parts, both checked:
  *(a)* the intended one — with grayscale text AA forced on both sides, the
  residual is **maxDelta 6 where content scrolls behind, maxDelta 2 elsewhere,
  avgDelta ≈1**. That is the removed 8% bleed plus a one-level rounding shift
  (the bar now *is* `#080C14` instead of compositing to `rgb(7,11,19)`).
  *(b)* a **measurement artefact**: 414 pixels along the label baseline differ by
  up to 127. Chromium enables LCD subpixel antialiasing over an opaque background
  and disables it over a translucent one, so the labels simply joined the text
  rendering path the rest of the app already uses. Proven, not assumed: with
  `--disable-lcd-text` on both sides the deltas above 2 vanish completely
  (3-8: 0, 9-32: 0, >32: 0), and the old bar renders identically with and without
  LCD text — it never had it. Irrelevant on the actual target: iOS has no LCD
  text AA and `-webkit-font-smoothing: antialiased` is set globally.
- G1–G3: 99 Tab stops across five screens keep identical focus rings; press
  feedback unchanged, including the nav tabs' `press-fade` opacity dip and the
  FAB's `press-scale` plus its glow.
- Emitted CSS is byte-identical to the baseline. `npm run build && npm run smoke
  && npm run test:logic` pass.

No material or glass abstraction was introduced — §25 and §26 stay untouched for
the day a material system is decided deliberately. After this there is no
translucency left in `src/` to copy.

### G10 · Typography literals → named tokens — closed 2026-08 (`tailwind.config.js`, 26 files under `src/`)
The scale existed; it just had no names. 137 inline `text-[Npx]` literals across
26 files, 16 distinct sizes, and — measurably — no Tailwind size utility in use
anywhere. The cost was not how it looked but that every new module had to guess:
the same filter chip is 14px in Aufgaben and 13px in Kalender, the same kind of
heading is 15, 16 or 18px depending on which screen it sits on.

**The whole change is a rename.** `fontSize` in `tailwind.config.js` names the
sizes the app already used, and 131 of the 137 call sites now use those names.
Written in Tailwind's *string* form (`body: '15px'`), which emits exactly
`font-size: 15px` — byte-identical to what `text-[15px]` emitted. Nothing else
was allowed to change.

**Deliberately font-size only.** The tuple form
(`['15px', { lineHeight: '20px' }]`) would have been the "proper" type scale, and
it was rejected on evidence: injecting tuned line-heights into the pre-change app
moved 72–99% of all elements per route, up to 34.8px on the Startseite. Line
height stays inherited (preflight's 1.5) plus the 13 existing `leading-*`
overrides, untouched. Filed as G16 together with the size/role outliers the
rename made visible — both are design decisions, not migrations.

**Roles, not pixels.** `title` (28) · `section-title` (18) · `panel-title` (17) ·
`card-title` (16) · `field` (16) · `body` (15) · `body-sm` (14) · `label` (13) ·
`meta` (12) · `caption` (11) · `micro` (10). Two names share 16px on purpose:
`text-field` is a form's primary text input, `text-card-title` is a card heading.
They are one value today and two different decisions, so they get two names — a
future change to one must not silently drag the other.

Six one-off display sizes stayed literals rather than inflating the scale to 16
steps: 9px (the calendar's now-line time), 19px (the Kalender header title),
22px (`EventDetailSheet`), 24px (`TaskDetail`), 26px (`Login`), 34px (the version
number). Each carries a one-line comment marking it intentional, so a future
`grep` for `text-[` finds no *unmarked* literal.

**Verification — the point of the exercise was proving nothing moved.**
- Reverse-mapping the 131 token usages back to literals reproduces `498e7f6`
  byte-for-byte in all 26 files; the only diff is the 7 comment lines above. No
  call site was cross-mapped.
- Emitted CSS: the multiset of `font-size` values is identical before and after;
  only selectors were renamed.
- Browser A/B against `498e7f6` (Chromium, clock pinned, build timestamp pinned):
  18 states × 390px and 1280px — all four routes plus TaskDetail, its menu,
  ConfirmDialog, Sidebar, ActionSheet, TaskForm, EventForm, FilterSheet, both
  search fields, EventDetailSheet, Version and the Tag/Woche/Monat views.
  **7158 elements and 1612 text nodes compared: 0 geometry differences, 0
  computed-style differences** (font-size, line-height, font-weight,
  letter-spacing). All 36 full-page screenshots are byte-identical.
- G1–G3 regression: 99 Tab stops across five screens keep identical focus rings
  (style, width, colour, offset, geometry), and press feedback still writes
  `data-pressed` with the same inset wash.
- `npm run build && npm run smoke && npm run test:logic` pass.

`Login.jsx` is unreachable in local mode (it needs Supabase), so it is covered by
the byte-for-byte source proof and the CSS diff rather than by the browser A/B.

### G4 · Overlay exit animations — closed 2026-08 (`src/lib/overlayPresence.js`, `src/components/Overlay.jsx`, `src/index.css`)
Solved centrally, as the direction asked: one presence machine, one lifecycle,
every overlay inherits it.

`overlayPresence.js` holds a pure state machine —
`closed → entering → open → exiting → closed` — and `Overlay.jsx` mounts on any
phase but `closed`. Two edges carry the whole fix: `exiting + open → open`
returns to the open state **without passing through `closed`**, so the panel is
never remounted and the form inside it keeps its state; and
`entering + close → closed` unmounts immediately, because `entering` lasts only
until the closed position has been painted and nothing has moved yet.

**Keyframes became transitions.** That is the part that makes interruption work
at all. A keyframe always restarts from its `from` value, so re-triggering one
mid-flight jumps back to the start; a transition interpolates from the current
computed value, so retargeting simply reverses out of wherever the panel
currently is. Durations and easing are unchanged — 300ms sheets, 250ms sidebar,
`cubic-bezier(0.16, 1, 0.3, 1)`, 200ms for the dialog fade. No new animation was
introduced: closing is the opening movement played the other way.

The open state is `transform: none`, not `translateY(0)`. Any transform value
creates a containing block and would re-anchor `position: fixed` descendants —
the confirm dialog inside a sheet is exactly that case, and on desktop its
backdrop would have shrunk to the 430px frame.

Exit completion is driven by `transitionend`, filtered to the panel itself
(`e.target !== e.currentTarget` rejects a nested dialog's or a toggle knob's
event) and to `transform`/`opacity`, with a `duration + 120ms` timeout as a
fallback. Measured: the exit ends on the event at ~317ms, not on the timeout.

A leaving overlay is `inert` (React 18 needs the empty-string form) and
`pointer-events: none` — on the **root**, not just the backdrop, so it does not
block the app behind it either. Without that, reopening mid-exit was impossible
because the trigger was still covered; that was caught in the browser, not in
review.

`useRetained` (`src/lib/useRetained.js`) holds the last non-null value so an exit
still shows what the user was looking at: `TaskForm`/`EventForm` keep saying
"… bearbeiten" instead of flipping to "Neue …" halfway down, and
`EventDetailSheet` does not empty out while still visible.

Also folded in, because it was the same shared file: **the Escape stack**.
Previously every mounted overlay listened for Escape independently, so one press
closed an `EventDetailSheet` *and* the `ConfirmDialog` on top of it (reproduced
on `ebdd4ce`). Now registration order decides — only the topmost overlay acts,
and the event itself is marked claimed, so the outcome does not depend on
listener order or on when React flushes. An overlay that has started exiting
deregisters, so it cannot fire a second close.

**Interaction with G1, G2, G3.** Reduced motion is still exactly one block:
sheets and the sidebar re-declare their two classes there to fade instead of
travel, same duration, same lifecycle, same exit — the backdrop and the dialog
already only changed opacity and were left alone. G2 and G3 are untouched;
verified in Chromium that press feedback still arms on pointer-down inside a
sheet and cancels on drag-off, and that controls inside an overlay still show the
2px accent ring. Overlay geometry is byte-identical to `ebdd4ce` at 390px and
1280px.

`tools/overlayLogic.mjs` unit-tests the machine and the Escape stack (35 cases)
as part of `npm run test:logic`.

### G12 · `ConfirmDialog` bypasses `Overlay` — closed 2026-08 (with G4)
It now renders through `Overlay` (`duration={200}`, `z="z-[55]"`), so it inherits
the Escape stack and the presence lifecycle. Its own look is unchanged and
deliberately so — centred, 320px, `bg-elevated`, card radius, fade only, no
travel and no scaling; verified pixel-wise against `ebdd4ce`.

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
