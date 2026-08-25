# Mind Whiteboard — project instructions for Claude Code

Mind Whiteboard is a dark, mobile-first personal productivity app (React + Vite +
Tailwind, Supabase with a localStorage fallback). Modules today: Startseite,
Aufgaben, Kalender — built to grow module by module. See `README.md` for the
architecture, data layer and setup.

## Design system — binding

**Before any work that touches the UI, read
[`.claude/skills/product-design-system/SKILL.md`](.claude/skills/product-design-system/SKILL.md).**

"Touches the UI" means: a screen, a component, a sheet, a dialog, navigation, an
animation, a gesture or drag interaction, spacing, typography, colors, or an
empty / loading / error state — and equally: reviewing UI code or planning a new
module.

That skill is the **source of truth for product design**. The unabridged standard
is `.claude/skills/product-design-system/reference/design-system-full.md`; the
known deviations of the current code are
`.claude/skills/product-design-system/reference/known-gaps.md`.

Non-negotiables, so they apply even before the skill is loaded:

1. **Reuse before you invent.** If a component, pattern or token already exists,
   use it. Same look ⇒ same behaviour.
2. **No unrequested refactors.** The design system exists to unify the product,
   not to justify rewrites. Prefer a small consistent improvement over a large
   visual rewrite; preserve working behaviour; never redesign unrelated
   components. Changing a shared component means checking every module that uses
   it.
3. **Interaction:** feedback on pointer *down*, commit on pointer *up*,
   cancellable in between; dragging follows the pointer 1:1; animations are
   interruptible and resume from the current visible state.
4. **Motion is subtle, purposeful and spatially coherent** — never decorative.
   What enters from one side leaves toward that side.
5. **Tokens, not literals.** Colors, radii and spacing come from
   `tailwind.config.js`; shared motion from `tailwind.config.js` + `src/index.css`.
6. **Prefer undo over "Are you sure?"** Only interrupt the user when confirmation
   protects them from a meaningful mistake.
7. **Respect `prefers-reduced-motion`:** drop movement, keep the feedback.
8. **Out of scope until explicitly requested:** sounds, haptics, and any
   glass/translucency material system.
9. **Decision order when several implementations work:** intuitive → consistent
   with the existing app → simplest → least user effort → scalable → polished.
   A technically impressive but less intuitive solution loses.
10. **Definition of Done is the UX checklist** at the end of the skill, not "it
    compiles".

If a task conflicts with these rules, say so and propose the smallest coherent
change — do not silently widen the scope.

## Working conventions

- Mobile-first at ~390px; the frame is capped to `max-width: 430px` (`.app-frame`).
- Navigation entries (bottom bar, sidebar, action sheet, "coming soon" modules)
  are config arrays in `src/config/navigation.js` — extend the config, not the
  components.
- Before a PR-sized change, run the existing checks:
  ```bash
  npm run build && npm run smoke && npm run test:logic
  ```
- German is the product's UI language; keep user-facing strings in German.
