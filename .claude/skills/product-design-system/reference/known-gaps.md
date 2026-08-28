# Known gaps — current app vs. design system

Status: G1–G8 implemented (2026-08); G9–G11 open, G13–G16 open.

This file records where the existing implementation deviates from
`design-system-full.md`. It exists so future sessions do not "discover" the same
issues again and do not start an unrequested refactor.

**Rules for this file**
- A gap is fixed **only** when the current task already touches that code, or the
  user explicitly asks for it (see SKILL.md → Rule 0).
- When a gap is closed, move it to *Closed* with the commit/date.
- When a new deviation is found, add it here instead of fixing it opportunistically.

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

### G16 · A completed row leaves left and reappears lower down — §11
Found in the browser during the G7/G8 analysis, not previously recorded. With
"Erledigte Aufgaben anzeigen" **on**, the completion animation slides the row out
to the left and the same task then reappears in the completed group further down
the card, at full opacity and with no animation at all (measured: y=174 → y=474).
It did not travel there; it vanished and was drawn somewhere else. §11 asks for
the opposite — what leaves toward one side comes back from it.

The cause is structural, not cosmetic: the active rows and the completed rows are
two different child arrays in `TasksList.jsx`, so the move is an unmount plus a
remount, which also resets `TaskRow`'s own `completing` state. Fixing it properly
means a row can stay visible while the selector has already stopped returning it
— G4's presence lifecycle applied to list rows. That is deliberately out of
G7/G8's scope; it would be more machinery than both of them together.

*Direction:* whoever picks this up should look at it together with the
"completed row stays in place for a few seconds, tap the circle to undo"
alternative that G7 considered and deferred — they are the same mechanism, and
that variant would make the undo toast unnecessary for completion.

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

### G7 · Task completion timer + G8 · Undo instead of confirmation — closed 2026-08 (`src/lib/toastState.js`, `src/lib/useTaskActions.js`, `src/context/ToastContext.jsx`, `src/components/ToastHost.jsx`, `src/components/TaskRow.jsx`, `src/context/TasksContext.jsx`, `src/screens/TaskDetail.jsx`)
Closed together, because G7 had no good answer without G8: the completed row is
hidden by the default filter, so the undo has to live somewhere that outlives it.

**The commit is not delayed.** The obvious shape — hold the write for a few
seconds and let undo cancel it — was rejected: the same task is rendered in the
Aufgaben list, the calendar's day list and the Home counts, and for those seconds
they would disagree; a reload or an app switch would silently discard an action
the screen had already shown as done; and a backgrounded tab throttles the very
timer the write would depend on. Committing immediately and *reversing* on undo
matches what `updateTask` already does (optimistic state, then persistence) and
needed no new persistence at all.

**§5 was already satisfied; §19 was the actual gap.** The gap text asked for the
300ms window to become cancellable. It should not be: at 240ms the row measures
`opacity: 0.15` and has 60ms left — that is not a target anyone can decide
against, and press feedback on the circle has worked since G2 (measured, 0.62 on
pointer-down). The honest answer to "I didn't mean that" at this timescale is
undo, so G7 reduced to the lifecycle fix plus the undo, and the animation is
visually untouched.

**The lifecycle fix is small and was a real bug.** The commit timer now lives in
a ref, is cleared on unmount, and a second tap while it runs is ignored instead
of arming a second commit. On `ee7a274`, tapping the circle and navigating away
within 300ms still completed the task after the row was gone; it no longer does.

**Undo is always a counter-patch, never a stored copy.** `uncompleteTask` already
existed; `restoreTask` is its missing mirror for the soft delete
(`is_deleted: false, deleted_at: null`, nothing else). A patch leaves anything
the task picked up in the meantime intact, and because neither direction touches
`sort_order`, an undone task lands back exactly where it was — measured, y=174
before and after.

**`TasksContext` never learns about toasts.** `useTaskActions()` is the thin seam
between the mutations and their feedback, and it is why completing a task from
the calendar's day list means the same thing as completing it in the Aufgaben
list. That is the one file on the "do not touch" list that had to change:
`DayView`'s task list is a second call site for exactly this action, and leaving
it out would have made the same tap behave two ways.

**The toast grew an action slot, not a stack.** One slot, as before: a newer
message replaces an older one and its undo goes with it — the action itself
stands, nothing is lost but the chance to reverse it. `toastState.js` holds the
transitions because that is where the sharp edges are: ids come from a counter
rather than `Date.now()` (two toasts in one millisecond used to collide), a timer
is refused if its toast has already been replaced, and an action can be taken
exactly once. 47 cases in `tools/toastLogic.mjs`.

**Deleting a task is one tap.** `ConfirmDialog` is gone from `TaskDetail`; it
stays in `EventDetailSheet`, where the delete really is permanent and §18 still
justifies interrupting. Worth recording why the dialog was defensible until now:
nothing in the app ever set `is_deleted` back to `false`, so the Papierkorb was a
one-way trip and the dialog was the only protection there was. Removing it was
only safe *because* `restoreTask` now exists.

**Accessibility.** The live region is mounted permanently and only its content
changes — one that appears together with its text is not reliably announced. Only
the undo button takes pointer events back; the wrapper and the card stay
`pointer-events: none`, verified by hit-test (a tap on the card body lands on the
`h1` behind it). The button is a real button, focusable, and Enter runs it. Note
for later: dnd-kit mounts its own `role="status"` region on the Aufgaben screen,
so there are two live regions there — different purposes, no conflict, but worth
knowing before adding a third.

Reduced motion needed no new rule: the completion still fades over the same
300ms (G1) and the toast still uses `reduced-fade-in`.

Verified in Chromium with real touch events (74 assertions) — the 300ms
animation unchanged, undo restoring the exact row position, unmount cancelling
the commit, four rapid taps committing once, overlapping completions, a stale 5s
timer failing to close its successor, 5s with an action and 2s without, keyboard
undo, the event dialog untouched, and G5's sheet drag, G6's swipe and the dnd-kit
reorder all unchanged. Task and calendar geometry is identical to `ee7a274` at
390px and 1280px (the only two moving numbers are an event's Y in the time grid,
which drifts with the wall clock — reproduced by comparing `ee7a274` with itself
70 seconds apart).

*One thing deliberately left open:* see G16.

### G6 · Swipe navigation: feedback and velocity — closed 2026-08 (`src/lib/swipeNav.js`, `src/screens/calendar/useSwipe.js`, `src/screens/Kalender.jsx`, `src/index.css`)
The swipe now shows that it was understood while the finger is down, and a flick
navigates. **Deliberately not a pager** — the direction this gap carried was to
defer that, and it still stands: no neighbouring period is mounted, the three
views are untouched, and the calendar shell is not restructured.

Measured on `498e7f6` before the change, and the numbers are why this was worth
doing at all: a 40px flick at ~1.3px/ms did **nothing**, a 60px crawl over 1.5s
navigated, and `transform` stayed `none` for the entire gesture. Distance was the
only input, and §10 names calendar navigation as its first example.

**Feedback is a damped hint, not a page.** While the gesture reads as
horizontal, the view trails the finger through `--cal-drag` with the transition
switched off — G5's `--ov-drag` / `data-drag` pattern, one axis over. The whole
range rubber-bands against `SWIPE_HINT_MAX` (48px), so at the distance that
commits the view has moved ~17px: obviously alive, obviously not a pager, and it
cannot run away no matter how far the finger goes.

**The axis is locked once, past an 8px slop.** A gesture that reads vertical is
locked out of navigation for the rest of its life, so a scroll can never drag the
calendar sideways halfway through, and the view never twitches during one.
Nothing calls `preventDefault` and nothing sets `touch-action`: vertical
scrolling measured +255px before and +254px after, with `touch-action: auto`
unchanged on the scroller.

**Distance or velocity, and direction beats both** — the same shape as G5's
`shouldDismiss`, reusing G5's own `trackSample` / `velocityFrom` / `rubberBand`
rather than a second implementation. The 48px distance and the 1.4 ratio guard
are unchanged. A flick at 0.5px/ms navigates below that distance; a fast pull
back the other way keeps the period even when the finger had already travelled
past it.

**Keyframes became a transition, and the key moved.** `cal-enter-*` was the last
keyframe movement in the app, and it had exactly the problem G4 documented: it
always restarts from its `from` value. The wrapper now stays mounted and carries
the transition, and `key={periodKey}` moved onto the views themselves — the same
remount, so the scroll re-anchoring and the collapse-on-day-change still happen,
but the animating element survives.

That alone was not enough, and the browser said so: priming every period change
at a fixed ±24px reproduced the very jump the keyframe made — two consecutive
swipes measured 4.91px and 4.90px, the baseline's own numbers. So the starting
offset is now **whatever the gesture left behind**. A committed swipe continues
from the finger's position (measured: finger left the track at -24.1px, the slide
started at -26.8px, nowhere near +24); only the arrows, which have no gesture
behind them, get a starting offset invented for them, and there it is the 24px
this always used. Grabbing a running slide takes it over from its current
position without a snap.

Reduced motion keeps exactly the treatment it had: a 220ms fade, no travel. The
live hint goes with it — unlike G5's sheet, where the finger holds the object it
moves, this is a damped echo of the gesture rather than direct manipulation, so
here it is movement rather than feedback. The gesture still navigates.

Desktop is untouched: there is still no mouse swipe, and the arrows remain the
pointer and keyboard path.

`tools/swipeLogic.mjs` unit-tests the axis lock, the hint curve and clamping, the
distance/velocity/direction decision and the sampling (52 cases). The gesture was
driven in Chromium with real touch events through CDP (47 assertions), and
calendar geometry is identical to `b7e9103` at 390px and 1280px in all three
views.

### G5 · Drag-to-dismiss for sheets — closed 2026-08 (`src/lib/sheetDrag.js`, `src/lib/useSheetDrag.js`, `src/components/BottomSheet.jsx`, `src/index.css`)
The grabber does what it always promised. Pull the strip at the top of a
grabber-style sheet and the sheet follows the finger 1:1; let go past the
threshold, or flick it, and it carries on out.

**Scope is the three grabber sheets** — `ActionSheet`, `FilterSheet`,
`EventDetailSheet`. `TaskForm` and `EventForm` (`full`) are deliberately
untouched: they never drew a grabber, so there was no promise to keep, and their
× button stays the way a form is dismissed. Their geometry is byte-identical to
`498e7f6` at 390px and 1280px, as is that of all three drag sheets.

**The drag joins the existing movement instead of adding one.** `--ov-drag` on
the panel plus `data-drag="live"` (transition off) is the whole live gesture —
the same shape as G2's `[data-pressed]`, and for the same reason: interpolation
between two positions is exactly what direct manipulation must not have. On
release nothing new animates. Snapping back only *removes* the attribute, and
because the panel is still mounted and still `open`, G4's transition carries it
from wherever the finger left it back to `transform: none`. Dismissing keeps the
attribute (as `exit`), calls `onClose`, and lets the presence machine move to
`exiting`, where the base rule takes the sheet the rest of the way down. Closing
by drag and closing by backdrop end up on one path, at 300ms and
`cubic-bezier(0.16, 1, 0.3, 1)`. No new token, no spring system, and
`Overlay.jsx` / `overlayPresence.js` were not touched at all.

**Distance or velocity, and direction beats both.** The threshold is 30% of the
sheet's own height, clamped to 56–140px, so a short sheet and a tall one take
the same *gesture*; a downward flick at 0.6px/ms dismisses well short of it, and
an upward flick at that speed keeps the sheet even when it was already past it —
the user is visibly pulling it back. Velocity is read over a 100ms window rather
than the final two points, because a finger is usually decelerating by the time
it lifts and every deliberate throw would otherwise read as a slow drag.
Upward drags rubber-band (§13) on the UIScrollView resistance curve against the
sheet's own height: soft, and it never opens.

**The handle is the grabber strip and the title, never the body.** The body
scrolls, and one surface cannot be both a scroller and a drag target without one
of them guessing. That strip carries `touch-none` — the only place in the app
that claims a gesture this way, so page scrolling, `useSwipe` and the dnd-kit
reorder keep the budget G2 was careful to leave them.

`select-none` on that strip is **not** cosmetic, and it was found in the browser,
not in review: dragging across the title selects it, and the *next* drag over the
now-selected text becomes a native drag of that selection, which Chromium
announces by cancelling the pointer mid-gesture. The sheet snapped back for no
reason the user could see, and only ever on the second drag.

**A ConfirmDialog above a sheet needs no new mechanism.** It renders through
`Overlay` at `z-[55]` (G12), so its backdrop already covers the handle: the
pointer never reaches it. Verified by hit-test rather than assumed.

Reduced motion keeps the split G1 established. The drag itself is the user's own
finger — feedback, not motion — so it still tracks, re-declared inside the block
because the rules above it match at the same specificity. What loses its movement
is everything automatic: the snap-back simply arrives, and a dismissed sheet
fades out from exactly where the finger left it rather than travelling back up
first only to fade from there.

*One known consequence.* While a sheet is being dragged, and for the 300ms a
snap-back takes, the panel carries a real transform — so it is a containing block,
and a `position: fixed` descendant would anchor to it (the case G4's
`transform: none` was chosen to avoid). Opening the confirm dialog inside that
window would mis-anchor it. It is inherent to animating the panel at all,
self-heals when the transform returns to `none`, and needs a deliberate tap
during a 300ms snap-back to reach; not worth a mechanism.

`tools/sheetDragLogic.mjs` unit-tests the thresholds, the rubber-band curve, the
velocity window and the release decision (42 cases) as part of
`npm run test:logic`. The gesture itself was driven in Chromium across all three
sheets — tracking, snap-back, slow dismiss, flick, rubber-band, backdrop, Escape,
tap, scroll containment, the dialog case, Tab order and reduced motion (72
assertions).

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
