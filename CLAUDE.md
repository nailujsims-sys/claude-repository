# Mind Whiteboard — project instructions for Claude Code

Mind Whiteboard is a dark, mobile-first personal productivity app (React + Vite +
Tailwind). Supabase is the single source of truth: email/password login, one
account, Row Level Security on every personal table, and no local fallback store
— without a configured backend the app says so and holds nothing. Modules today:
Startseite, Aufgaben, Kalender — built to grow module by module. See
`README.md` for the architecture and `supabase/README.md` for the backend.

## Deliverables — binding

**Every artifact is handed over as a PDF.** Analyses, reports, concepts,
reviews — anything that is a document rather than code ships as a `.pdf` file
sent to the user, not as chat text alone and not as an HTML artifact alone. An
artifact page may accompany it when a link is useful; the PDF is the deliverable
either way.

How to produce one in this environment (no extra dependencies needed):

1. Author the page as HTML (the design standard applies to it — see below).
2. Embed the fonts: fetch the Google Fonts CSS, inline each `woff2` as a
   `data:` URI. A PDF must not depend on a network at print time.
3. Prepend `<!doctype html><html lang="de"><head><meta charset="utf-8">` —
   without the charset, headless Chromium reads the file as windows-1252 and
   every umlaut in the PDF turns to mojibake.
4. Add a print block: `@page { size: A4; margin: 15mm 14mm 16mm; }`,
   `print-color-adjust: exact`, and `break-inside: avoid` on cards, table
   wrappers and list items.
5. Render:
   ```bash
   /opt/pw-browsers/chromium --headless --no-sandbox --disable-gpu \
     --no-pdf-header-footer --virtual-time-budget=8000 \
     --print-to-pdf=<Name>.pdf <datei>.html
   ```
6. Check the first page once (`--screenshot`), then send the PDF.

German file names, spelled out — the file name is read by a human.

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

## Deployment — binding

**A finished change is a change that is live** — or one explicitly reported as
not live, with the reason. "Pushed" is not "deployed".

### How production works here

Production is GitHub Pages, published by `.github/workflows/deploy.yml`. Two
facts decide the whole procedure:

- The workflow runs **only on the repository's default branch**
  (`claude/zen-mayer-bKTbe`). The `github-pages` environment refuses
  deployments from any other branch, so a push to a feature branch deploys
  nothing and adding feature branches to the trigger list only produces
  guaranteed-failing runs — that was tried and removed. Getting a commit live
  therefore means getting it onto the default branch.
- The workflow **is** the test gate and the live check: `npm run test:logic` →
  `npm run smoke` → `npm run build`, a check that the bundle carries
  `github.sha`, the Pages deploy, and finally a poll of the public
  `version.json` that fails the run unless the live site serves exactly that
  commit. **A green run is proof that the live site is current** — that is what
  makes the API-based verification below sufficient.

### The order of work, every time

1. Implement the change.
2. `npm run verify` — `test:logic`, `smoke`, `build`, the same three checks in
   the same order as CI.
3. Only when it is green: commit and push the feature branch
   (`git push -u origin <branch>`).
4. Deploy: open a pull request from the feature branch to
   `claude/zen-mayer-bKTbe` and merge it. The merge push starts the workflow.
5. Verify the deployment — do not assume it. Read the workflow run for the
   merge commit (GitHub Actions, or `actions_list` → `list_workflow_runs` for
   `deploy.yml`) and wait for it to complete. `success` = live. Anything else =
   not live.
6. Only then report the work as finished.

**Never deploy a red build or red tests.** If deploying is impossible — no
permission to merge, the workflow does not start, the run fails — report
**"NICHT LIVE"** and the reason. Never imply a change is live when it is not.

Note for sandboxed sessions: the live host (`*.github.io`) may be unreachable
through the egress proxy. Verify through the GitHub API then, and say so —
the run's own live check is what carries the proof, not a fetch you did.

### Report after every finished task

Every completion report must state, explicitly:

- **Commit** — the SHA (and the merge commit, if there is one)
- **Version** — `package.json`, when it changed
- **Tests / build** — the result of `npm run verify`
- **Deployment: LIVE or NICHT LIVE**
- If live: the confirmation that the new version is reachable in production
  (the green run, and what `/version` in the app now shows)

Versioning: a product change bumps `package.json` (a closed gap the minor
version, a fix the patch version); a process-only change does not.

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
