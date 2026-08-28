---
name: product-design-system
description: The binding visual, UX, interaction, motion and accessibility standard for the Mind Whiteboard productivity app. Use for ANY work that touches the UI — building or changing a screen, component, sheet, dialog, animation, gesture, drag interaction, navigation, spacing, typography, colors or empty/loading/error states, and when reviewing UI code or planning a new module. Trigger words: UI, Screen, Komponente, Design, Layout, Animation, Motion, Gesture, Drag, Sheet, Modal, Button, Styling, Tailwind, UX, Barrierefreiheit, neues Modul.
---

# Product Design System — Mind Whiteboard

This skill is the **source of truth for product design** in this repository.
It is binding for every UI change. The complete, unabridged standard lives in
`reference/design-system-full.md` (33 sections) — read it whenever a decision is
not covered below, and treat it as authoritative over this summary.

## How to use this skill

1. **Before** writing UI code: read `reference/design-system-full.md` §29
   (Inspect → Identify → Compare → Design → Implement → Review → Refine).
2. **While** implementing: apply the operating rules below.
3. **After** implementing: walk the Definition of Done checklist.
4. Known, accepted deviations of the current codebase are tracked in
   `reference/known-gaps.md` — consult it before "fixing" something, and update
   it when a gap is closed.

## Rule 0 — Do not trigger refactors

This design system exists to **unify and improve the existing product**, never to
justify a rewrite. When touching existing code:

- preserve working functionality
- do not redesign unrelated components
- prefer a **small, consistent improvement** over a **large visual rewrite**
- a change to a shared component must be checked against *every* module using it
- an improvement that fixes one screen but breaks consistency elsewhere is **not
  an improvement**

Fix a gap listed in `reference/known-gaps.md` only when the current task already
touches that code, or when the user explicitly asks for it.

## Operating rules (condensed)

### Priority order
Intuitive → Consistent → Simple → Efficient → Scalable → Polished.
When a technically impressive solution is less intuitive or less consistent,
**do not use it**.

### One product
Tasks, Calendar and every future module must feel like one app. **Reuse an
existing component or pattern before creating a variant** — buttons, inputs,
sheets, dialogs, cards, tabs, filters, empty states, toasts, animations,
typography, spacing, icons. Same look ⇒ same behaviour.

### Press, release, cancel (§5)
- Visual feedback on **pointer down**, not on click.
- Commit on **pointer up**.
- Moving the pointer out of the target cancels; moving back re-arms.
- Use a movement threshold so tiny accidental motion does not cancel.

### Direct manipulation (§6)
Dragged content follows the pointer 1:1, keeps its original grab offset, never
snaps unexpectedly, keeps tracking when the pointer leaves the element.

### Interruptibility (§7)
Every interactive animation must be interruptible; continue from the **current
visible state**, never from the previous logical target. No interaction locks
just because an animation is running.

### Motion (§8–§11)
Subtle, fast, calm, physically believable, purposeful. No decorative motion, no
bounce on plain state changes, no parallax/dramatic transitions. Springs
(near-critically damped) for direct manipulation; short transitions for ordinary
state changes. Preserve release velocity where a flick is meaningful. Motion must
be spatially coherent: what enters from the right leaves to the right; a popover
originates from its trigger.

### Feedback & agency (§18–§19)
Immediate, specific, proportional, unobtrusive. Prefer **undo / reversible
actions / inline editing** over confirmation dialogs. Only interrupt the user
when confirmation genuinely protects them from a meaningful mistake.

### Visual system (§14–§17)
Dark-mode-first, professional, calm, minimal but not empty, one primary accent,
generous spacing, clear hierarchy through size/weight/spacing/contrast/position
— never through color alone. Typography and spacing are systems: **never invent
per-component values**; pick an existing token first.

### Accessibility (§22)
Reduced motion, sufficient contrast, readable type, large-enough targets, visible
focus states. Under `prefers-reduced-motion`: remove movement and elastic
effects, replace large spatial animation with a fade — but **keep the feedback**.

### Explicitly out of scope right now (§23–§25)
No sounds. No haptics. No glass/translucency design system. Do not add these to a
new module just because they are technically possible.

**Chrome surfaces are opaque.** A bar that stays put while content scrolls
underneath — the bottom navigation, a sticky header — uses `bg-bg-base` and
nothing else: no alpha, no `backdrop-filter`, no `blur()`. Both surfaces in the
app do this today (G11). There is deliberately no material token to reach for; if
a surface seems to need one, that is a design decision for the polish phase
(§26), not a local choice.

## This repository's existing vocabulary

Reuse these before inventing anything:

| Need | Use |
|---|---|
| Design tokens | `tailwind.config.js` (`bg-base`, `bg-card`, `bg-elevated`, `bg-input`, `accent`, `accent-dim`, `text-primary/secondary/muted`, `danger`, `success`, `border-subtle`, radii `card/btn/input/chip`) |
| Type scale (§15) | `tailwind.config.js` (`fontSize`) — see the table below. **Never write `text-[Npx]` in new code.** |
| Global motion / keyframes | `tailwind.config.js` (`animation`) + `src/index.css` (`page`, `cal-enter-*`, `task-completing`, `press-tint`, `skeleton-shimmer`) |
| Press feedback on icon buttons | `.press-tint` (`src/index.css`) — touch-safe, `:hover` only on real pointers |
| Modal / panel scaffolding | `src/components/Overlay.jsx` (backdrop, Esc, phone-frame column) |
| Sheets | `src/components/BottomSheet.jsx` (`full` and auto-height variants) |
| Destructive confirmation | `src/components/ConfirmDialog.jsx` |
| Transient feedback | `src/context/ToastContext.jsx` + `ToastHost.jsx` |
| Loading states | `src/components/Skeleton.jsx` |
| Favorite toggle | `src/components/StarButton.jsx` |
| List row | `src/components/TaskRow.jsx` |
| Date picking | `InlineCalendar.jsx` (form) · `MiniCalendar.jsx` (calendar header) |
| Direct-manipulation drag/resize | `src/screens/calendar/useTimedGesture.js` (long-press grab, pointer capture, cancel-safe — the reference implementation for §5–§7) |
| Period swiping | `src/screens/calendar/useSwipe.js` |
| List reordering | `@dnd-kit` in `src/screens/TasksList.jsx` (TouchSensor delay 250 / tolerance 6) |
| Navigation entries | `src/config/navigation.js` (config arrays — no component edits needed) |
| Persistent chrome surface (§25) | Opaque `bg-bg-base` — `BottomNav.jsx` and the sticky header in `TasksList.jsx`. **No translucency, no `backdrop-filter`.** |

Layout is mobile-first (~390px), capped at `max-width: 430px` (`.app-frame`).

### Type scale (§15)

Pick by **role**, not by pixel size. These are the sizes the app already used;
G10 only gave them names.

| Token | Size | Use it for |
|---|---|---|
| `text-title` | 28px | The screen title (`<h1>`) |
| `text-section-title` | 18px | A section heading inside a screen |
| `text-panel-title` | 17px | The title of a sheet, dialog or the sidebar |
| `text-card-title` | 16px | The heading of a card |
| `text-field` | 16px | A form's primary text field |
| `text-body` | 15px | Default text and controls — the app's workhorse |
| `text-body-sm` | 14px | Quieter body text, compact controls |
| `text-label` | 13px | Form labels, chips, hints, inline errors |
| `text-meta` | 12px | Metadata next to primary content |
| `text-caption` | 11px | Tab labels, weekday headers, section labels |
| `text-micro` | 10px | Micro labels in the calendar grid |

Rules:

- **Never write `text-[Npx]` in new code.** If no token fits the role, that is a
  design decision — raise it, do not invent a size.
- The tokens set **font-size only**. Line-height stays inherited (1.5) plus the
  existing local `leading-*` overrides. Adding line-heights to the scale is a
  separate, visible design change (see G16 in `reference/known-gaps.md`).
- `text-card-title` and `text-field` are both 16px on purpose: two roles that
  happen to share a size today. Pick the one that describes what you are
  building, so the two can diverge later without a hunt.
- Six one-off display sizes stay literals (9, 19, 22, 24, 26, 34px) and are
  marked with a comment at their call site. Do not copy them into new code.

## Definition of Done — UX/UI

A feature is not done because it works. Verify:

- [ ] Interaction responds on press, not only on release
- [ ] The action can be cancelled before commit where appropriate
- [ ] Animations are interruptible where appropriate
- [ ] Motion is subtle, purposeful, spatially coherent
- [ ] Existing components/patterns reused instead of new variants
- [ ] It visibly belongs to the same application
- [ ] Hierarchy is clear; spacing and typography use existing tokens
- [ ] Feedback is immediate, specific, proportional, unobtrusive
- [ ] Works at the relevant device sizes (390px first)
- [ ] `prefers-reduced-motion` behaves sensibly (no movement, feedback kept)
- [ ] No sounds, haptics or glass effects introduced
- [ ] No unrelated component was refactored
