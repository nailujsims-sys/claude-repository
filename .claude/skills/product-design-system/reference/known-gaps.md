# Known gaps — current app vs. design system

Status: **the mandatory G phase is finished** (2026-08/09). G1–G5, G7, G8,
G10–G22 are done or deliberately closed; nothing on this list blocks new
product work. What remains are two polish-phase candidates, G6 and G9, which
§26 wants judged after real use rather than built now.

This file records where the existing implementation deviates from
`design-system-full.md`. It exists so future sessions do not "discover" the same
issues again and do not start an unrequested refactor.

**Rules for this file**
- A gap is fixed **only** when the current task already touches that code, or the
  user explicitly asks for it (see SKILL.md → Rule 0).
- When a gap is closed, move it to *Closed* with the commit/date.
- When a new deviation is found, add it here instead of fixing it opportunistically.

---

## Polish-phase candidates (§26)

Not open gaps and not work items: both are known, both were measured, and both
are deliberately left until the app has been used in real life. Neither is
allowed to justify a refactor on the way past.

### G6 · Swipe navigation is discrete, not continuous — §10, §12
`useSwipe.js` reads only the net delta on `touchend` (threshold 48px, ratio 1.4)
and `Kalender.jsx` then plays a fixed 220ms `cal-enter-*` off a remount key. §12
asks for continuous feedback during the gesture and for release velocity to
influence the result; the user gets neither.
*Why not now:* a continuous pager means rendering three periods at once in all
three calendar views, 1:1 pointer tracking, rubber-banding at the edges (§13),
velocity and interruptibility — and it has to coexist with the event
move/resize drag (`data-ev-id`, `useTimedGesture`) and with vertical scrolling.
That is a gesture rework of the calendar, exactly the kind of thing §26 wants
based on actual usage. The navigation works today; it is the *feel* that is
short of the standard.

### G9 · `StarButton` pop is a fixed 220ms timer — §7
`setTimeout(() => setPop(false), 220)`; a second tap inside that window does not
restart the pop and does not continue from the current visual state.
*Why not now:* the state change itself is already communicated (the star fills
and turns accent), `press-fade` covers the press, and reduced motion is handled.
Nothing is missing, only a refinement. Fix it opportunistically when
`StarButton` is being edited anyway — an `animationend` instead of the timer —
never as a task of its own.

## Explicitly conformant (do not "fix")

- `src/screens/calendar/useTimedGesture.js` — long-press grab, pointer capture,
  continuous tracking, slop thresholds, cancel on `pointercancel`, commit on
  release. This is the reference implementation for §5–§7.
- `.press-tint` in `src/index.css` — correctly restricts `:hover` to real
  pointers so a tap does not leave a stuck tint.
- `src/config/navigation.js` — config-driven navigation; scales to new modules
  without component edits (§2).
- Dark-first token set in `tailwind.config.js` with a single accent (§14), and
  since G10 the typography scale beside it (§15).
- `BottomNav.jsx`'s `backdropFilter: blur(20px)` over an inline rgba background
  (was G11). It is the one translucency in the app and it predates the standard,
  but §25 does not ask for it to be removed — it asks that a glass/material
  system is not *introduced*. Reverting it would be a visual change nobody
  requested, so it stays exactly as it is: a documented, contained exception.
  Do not copy it into a new module, and do not extend it; if translucency is
  ever wanted as a system, that is a §26 decision, not a precedent set here.

## Closed

### G22 · Every screen built its own header — closed 2026-09 (`src/components/TopBar.jsx`, `src/screens/Home.jsx`, `src/screens/Kalender.jsx`, `src/screens/TasksList.jsx`, `src/screens/Mehr.jsx`, `src/screens/Version.jsx`, `tools/smoke.mjs`)
§2 asks the modules to feel like one app, and the one element on literally every
screen was the one that was different everywhere. Measured before the fix, at
390px:

| Screen | inset | top | row | title | hamburger |
|---|---|---|---|---|---|
| Heute | `px-5` | `pt-3` + `py-2` | 36px | *none* (the greeting was the only title) | x 16 / y 20 |
| Kalender | `px-4` | `pt-4` | 42px | 19px + 12px subtitle | x 12 / y 16 |
| Aufgaben | `px-5` | `pt-5` | 36px | 28px inline | x 16 / y 20 |
| Mehr · Version | `px-5` | `pt-5` | 36px | 28px inline | x 16 / y 20 |

So the menu button moved on both axes while navigating, the title was in a
different place and a different size on every screen (and missing on Heute), and
the right-hand actions started at three different x positions. Every one of the
five headers also carried the same `-ml-1` on its menu button — a per-screen
correction for a horizontal inset that was itself per-screen.

`TopBar` replaces all five. The geometry is fixed inside the component and is
not exposed as props, so a screen cannot shift it: `px-4` (which is chosen so
the 26px menu glyph lands at 21px, optically flush with the `px-5` content
column below — no nudge needed), `calc(12px + env(safe-area-inset-top))` above,
a 40px row, a title block that always reserves its subtitle line, and a
right-anchored 36×36 action rail with an 8px gap. Measured after the fix, every
route at 320/360/390/430/768/1280px reports the identical bar: height 60,
menu at 16/14, glyph at 21/19, title at x 60 / y 13 — and the calendar's title
switching between `2. September 2026`, `31. August – 6. September 2026` and
`September 2026` moves nothing.

Two consequences worth knowing:
- **The screen title is now `text-heading` everywhere** (17px bold, the app's
  "title of a surface" token). 28px could not be the shared size — the
  calendar's week range does not fit at 28px even at 430px — and per-screen
  sizes are what this gap was about. Heute gained the title it never had
  ("Heute"); its greeting stays where it was, as page content, and is now an
  `<h2>` since the bar owns the `<h1>`.
- **The bar is `sticky`.** Aufgaben's header already was; Kalender's shell does
  not scroll, so it resolves to a normal position there; Heute and Mehr keep
  their bar in view like Aufgaben does.

Deliberately *not* changed: the task detail screen (its leading control is a
back button, not the menu) and the calendar's full-screen search (it covers the
calendar and carries its own chrome). Both are contexts, not main areas — if a
third one appears, give `TopBar` a `leading` slot rather than a second header.

`tools/smoke.mjs` compares the rendered bar across all five routes and fails if
one of them diverges or re-introduces a per-screen offset on the menu button.

### G10 · Typography values were literals, not tokens — closed 2026-09 (`tailwind.config.js`)
Sizes were written inline as `text-[15px]`, `text-[17px]`, `text-[12px]` and so
on: 141 occurrences across 26 files in 16 different sizes. The scale was *de
facto* consistent in the middle and ad hoc at the edges, and because it was not
defined anywhere, every new module had to re-invent it — which §15 forbids
outright ("do not independently invent typography values inside individual
modules").

**What was done, and where it stops.** The scale now exists as `fontSize` tokens
in `tailwind.config.js`, named by the roles §15 lists rather than by size:
`page` 28 · `section` 18 · `heading` 17 · `field` 16 · `body` 15 · `ui` 14 ·
`label` 13 · `caption` 12 · `meta` 11. Those nine cover 132 of the 141 call
sites. The existing literals were **not** migrated: that would be a rewrite of
every screen for no visible change, against Rule 0 and against Rule 2. New code
uses the tokens; an existing literal becomes a token when its line is being
edited anyway.

**Size only, on purpose.** A Tailwind `fontSize` entry can carry a line-height,
and this one does not. `text-[15px]` sets nothing but `font-size`, so a token
that also set `line-height` would silently change rendering the moment a literal
was migrated — the migration has to be a drop-in or it will not happen. Weight,
leading and tracking stay explicit utilities at the call site, where they
already are.

**Nine tokens, not sixteen.** `16px` is kept as its own step (`field`) because
form inputs need it: below 16px iOS zooms the page on focus. The leftovers —
9, 10, 19, 22, 24, 26, 34px — are single call sites and stay off the scale until
someone touches them; two roles genuinely disagree today (Home's section
headings are 16px where TaskDetail's are 18px), and the token picks 18px rather
than inventing a third value.

### G15 · The task-detail menu popover had no motion — closed 2026-09 (`src/screens/TaskDetail.jsx`, `tailwind.config.js`, `src/index.css`)
`TaskDetail.jsx` renders its own `absolute … z-20` overflow menu. It appeared
and vanished instantly (§11) and could not be closed with the keyboard at all —
only by tapping outside it.

**Local lifecycle, not the overlay system.** The menu is a small anchored
popover, not a modal: it dims nothing, blocks nothing, and traps nothing. Giving
it `usePresence` would have put it in the `overlayStack`, making it the topmost
surface and letting it take Escape from a sheet underneath — the same trap G18
and G21 refused for the toast. So it holds a three-state flag of its own,
`closed | open | leaving`, and an effect that cancels its own exit timer when
the phase changes, which is what lets a re-open mid-exit simply continue.

**It grows out of its trigger** (§11): `menu-in` / `menu-out` scale 0.95↔1 with
a fade over 120ms, anchored with `origin-top-right` on the panel, so the motion
starts at the button it belongs to instead of arriving from nowhere. Reduced
motion drops the scale and keeps the fade, next to the toast's exit it mirrors.

**Escape hands the focus back to the trigger.** Without that the items unmount
under the focus and it falls to `<body>` — the state G13 exists to prevent. The
listener is bound to `open` only and claims nothing from the overlay stack: it
does not have to, because every path that opens an overlay from this screen
closes the menu first. A leaving menu carries `inert`, so it stops being a Tab
stop and a click target while it is still on screen, and the tap-outside catcher
is rendered only while the menu is open, so the exit cannot swallow the next
tap. The tap-outside behaviour itself is unchanged.

Covered by `Menu` in `tools/smoke.mjs` (entry, exit, `inert`, focus hand-back,
tap-outside, re-open mid-exit). Mutation-tested: closing without the leaving
phase fails 2 assertions, not cancelling the exit timer on re-open fails the
interruptibility one.


### G18 · The toast had no exit — closed 2026-09 (`src/context/ToastContext.jsx`, `src/components/ToastHost.jsx`, `tailwind.config.js`, `src/index.css`)
Filed with G8. `ToastHost` played `animate-toast-in` and the element was then
simply dropped when the timer ran out, so the toast blinked away instead of
leaving — the one element in the app that arrived but never departed, against
§7 and against the spatial rule that what enters from the top leaves toward the
top (§11).

**The direction this entry used to give was wrong, and why is worth keeping.**
It proposed driving the card through `usePresence`, whose `panel()` sets
`[inert]` while exiting. But `usePresence` pushes into the `overlayStack`
unconditionally, and a toast in that stack is the topmost surface: it would take
Escape (closing the toast instead of the sheet being worked in) and the trap —
exactly the modality G21 refused to claim for it, dimming nothing and blocking
nothing. Reusing the presence machine would have meant a new flag inside it for
a single non-modal caller.

**One slot, one flag instead.** `ToastProvider` already holds exactly one toast
and owns its timer, so retiring became two steps: mark the payload `leaving`,
then drop it `TOAST_EXIT_MS` later. Timer expiry and `dismissToast` share that
path, so an expiry and a tap on the action leave identically. The replacement
the old note worried about is untouched: a new toast still arrives with its own
`id`, remounts and plays `toast-in` from the start, which is what keeps the live
region re-announcing (§22) — asserted, not assumed.

**G21's constraint, met without touching G21.** A leaving card carries `inert`,
and `focusableWithin` in `Overlay.jsx` already filters that attribute, so it
contributes nothing to the scope while it is still on screen — the same way a
leaving panel does not. It stays *registered* in `toastScope` until it actually
leaves the DOM, deliberately: the departure notification is what lets the active
surface take a focus back that fell to `<body>`, and announcing it at the start
of the exit would find the focus still on the card and repair nothing.

**What is not solved.** A toast replaced mid-exit restarts at opacity 0 rather
than continuing from what is on screen (§7's interruptibility). That is the
pre-existing behaviour of the remount and the price of keeping the re-announce;
fixing it needs presence per toast, which is still not worth its machinery.

Covered by `ToastExit` and `ToastReplace` in `tools/smoke.mjs`. Mutation-tested
both ways: dropping the toast without the leaving phase fails 3 assertions,
removing `inert` from the leaving card fails 2 — the second of which is the G21
one, so the Tab stop is proven to be closed by `inert` and not by chance.

### G21 · A toast action was outside the modal focus scope — closed 2026-09 (`src/lib/focusScope.js`, `src/lib/toastScope.js`, `src/components/Overlay.jsx`, `src/components/ToastHost.jsx`)
Filed with G13. `ToastHost` renders at `z-[60]`, outside every `.ov-root`, so an
actionable toast — "Aufgabe erledigt · Rückgängig" (G7/G8/G17) — floats above an
open overlay: hittable by pointer, but never a Tab stop inside the trapped
scope, while `aria-modal="true"` told assistive technology that nothing outside
the panel exists. Seeing an undo you cannot reach is the defect.

**The original note said no flow reached that state. That was wrong, and the
reasoning is worth keeping.** It looked only at where an actionable toast is
*raised* — `TaskDetail`, `TasksList`, `DayView`, all screens with no modal open.
But an actionable toast lives `TOAST_ACTION_MS` = 5s, and nothing retires it
when an overlay opens or the route changes: `dismissToast` is called by the
action itself and by nothing else, and `ToastProvider` sits above the router. So
the toast simply outlives its screen into a modal opened afterwards. Three
flows, all reachable today: abhaken in `TasksList` → Filter, FAB or Menü within
5s; abhaken in the day view's `TasksCollapsible` → tap an event; löschen in
`TaskDetail` → navigate → FAB.

**The toast joins the scope, not the overlay stack.** The direction this entry
used to give — make it a stack entry, `createOverlayStack` takes any entry — was
measured and dropped. As the top of the stack the toast would take Escape
(closing the toast instead of the sheet the user is working in) and the trap
(Tab circling one button while a whole form sits underneath), and it would claim
a modality it does not have: it dims nothing and blocks nothing. So the stack,
the Escape claim and the scroll lock are all untouched, and only the focus scope
grew.

**What grew, exactly.** `scopeElements` (pure, in `focusScope.js`) puts the
panel's controls first and the actionable toast last, and returns the index
where the toast begins. With no toast it returns the panel's own list and
`seam: -1`, which is what makes every overlay without a toast behave exactly as
it did under G13 — asserted, not assumed. `src/lib/toastScope.js` is one slot
plus a subscription, the same factory-and-instance shape as `scrollLock` and the
overlay stack; module-level rather than context, because `usePresence` runs
inside every overlay and a context would re-render every open sheet on every
toast. `ToastHost` registers only a card that has an action — a plain toast is a
message, not a control.

**Why a seam and not "claim every Tab".** G13 deliberately leaves the middle of
a scope to the browser, which knows about radio groups and a field's own
internal stops. That rule holds because a scope is contiguous in the DOM — and
this one is not: `ToastHost` is a sibling of the overlays, so the browser's
natural order does not lead from a panel's last control to the toast. Only the
two seam crossings are claimed. Inside the panel, and inside the toast, the
browser still has the middle. Verified in Chromium with the real Tab key, which
is the only way to see that the trap and the browser agree.

**Nesting needs no new rule.** Each overlay's Tab handler already asks
`overlayStack.isTop`, so the toast belongs to whichever overlay is topmost: with
a ConfirmDialog over an `EventDetailSheet` it is part of the dialog's ring and
the sheet underneath stays unreachable, and when the dialog closes the toast is
the sheet's last stop again — with no re-registration, because the scope is
computed per keypress, not at registration.

**The toast can also run out while it holds the focus.** The browser then drops
that focus on `<body>` — inside an open modal, the state G13 exists to prevent.
`nextFocus` would repair it at the next Tab, but a focus standing in the void
until the user presses a key is not a repair, so the departure is announced and
the active surface takes the focus back at once. Deliberately not "did the toast
have it?": a focus on `<body>` under an open modal belongs back in the scope
whatever put it there. The opposite direction is G13's own and unchanged — when
the overlay closes while the toast holds the focus, `shouldRestore` still
answers no, and the toast keeps it.

**Untouched on purpose:** `handleAction`, `dismissToast`, the follow-up-toast
ordering, every pointer path, the toast's position and styling, `sheetDrag.js`,
`overlayPresence.js`, the scroll lock and the Escape stack. `initialFocus` still
sees the panel's own list only — "where does the focus land when this opens?" is
a question about the panel, and an opening sheet must never focus a toast that
happens to be on screen. G18 stays open; the toast still has no exit.

Verified: 219 logic assertions across six suites (`tools/focusLogic.mjs` grew by
17, including the ends, the seam and both seam crossings) and the jsdom smoke
run (six new sections: sheet + toast, pointer regression, sheet + dialog +
toast, expiry under focus, the close-while-focused direction, and a non-modal
surface). Mutation-tested three ways: dropping the toast from the scope fails 4
logic and 6 smoke assertions; putting it first instead of last fails 6 logic and
2 smoke assertions; removing the focus reclaim fails the expiry case. Then 39
assertions in Chromium at 390×844 over native Tab, mouse and real touch. The
first ordering mutation only failed one assertion, which is what exposed that a
rotated ring walks identically — the ordering tests were re-pinned to the ends,
the seam and the entry from outside before being accepted.

### G13 · No focus trap in any overlay — closed 2026-09 (`src/lib/focusScope.js`, `src/lib/overlayPresence.js`, `src/components/Overlay.jsx`, `src/components/BottomSheet.jsx`, `src/components/ConfirmDialog.jsx`, `src/components/Sidebar.jsx`, `src/index.css`)
Three separate holes, all in the one shared layer, which is why no individual
sheet was touched to close them:

- **Nothing focused the panel.** Only `autoFocus` on a title field did, in two
  of eight overlays; everywhere else the focus stayed on the trigger *behind*
  the overlay.
- **Tab walked straight out.** In DOM order, so a `FilterSheet` (rendered inside
  `TasksList`) tabbed into the bottom nav and on into the sidebar. Meanwhile
  `role="dialog" aria-modal="true"` was already telling assistive technology the
  background was unreachable — a promise nothing kept.
- **Nothing gave the focus back.** Worse, the `inert` a leaving panel carries
  (G4) actively drops it on `<body>`, so the next Tab restarted at the top of
  the document.

**Why the obvious fix is the wrong one.** `ConfirmDialog` is rendered *inside*
the sheet it is opened from (`EventDetailSheet.jsx`), so its `.ov-root` is a DOM
descendant of the sheet's panel. Making the background unreachable by putting
`inert`/`aria-hidden` on everything but the top panel would have taken the
dialog down with the sheet: `inert` inherits into the subtree and a descendant
cannot opt back out. The scope therefore asks the **stack** who is on top,
exactly as Escape has since G4 — the sheet stops trapping the moment the dialog
registers above it, and starts again when the dialog is gone. No portal, no
change to the `transform: none` invariant G4 and G20 depend on.

**Shape.** `createEscapeStack` became `createOverlayStack` (`push/remove/isTop/
size`, `claim` still Escape-only) and registration no longer hangs off an
overlay having an `onEscape` — the stack is now the one answer to "which overlay
is the active surface?". `src/lib/focusScope.js` holds the three decisions as
pure functions (`initialFocus`, `nextFocus`, `shouldRestore`, checked by
`tools/focusLogic.mjs`); `Overlay.jsx` holds the DOM half, keyed on a new
`modal` option that only `<Overlay>` passes.

Details worth keeping:
- The trap claims **only the two edges**. Tabbing between two controls of a
  sheet stays the browser's job, which knows about radio groups and a field's
  own stops; the trap acts where the browser would leave the scope, and pulls a
  focus that is outside the scope entirely back to the near end.
- **Handing over is not restoring.** `EventDetailSheet` → "Bearbeiten" closes
  the sheet and opens `EventForm` in the same breath. `shouldRestore` gives the
  focus back only when the panel that is going away still has it or has already
  dropped it on `<body>`; anything else means another surface has taken over
  and keeps it.
- A panel with nothing focusable falls back to the root itself
  (`tabIndex={-1}`, with `.ov-root:focus { outline: none }` so no ring is drawn
  around a full-screen box).
- Pointer events are untouched throughout — G5's drag keeps every event it had.
- ARIA caught up in the same pass: the sheets and the dialog are now
  `aria-labelledby` their own visible titles, and the sidebar says what it has
  behaved like all along (`role="dialog" aria-modal="true" aria-label="Menü"`).

`SearchOverlay` deliberately gets none of it: it is non-modal (`modal` defaults
to `false`), because it covers the calendar instead of dimming it. See G21 for
the one thing G13 leaves open.

### G14 · No scroll lock behind an open overlay — closed 2026-09 (`src/lib/scrollLock.js`, `src/components/Overlay.jsx`, `src/index.css`)
The page behind a sheet scrolled with the wheel, with a finger on the backdrop
and with the keyboard — the last one most reliably of all, because G13 left the
focus on `<body>`, where Space and Page-Down scroll the document.

**Which scroller was actually moving** is what made the fix small. `.ov-root` is
`fixed inset-0` and the backdrop covers the whole viewport, so every gesture
lands on the backdrop — and a scroll walks the *DOM ancestor* chain from there
(backdrop → `.ov-root` → `.app-frame` → body → document), not what happens to be
visible behind the panel. It was always the document scroller, on every screen.
The calendar, whose views scroll inside their own containers, never scrolled
behind a sheet at all: those containers are not ancestors of the backdrop. So
one lock at document level covers everything and nothing needed locking per
container.

`src/lib/scrollLock.js` is a counted lock (overlays stack; a `ConfirmDialog`
over a sheet holds it twice) whose counting half is pure, so
`tools/overlayLogic.mjs` can check the balance — a count that never reaches zero
would leave the page permanently unscrollable. It is acquired for as long as the
overlay is `mounted`, **including `exiting`**: `.ov-root` drops its pointer
events while leaving (so the trigger underneath is reachable again), and without
the lock a gesture in those 300ms would scroll the page behind the departing
panel. Keying on `mounted` is also what balances the count across G4's
`exiting + open → open` edge — reopening mid-exit never leaves that window, so
the effect never re-runs.

Deliberately **not** gesture-based. A `touchmove` + `preventDefault`, or a global
`touch-action: none`, would have taken the events G5's drag-to-dismiss, the
sheet's own scrolling body and the calendar's swipe all live on. It is one
attribute on `<html>` and one CSS rule instead. No `position: fixed` on the body
either: `html` already has `height: 100%`, so `overflow: hidden` holds on iOS as
well, the scroll offset survives untouched, and G19/G20's
`--browser-bottom-inset` — derived from `lvh`/`dvh`, which the browser keeps
current by itself — needs no help. `scrollbar-gutter: stable` is set
unconditionally so hiding the desktop scrollbar cannot shift the centred
`.app-frame` sideways.

### G16 · A sheet that is already leaving could not be caught — closed 2026-09 (`src/lib/useSheetDrag.js`, `src/components/BottomSheet.jsx`, `src/index.css`, call sites; integrated with G13/G14)
§7 names both directions; G5 delivered only the first. The second was blocked
twice over, and both blockers were measured in Chromium before anything was
written: `.ov-panel[data-phase='exiting']` is `pointer-events: none`, **and** the
panel is `inert` — and an inert subtree ignores pointer input even where a
descendant sets `pointer-events: auto`, so relaxing the CSS alone changes
nothing. Either one alone is enough to swallow the press.

**What ships.** Only the exit the user threw away themselves is catchable, and
only on the handle. The marker was already in the DOM: `data-drag="exit"` is
written by the drag dismissal and by nothing else, so the backdrop, Escape,
Löschen, Bearbeiten and an action-sheet row all stay uncatchable — which is what
keeps a catch from reviving a deleted event or overtaking a form that is already
opening. A press pins the panel at its current visible offset and calls
`onReopen`, so the owner's state goes back to `open` for real and G4's own
`exiting + open → open` edge does the rest (and cancels its exit timer with it).
From there it is G5's drag, unchanged: released without moving the sheet stays
open, pulled up it stays open, pushed down it dismisses again on the same
`shouldDismiss` rule.

**Where `inert` sits, once G13 is in the picture.** The two features meet on one
attribute. G16 needs the leaving panel's root *not* to be inert, or the handle
cannot be pressed at all; G13 needs nothing inside a leaving panel to be a Tab
stop, and enforces it by filtering `[inert]` out of `focusableWithin`. Dropping
the attribute for the catch window would have satisfied the first and quietly
broken the second — a ~300ms hole in the trap, reachable after any self-thrown
dismissal.

So the attribute is not dropped, it **moves one level down**: for the catch
window the root gives it up and the sheet's scrolling body takes it over. That
is enough because of how a grabber sheet is built — every focusable element it
has lives in that body, while the handle strip above holds only the grabber and
the heading, neither of them a Tab stop. The focus trap and the browser's own
tab order both skip the body (`closest('[inert]')` and native inert agree), the
`aria-labelledby` heading stays outside it so the dialog keeps its accessible
name, and the body was already unreachable by pointer anyway — `.ov-root` drops
its pointer events while exiting. Outside the catch window the attribute is back
on the root and nothing differs from G13's own behaviour.

**Deliberately untouched by G16:** `overlayPresence.js`, `Overlay.jsx` and
`sheetDrag.js` — no new phase, no new event, no new constant. (G13/G14 do change
the first two; G16 rides on what they leave behind rather than adding to it.) No presence-state
hack: a phase faked without the owner would leave a sheet that can never be
closed again, because `usePresence`'s effect only re-fires when `open` changes.
The full-screen form sheets pass `enabled: false` and are not part of this.
Reduced motion needs no special case at all — `[data-drag='exit']` puts the
sheet at `translateY(100%)` in the same frame there, so the handle is already
off-screen and there is no travel to catch.

Opt-in per sheet: `ActionSheet`, `FilterSheet` and `EventDetailSheet` pass
`onReopen`; anything else keeps the old behaviour by simply not passing it.

Verified in Chromium at 390×844, 80 assertions across mouse and real touch
(CDP touch events): the catch pins with no jump (offset identical before and
after, then unchanged while held), the reopen is a real phase change, focus
lands exactly where a plain G5 drag leaves it, and every non-drag exit stays
inert with a dead handle. Deleting an event then pressing the leaving sheet
leaves it deleted; Bearbeiten does not let the detail sheet overtake the form;
reopening from the trigger during a self-thrown exit still works (G4); Escape
still peels a stacked ConfirmDialog one layer at a time; and after rapid
open/close cycles nothing is left mounted and no `data-drag` survives.

Re-verified after the integration with G13/G14, in the same harness: the catch
still pins without a jump and reopens for real, Tab during the catch window
reaches nothing inside the leaving sheet, the trap and Escape work again
immediately afterwards, the scroll lock is taken exactly once across the whole
exit-and-catch cycle, and the final close still hands the focus back.

**Known residual, accepted:** the action sheet's handle travels across the Plus
button during its exit, so within the ~300ms after a *self-thrown* dismissal a
tap on the trigger can land on the handle and catch the sheet instead of
reopening it from the trigger. Both bring the sheet back; only the timing of the
commit differs. Every other way of closing leaves the trigger exactly as
reachable as G4 made it.

### G20 · Overlays sat against the layout viewport too — closed 2026-09 (`src/components/Overlay.jsx`)
G19's case on a second surface: `.ov-root` is `fixed inset-0`, so the column
every panel positions itself in ended at the *layout* viewport — the height with
browser bars retracted — and a panel at `bottom: 0` therefore sat behind a
browser's own bottom bar. Reported for bottom sheets; it was never only the
sheets.

**Measured first, with G19's own 88px model, before anything was changed**
(Chromium, five viewports, each run twice — inset 0px and inset 88px). What was
actually unreachable behind the bar:

- `FilterSheet` — **"Anwenden" *and* "Zurücksetzen" start 7.5px below the
  visible edge**, i.e. entirely gone. The filter could be opened but not
  committed. The worst case of the set.
- `ActionSheet` — "Neuer Termin" 64px of 68px covered; only "Neue Aufgabe" was
  usable, so the Plus button silently lost half its purpose.
- `EventDetailSheet` — "Löschen" fully covered, "Bearbeiten" clipped by 1.5px.
- `TaskForm` / `EventForm` — the *last field*, 33px at 390×844 and 48px at
  390×600.
- `Sidebar` — at 820×700 the last entry was 88px covered **after scrolling the
  list to its very end**, i.e. not reachable at all. Not previously filed; it is
  the same bug, because the sidebar is `inset-y-0` in the same column.
- `ConfirmDialog` — not covered, but centred against `lvh`, so 44px too low.

**Two things the original G20 note got wrong, both corrected by measuring.**
The note blamed "the primary button in `TaskForm`/`EventForm`" — that button
lives in the sheet's *header* (`headerRight`) and was never affected;
`TaskForm.jsx` and `EventForm.jsx` are untouched by this fix. And scrolling was
assumed to be a way out: it is not. The scroll container itself ends behind the
bar, so at 390×600 the form's last field stayed 48px covered *after* being
scrolled to the end. That is what makes this a geometry bug rather than a
padding one.

**The fix is one class on one element** — the column inside `.ov-root` now ends
at `bottom: var(--browser-bottom-inset)` instead of at the layout bottom. No
new variable (G19's is reused verbatim), no JavaScript, no component, no token,
no motion, and no change to any panel's own CSS. One offset reaches every panel
because they all position themselves inside that column: both sheet variants,
the sidebar, and the dialog's centring box. `TaskForm`, `EventForm`,
`BottomSheet.jsx`, `index.css` and `tailwind.config.js` are not touched.

**The backdrop deliberately keeps `inset-0`.** It still covers the full layout
viewport, so the strip below a panel shows the dimmed app rather than a bright
gap in the moment a bar retracts.

**Why the offset went on the column and not on the sheet's content**, the
question G20 was filed with: padding inside the body would grow the panel by the
bar's height, and G5 takes its dismiss threshold from `getBoundingClientRect()`
— the action sheet's would have gone from 53.6px to 75.6px, a quarter of a
height that is partly invisible. The column keeps every panel's height exactly
as it was. Verified with real pointer gestures rather than by reading the code:
panel height 214.5px and threshold 53.6px in both builds, a 30px drag springs
back, a 107px drag dismisses, and an upward pull is damped to the same
-28.97px — identical with and without a bar.

**Verification.** One harness, run against the build before and against the
build after, and diffed. With the bar modelled, every "covered" line became
"clear": "Anwenden"/"Zurücksetzen" 32px, "Neuer Termin" 24px, "Löschen" 24px,
the forms' last field 40px, the sidebar's last entry reachable. Without the bar
the two reports are **byte-identical** (98 lines, same md5) across 820×1180,
390×844, 1280×900, 820×700 and 390×600 — iPad Safari, iPhone, Android and
desktop cannot see this change. `npm run build`, `npm run smoke` and
`npm run test:logic` (157 assertions incl. `overlayLogic` and `sheetLogic`) all
pass. Keyboard: the G3 ring is unchanged (2px solid at 2px offset), Enter on
"Anwenden" still commits, Escape still closes — and the keyboard case is what
showed the bug was not merely cosmetic, since "Anwenden" was focusable and
activatable while being invisible. Under `prefers-reduced-motion: reduce` the
panel still resolves to `transform: none`, `opacity: 1`,
`transition-property: opacity` — the fix adds no motion for G1's block to catch.
Document geometry is untouched: `scrollHeight` is identical with a sheet closed,
open, exiting and gone, and there is no horizontal overflow.

**One intended consequence, recorded so it is not read as a regression.** A
sheet's `max-h-[85%]` is a share of that column, so where a bar overlays, a tall
sheet is now clamped to 85% of what is *visible* and its body scrolls (event
detail at 390×844: 645.4px → 642.6px). That is the point — the alternative is a
sheet that is taller than the screen it is on. Where the inset is 0px the
heights are unchanged, which the byte-identical report above proves.

Left for their own tasks: **G13** (focus trap) and **G14** (scroll lock) still
belong in this same file, and were deliberately not bundled in — they change
behaviour, this changes geometry. Worth noting for whoever takes G14: because
the page behind an open sheet still scrolls, a browser bar can retract *while* a
sheet is open, and the sheet then travels down with it. That is coherent (it
stays flush with the visible edge, exactly like the navigation since G19) and it
is the same trade-off G19 accepted, but G14 would remove the scenario entirely.

### G17 · The Papierkorb has no restore path once the toast is gone — closed 2026-09 (`src/components/TaskRow.jsx`, `src/screens/TasksList.jsx`, `src/screens/TaskDetail.jsx`)
G8 built the operation and used it once. `restoreTask` — `{is_deleted: false,
deleted_at: null}` and nothing else — was reachable only from the undo toast,
so five seconds after a delete the way back was gone while the task itself was
still there, visible under "Gelöschte Aufgaben anzeigen". This closes that by
**giving the existing operation two more entry points**, not by writing a new
one: no context change, no selector change, no data change. `TasksContext` is
untouched.

**The row carries the way back, in the slot that had nothing to do.** A deleted
row already rendered a `StarButton`, but `TasksList` handed deleted rows only
`onOpen` — so that star animated on tap and toggled nothing. The `deleted`
variant now puts a `RotateCcw` button there instead, at the star's exact
geometry (`p-1`, `size={22}` → a 30×30 box, measured identical), with the same
`press-fade` the star and the completion circle use. So the change removes a
dead control and adds a live one without moving a pixel of the row.

**The circle was deliberately not reused.** It is the obvious symmetry — a
completed row's own circle un-completes it (G7) — and it is wrong here: the
circle means *completion state* on every other row, and an identically drawn
control that instead means "get this out of the trash" breaks the rule the
design system leads with (same look ⇒ same behaviour, §2). A different action
gets a different glyph.

**The detail view stops lying.** It used to offer "Löschen" for a task that was
already deleted, in both the bottom bar and the popover menu. A deleted task is
now a *state* of the same screen, not a second screen: the title takes the list
row's own treatment (`line-through text-text-muted`), a muted 12px line under
the subtitle says "Gelöscht am …" from `deleted_at` (§21 — the screen has to
say why it behaves differently), the two info rows stop opening the edit form,
and both the bar and the menu offer "Wiederherstellen" instead. The bar's
button wears the accent outline "Bearbeiten" already uses — a restore is
constructive, so it must not inherit the danger tint — and stands alone,
because it is the only thing worth doing to a task in the Papierkorb. Editing
sits behind it: a task is restored first and changed afterwards.

**Restoring from the detail does not navigate.** Deleting does (`navigate('/aufgaben')`,
because the screen's subject just left the list), but its inverse has no reason
to: the task is active again and this is the ordinary detail view of an active
task, so it simply re-renders with "Bearbeiten" and "Löschen" back and the
struck-through title gone. Verified in Chromium at both sizes.

**The confirmation is G8's own second step, reused verbatim.** Both entry
points raise the plain toast `'Aufgabe wiederhergestellt'` — the exact string
G8's undo already ends on — so the operation says the same thing wherever it is
reached from. It deliberately carries **no** action: G8's rule is that a toast
earns an undo slot when it is the only way back from something that left the
view, and a restore removes nothing. An undo-of-an-undo would also loop. The
5s actionable toast G8 built is untouched, and so is `ToastHost`.

**It adds no CSS, no token, no duration and no component.** `index.css` and
`tailwind.config.js` are not touched, which is why reduced motion needed no
work — there is no new motion for G1's block to catch. Verified under
`prefers-reduced-motion: reduce`: `animation-name: none` on the control, the
restore still commits and the toast still appears (feedback kept, §22).

`sort_order` needed no work either, and that is the point of restoring through
a patch: the delete never wrote it, so the row returns to the position it left.
`tools/restoreLogic.mjs` pins that promise without a browser — the patch clears
exactly two fields and nothing else; a task with `sort_order` 1 lands back
between 0 and 2 rather than at the end; the section is re-derived, so LATER,
MORGEN and the overdue roll-forward into HEUTE are each checked; and a task
that was completed *before* it was deleted comes back completed rather than
active. `tools/smoke.mjs` covers the two behavioural halves — the Papierkorb row
(hidden until the filter is on, restore control present with press feedback,
toast without an undo action, row active again and back between its neighbours)
and the detail (no "Löschen", no "Bearbeiten", the "Gelöscht am" line, restore
without navigating, normal actions back). Both blocks were mutation-tested:
reverting either half of the implementation fails 9 assertions.

Measured in Chromium at 390×844 and 1280×900, 68 checks: press feedback arms on
pointer-down and cancels on drag-off with nothing committed (§5), Tab reaches
the control and paints the G3 ring (2px solid at 2px offset), Space activates it
with the `data-pressed="key"` wash, the completed and active rows are unchanged
alongside, and G8's delete→undo round trip still behaves exactly as before. One
pre-existing 404 (a favicon probe that only mobile emulation triggers) was
confirmed against the reverted build and is not this change's.

Left open on purpose: the detail header's `StarButton` still works on a deleted
task. Unlike the row's, it has a live handler, so removing it would be a
behaviour change rather than the removal of a dead control — and a favourite
flag survives the restore, so it is not misleading.

### G19 · The bottom navigation sits behind the browser's own bottom bar — closed 2026-09 (`src/index.css`, `src/components/BottomNav.jsx`, `src/screens/TaskDetail.jsx`)
Reported from an iPad: in Chrome the navigation was invisible until the page was
scrolled, in Safari it was fine. Same device, and on iPadOS every browser is
WKWebView — so the CSS renders identically and the difference could only come
from how much of the page each browser covers with its own UI.

**What was wrong.** `position: fixed` resolves against the *layout* viewport,
which on iOS is always the large one (`lvh`) — the height with browser bars
retracted. It does not shrink when a browser lays a bar over the bottom, so
`bottom: 0` puts the navigation underneath that bar. iPad Safari has nothing
there, which is why the app looked correct on the exact device that reported it
broken. `env(safe-area-inset-bottom)`, the only compensation the bar had, cannot
help: it describes device hardware (home indicator, notch), never browser
chrome. Verified structurally first — `position: fixed` really is against the
viewport, no ancestor creates a containing block, and the `backdrop-filter` of
G11 is a child rather than an ancestor, so it is not the cause.

**The fix is one number, expressed in the two units that name it.** `100lvh` is
what `fixed` measures against, `100dvh` is what is actually visible, so their
difference *is* the overlay:

```css
--browser-bottom-inset: 0px;
@supports (height: 100dvh) and (height: 100lvh) {
  --browser-bottom-inset: calc(100lvh - 100dvh);
}
```

No JavaScript, no resize listener, no user-agent sniffing, no new component. The
`@supports` guard is not decoration: custom properties are not validated while
parsing, so without it a browser lacking the units would drop the value only at
computed-value time and `bottom` would fall back to `auto`, not to `0` — broken
instead of unchanged.

Two call sites carry it: the navigation itself, and the fixed action bar in
`TaskDetail` stacked directly on top of it, so the pair keeps its spacing either
way. **`Kalender.jsx` deliberately does not**, and this is the part worth
remembering: its container is already `height: 100dvh`, so it ends at the visible
bottom on its own and the existing `padding-bottom` reserve lands exactly on the
navigation's new position. Adding the offset there would have re-opened the same
gap, inverted. Measured: reserve 64px against a 57.5px bar, no gap, content above
the bar.

**A negative result, recorded so it is not re-attempted.** The obvious follow-up
question — the page can still be scrolled past its content into an empty strip —
looks like a height problem and is not one. The document has a hard floor at the
initial containing block: forcing `html`, `body`, `#root` and `.app-frame` to
200px leaves `scrollHeight` at the full 1180. So changing the `100%` chain to
`100dvh`, or `min-h-screen` to `min-h-dvh`, cannot shorten the document by a
single pixel — both were implemented, measured against the unfixed build and
reverted. On every route the app is already exactly viewport-height with **0px**
of document scroll; the travel a user feels is the browser retracting its own
bar, which iPad Safari does not have because there is no bar to retract. And
because `--browser-bottom-inset` is dynamic, the navigation follows that
retraction down instead of leaving a hole.

Verified in Chromium at 820×1180, 1180×820, 390×844 and 1280×900 across all
routes: the offset resolves to `0px` where nothing overlaps, the navigation and
action-bar rects are identical to `15c99a8` and 12 screenshots are pixel-equal,
so iPad Safari and desktop are untouched. With an 88px overlay modelled
arithmetically (variable set, every `100dvh` box shortened to match) the bar ends
exactly on the visible edge, the action bar keeps its distance, and a 30-row list
still scrolls with the last row reachable above it. Press feedback (G2), keyboard
activation, the focus ring (G3), the action sheet and `prefers-reduced-motion`
are unchanged — the fix introduces no motion.

Known trade-off: where a browser bar does overlay, the navigation now travels
with it as it retracts. A static alternative (`calc(100lvh - 100svh)`) would hold
it still but leave a gap once the bar is gone; the moving bar was preferred
because it always ends flush. Filed rather than fixed: **G20**, the same
structural case for bottom sheets.

### G7 · Task completion is a blocking 300ms timer — closed 2026-08 (`src/components/TaskRow.jsx`, `src/index.css`, `src/screens/TasksList.jsx`, `src/screens/calendar/DayView.jsx`)
The timer is gone: `onComplete` now runs from the circle's own click, and the
row's `completing` state, the `setTimeout` and the `.task-completing` animation
went with it. Nothing replaces the delay, because nothing needed it —
`.task-completing` existed only to fill the 300ms the commit was waiting on, and
the animation *was* the lock §7 names ("never create artificial interaction locks
solely because an animation is running"). Press feedback and cancellation were
already correct and are untouched: G2 arms `.press-fade` on pointer-down with the
8px slop, and the commit rides the native click, i.e. released inside the target
(§5). Removing the window between the tap and the commit is what makes the tap
cancellable in the ordinary way, verified in Chromium: press, drag off, release —
nothing happens.

**The undo is G8's shape, with G8's own asymmetry argument applied to a much more
frequent action.** The inverse already existed (`uncompleteTask`), so the whole
question was where the toast earns its place — a toast after *every* completion
would be noise (§18 "unobtrusive"), which the delete path never had to answer.
It therefore follows what the screen shows next, and each case ends with exactly
one piece of feedback:

- the completed row stays on screen (Filter → "Erledigte Aufgaben anzeigen") →
  **no toast**; the row restyles in place, struck through with the green check,
  and its own circle un-completes it — one tap where the finger already is. A
  toast would only repeat an affordance that is visible.
- the row leaves the view (the default Aufgaben list, and the calendar's day
  list, which is built from `tasksForDay` and only ever holds active tasks) →
  **"Aufgabe erledigt · Rückgängig"**, then "Aufgabe wieder offen". Here the
  toast is the only way back, exactly as it is for a deleted task (§19).

The decision is the caller's, as G8 established — `ToastContext` still knows
nothing about tasks. `TasksList` reads it from its own `filters.showCompleted`;
`DayView` has the constant answer. That the two screens repeat the handler
rather than share one is the app's existing habit for exactly this (`DayView` and
`WeekView` already repeat their "Termin verschoben" toast), and it keeps `src/lib`
free of context imports, which is the only reason it stays a pure layer.

**It adds no CSS, no token, no duration and no component** — `tailwind.config.js`
is untouched and `index.css` only *loses* three rules: `.task-completing`,
`@keyframes task-complete`, and the reduced-motion re-declaration that mapped it
to `reduced-fade-out` (whose keyframe, used by nothing else, went too). Reduced
motion therefore needed no work: the block G1 wrote no longer has a completion
animation to catch, and there is no new motion for it to miss.

The list is pixel-identical to `3a3b5a2` at 390×844 and 1280×900 with all three
row variants on screen (active, favourite, with due time, completed), and the row
geometry is unchanged to the half-pixel. `tools/smoke.mjs` covers both halves —
the commit lands 150ms after the tap (shorter than the timer it replaces, so a
re-introduced delay fails the test), the row goes, the toast carries the action,
undo brings the task back and retires the toast; and with the filter on the row
stays and *no* toast is raised. No new `tools/*Logic.mjs`: like G8 this has no
pure decision worth pinning — the one branch is a filter flag, and the risk is
behavioural.

Measured in Chromium at 390×844 and 1280×900: commit 31ms after release
(was 300ms), `is_completed` persisted, the circle already gone 20ms later and the
filter sheet openable immediately (no lock), drag-off cancel leaving the task
open, undo from the Kalender restoring the row, the G3 focus ring still 2px accent
at 2px offset on the circle with Enter completing, a 44px undo target, and
`prefers-reduced-motion` committing identically with the toast still on G1's
`reduced-fade-in`.

### G8 · Undo instead of "Bist du sicher?" — closed 2026-08 (`src/context/ToastContext.jsx`, `src/components/ToastHost.jsx`, `src/context/TasksContext.jsx`, `src/screens/TaskDetail.jsx`)
The app already did the hard part twice, which is why this stayed small:
deleting a task was **already** a soft delete, and every view **already** derives
from one `tasks` array through one predicate (`taskSelectors.isActive`). What was
missing was an action slot on the toast and the willingness to stop asking.

**One rule, and it generalises: reversible ⇒ undo toast; permanent ⇒ confirm.**
Deleting a task moves it to the Papierkorb, so it now commits on press and the
toast carries the way back — "Aufgabe gelöscht · Rückgängig", then "Aufgabe
wiederhergestellt" (§18/§19). Deleting a Termin is a hard delete with no
Papierkorb behind it, so it keeps `ConfirmDialog`. That asymmetry between two
deliberately identical detail screens is the point rather than an oversight: the
two dialogs already said the difference out loud — *"wird in den Papierkorb
verschoben"* versus *"wird dauerhaft gelöscht"* — and only the second is a
meaningful mistake to protect someone from. `ConfirmDialog` keeps that one call
site and gains a sharper meaning: it no longer means "delete", it means **this
cannot be taken back**.

**Undo is an inverse patch, never a deferred deletion.** `restoreTask` writes
`{is_deleted: false, deleted_at: null}` and nothing else, so a task edited during
the undo window keeps that edit, and `sort_order` — untouched by the delete —
returns the row to the position it left. The alternative, holding the delete back
until the toast expires, was measured against this and lost on every count: a
pending map, a timer holding data, a flush on unmount, filtering pending rows out
of every selector, and a reload mid-window silently aborting the delete. For a
state change that is *already* reversible it buys nothing.

**The extension to the toast is four additive lines of behaviour**, and every one
of the six existing call sites is untouched:

- `showToast(msg, { actionLabel, onAction })` — second argument optional
- the duration follows from the payload (2s plain, 5s actionable), because 2s
  cannot be read, decided on and reached; a per-call number would have made a
  system value a literal
- `pointer-events-auto` **only** when there is an action, so a plain toast still
  lets a tap through to the header it sits over
- `dismissToast()`, so pressing the action retires the toast

`ToastHost` dismisses *before* invoking the action: both land in one React batch,
so the caller's follow-up toast wins over the dismiss. And the wrapper now stays
mounted while idle — a `role="status"` that appears together with its own content
is not reliably announced (§22). That live region is new; the toast had none.

**It adds no CSS.** No keyframe, no token, no duration, no easing: `index.css` and
`tailwind.config.js` are untouched, which is also why reduced motion needed no
work — `.animate-toast-in` was already remapped to `reduced-fade-in` by G1, and
G8 introduces no motion for that block to catch. Verified: the plain toast is
pixel-identical to `3302641` (geometry, computed style and a clipped screenshot),
as are the Aufgaben list, the task detail and the calendar.

**The undo outlives the screen that created it.** `ToastProvider` sits above the
router, so the toast survives the `navigate('/aufgaben')` that follows the delete;
the callback closes over the task and over context callbacks whose providers stay
mounted, never over screen state. Deleting, routing to the Kalender and pressing
Rückgängig there restores the row — verified in Chromium.

**One toast, newest wins.** No queue and no "3 gelöscht" aggregation (§20): every
deletion is independently committed and independently recoverable from the
Papierkorb, so a superseded toast costs a convenience, not data. Verified that
undoing after two deletes restores only the second.

Two deviations found on the way and filed rather than fixed: **G17** (the
Papierkorb has no restore path once the toast is gone — which is what made undo
the app's only way back) and **G18** (the toast still has no exit).

`tools/smoke.mjs` covers the round trip in jsdom — no confirm, row gone, toast
plus action, row back, toast retired — and guards the calendar with the opposite
assertion, that deleting a Termin still raises "Termin löschen?". No new
`tools/*Logic.mjs`: G2, G4 and G5 each had a pure decision worth pinning (slop,
phase table, dismiss threshold); G8's only "decision" is a constant lookup, and
its real risk is behavioural. Chromium verified the rest at 390×844 and 1280×900:
press feedback on the action (arms on down, 8px slop, cancels on drag-off,
re-arms), Tab reach and Space/Enter activation with the `data-pressed="key"` wash
and the G3 ring, the 5s window and what expiry leaves behind, reduced motion, and
the accent label at 4.60:1 on `bg-elevated` (AA) with a 44px target.

### G5 · Sheet drag-to-dismiss — closed 2026-08 (`src/lib/sheetDrag.js`, `src/lib/useSheetDrag.js`, `src/components/BottomSheet.jsx`, `src/index.css`)
Implemented rather than removed: the grabber is now the visible part of a real
handle. Scope is the three sheets that draw one — `ActionSheet`, `FilterSheet`,
`EventDetailSheet`. `TaskForm` and `EventForm` never drew a grabber, promise no
gesture, and are untouched; they still close through their × button, which also
keeps an accidental swipe from silently discarding a half-filled form.

**The drag adds no motion of its own.** That is what kept it small. G4 had
already put every sheet on one CSS transition that interpolates from whatever is
currently on screen, so the gesture only ever changes that transition's target:

- `data-drag="live"` + `--ov-drag` — transition off, panel follows the finger 1:1
- released short → both removed, and the G4 transition carries the panel from
  where the finger left it back to `transform: none`
- released past the threshold → `data-drag="exit"` plus the ordinary `onClose()`,
  so the movement continues downwards while the presence machine unmounts

Closing by drag and closing by backdrop therefore end on the same path, at the
same 300ms and `cubic-bezier(0.16, 1, 0.3, 1)`. No new duration, no new easing,
no new colour, no spring system. `Overlay.jsx` and `overlayPresence.js` are not
touched, and the backdrop is deliberately not coupled to the drag.

**`transform: none` stayed the resting state.** When the attribute goes away the
panel is back to `none`, never `translateY(0)` — the invariant G4 established,
because any transform value creates a containing block and would re-anchor the
`position: fixed` ConfirmDialog that `EventDetailSheet` renders inside itself.
Measured before implementing: a `translateY(40px)` on the panel collapses that
dialog's full-screen root to 390×644 at (0, 200) on mobile and to 430×644 at
(425, 256) on desktop. Verified after: 390×844 and 1280×900 at (0, 0), unchanged.
The press feedback is colour-only for the same reason — a press that turns out to
be a tap must not move anything.

**`data-drag="exit"` is redundant while motion is on and decisive without it.**
Under `prefers-reduced-motion` the panel's resting transform is `none` in every
phase, so merely dropping the drag would snap the sheet back to the top and only
then fade it out — a jump in the middle of a dismissal. Both drag rules are
therefore re-declared inside the one existing reduced-motion block: the drag
itself stays (it is the user's own finger, §6, the same reasoning that keeps the
calendar drag and the task reorder), while the automatic half — the snap-back —
arrives instantly, exactly as movement transitions do there.

**The handle claims the gesture, nothing else does.** Without `touch-action` the
browser reads the first millimetre as a page pan and sends `pointercancel` after
one or two moves; measured on both a scrollable and a non-scrollable sheet. So
`.ov-sheet-handle` carries `touch-action: none` — the only one in the app, on a
54px strip (grabber row plus title). The body is deliberately not part of it: it
scrolls, and one surface cannot be both (§12). `TaskForm`'s 811/788px scroll is
untouched, and page scrolling, `useSwipe` and the dnd-kit reorder keep the
gesture budget G2 was careful to leave them.

**Distance or velocity decides, direction beats both.** 25% of the sheet's own
height (proportional: 215px action sheet vs 645px event detail), a downward
flick at 0.5px/ms dismisses well short of it, an upward flick at that speed keeps
the sheet even past it. Velocity is read over the last 80ms rather than the final
two points, because a finger is usually already slowing as it lifts. Upward drags
rubber-band asymptotically to 40px — resistance, not a frozen edge (§13).

The 8px slop is the app's existing one (`PRESS_SLOP`, `TAP_SLOP`), and it is
absorbed rather than applied: the origin is taken at the moment the gesture
engages, so the sheet starts from where it is instead of jumping the threshold.

`tools/sheetLogic.mjs` unit-tests the pure decisions (41 cases) as part of
`npm run test:logic`; the DOM side was verified in Chromium with real
touch/pointer events, including mid-enter interruption, reopen mid-exit and a
pixel-identical A/B of all sheets against `498e7f6`.

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
