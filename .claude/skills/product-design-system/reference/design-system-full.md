# Product Design System — Personal Productivity App

## Purpose

This document defines the **visual, UX, interaction, motion, accessibility, and product-design standards** for this application.

Treat these rules as the **persistent design system and source of truth for the entire product**.

The application is a professional, modern personal productivity platform that brings together tasks, calendar, habits, notes, finances, and future modules into one coherent system.

The goal is **not to imitate Apple visually**.

Instead, the product should achieve the same qualities that make Apple's interfaces feel exceptional:

- immediate
- predictable
- calm
- responsive
- spatially coherent
- intuitive
- refined
- carefully crafted

The application must retain its **own visual identity**.

---

# 1. Core Product Philosophy

Every design and implementation decision should follow this priority:

1. **Intuitive**
2. **Consistent**
3. **Simple**
4. **Efficient**
5. **Scalable**
6. **Polished**

Do not add complexity merely because a technically sophisticated solution is possible.

Do not add animation merely because animation looks impressive.

Do not introduce a new interaction pattern when an existing application pattern can be reused.

The user should be able to use the application without needing to understand how it was built.

---

# 2. The Application Is One Product

The application consists of multiple modules, but the user must experience it as **one unified product**.

Examples of modules may include:

- Tasks
- Calendar
- Habits
- Notes
- Finances
- Future productivity modules

A new module must never feel like a separate application.

### Consistency rules

When a component or interaction already exists:

**Reuse it before creating a new variant.**

This applies to:

- buttons
- inputs
- dropdowns
- modals
- sheets
- side panels
- cards
- navigation
- filters
- tabs
- confirmation dialogs
- drag interactions
- loading states
- empty states
- success/error feedback
- animations
- typography
- spacing
- icons

If two elements perform the same function, they should behave the same way.

If two elements look the same, users should be able to expect the same behavior from them.

---

# 3. Existing Product Has Priority

Before changing or creating UI:

1. Inspect the existing implementation.
2. Identify existing reusable components and patterns.
3. Reuse them whenever appropriate.
4. Preserve working behavior unless there is a clear UX reason to improve it.
5. Do not redesign unrelated parts of the application simply because a new design principle exists.

### Important

This design system is intended to **improve and unify the existing product**, not to trigger unnecessary rewrites.

When a new requirement conflicts with an established pattern, evaluate the broader product first.

Prefer:

**small, consistent improvement**

over:

**large visual rewrite.**

---

# 4. Interaction Philosophy

The interface should feel like a direct extension of the user's actions.

The core principle is:

> **The interface should respond immediately to what the user is doing, while always allowing the user to change their mind before committing an action.**

Interactions should feel:

- immediate
- continuous
- reversible
- predictable
- controllable

Avoid interactions where the interface appears frozen while the user is acting.

---

# 5. Press, Release and Cancellation

This is a fundamental interaction rule.

### On pointer/touch down

Provide immediate visual feedback.

Examples:

- button becomes visually active
- item highlights
- checkbox responds visually
- draggable element begins responding

Do **not** wait until pointer-up merely to provide visual feedback.

### On pointer/touch up

The actual action may be committed.

### Cancellation

Users must be able to change their mind before releasing.

If appropriate for the interaction:

1. User presses an interactive element.
2. The element immediately shows active feedback.
3. User moves the pointer/finger outside the activation area.
4. The action becomes cancelled/inactive.
5. User may release → nothing happens.
6. User may move back into the activation area → the action becomes active again.
7. User releases inside → action commits.

This behavior should feel natural and familiar.

Do not force users to complete an action simply because they initially pressed the control.

Use appropriate hysteresis/movement thresholds so tiny accidental movements do not cause unwanted cancellation.

---

# 6. Direct Manipulation

For draggable or gesture-driven elements:

> **Content should follow the user's input directly.**

When dragging:

- track the user's movement continuously
- maintain the original grab offset
- never unexpectedly snap the element to the pointer
- avoid unnecessary delays
- continue tracking even if the pointer temporarily leaves the original element
- provide clear visual feedback that the element is being manipulated

Dragging should feel like the user is physically moving the object.

This is particularly important for:

- calendar events
- task reordering
- lists
- cards
- panels
- sheets
- future kanban-style interactions

---

# 7. Interruptibility

**All interactive animations must be interruptible whenever practical.**

The user should never have to wait for an animation to finish before interacting again.

Examples:

- A sheet is opening → the user can immediately drag it back.
- A panel is closing → the user can reverse it.
- A draggable element is moving toward a snap point → the user can grab it again.
- A transition is running → new input should take control immediately.

Never create artificial interaction locks solely because an animation is running.

When an animation is interrupted, continue from the element's **current visible state**, not from its previous logical target.

Avoid visible jumps.

---

# 8. Motion System

Motion should communicate:

- cause
- direction
- hierarchy
- spatial relationships
- state changes

Motion must never exist purely for decoration.

### Default motion character

The application's default motion should be:

- subtle
- smooth
- fast enough for productivity
- professional
- calm
- physically believable

Avoid:

- exaggerated bounce
- playful effects
- unnecessary parallax
- excessive scaling
- dramatic transitions
- animation-heavy interfaces

The application is a productivity tool.

**The user should notice the quality of the motion, not the existence of the animation.**

---

# 9. Springs

Use spring-based motion where the user directly manipulates an object or where physical continuity improves the interaction.

Good use cases:

- drag-and-drop
- sheets
- drawers
- panels
- snapping
- repositioning
- gesture-driven navigation
- momentum-driven interactions

For ordinary state changes, a short, simple transition is often preferable.

### Default spring behavior

Use a critically damped or near-critically-damped spring as the default.

Avoid visible bouncing unless momentum from the user's gesture naturally justifies it.

### Principle

**A user-driven movement may have physical momentum.  
A simple UI state change should usually not bounce.**

---

# 10. Velocity and Momentum

When an interaction involves meaningful movement or a flick:

- preserve the user's release velocity where appropriate
- allow momentum to influence the final resting position
- use sensible snap points
- avoid arbitrary snapping that ignores the direction and speed of the user's gesture

Examples:

- calendar navigation
- horizontal swiping
- draggable objects
- sheets
- carousels
- reorder interactions

Momentum should make the interface feel natural, not unpredictable.

---

# 11. Spatial Consistency

The application should maintain a strong spatial relationship between actions and their results.

Examples:

- A panel that enters from the right should normally leave toward the right.
- A popover should visually originate from its triggering control.
- A sheet should move in the direction implied by its interaction.
- Reversible interactions should use consistent paths.

Users should be able to understand:

**Where did this come from?  
Where will it go?  
What caused it?**

Avoid arbitrary movement.

---

# 12. Gesture Design

Gestures should be used only when they provide a clear benefit.

Do not hide important functionality behind gestures when an obvious visible control is more appropriate.

For gestures:

- provide immediate feedback
- track movement continuously
- use reasonable movement thresholds
- distinguish intentional gestures from accidental movement
- allow cancellation where appropriate
- preserve user control

Do not rely exclusively on a final "swipe detected" event when continuous feedback is possible.

---

# 13. Boundaries and Rubber-Banding

Where a physical interaction reaches a natural boundary, avoid making the interface feel completely frozen if a soft boundary improves the experience.

Rubber-banding may be appropriate for:

- mobile sheets
- gesture-driven navigation
- horizontal swiping
- certain scrolling interactions

It should **not** be added everywhere.

Use it only when it communicates a meaningful physical boundary.

---

# 14. Visual Design

The existing visual identity of the application takes priority.

The intended direction is:

- dark-mode-first
- modern
- professional
- mature
- calm
- minimal but not empty
- clear visual hierarchy
- restrained use of color
- one primary accent color
- generous spacing
- high information clarity

Do not introduce unnecessary visual effects merely to make the interface look more sophisticated.

---

# 15. Typography

Typography must be treated as a system.

Define and consistently reuse a hierarchy for:

- page titles
- section titles
- headings
- body text
- secondary text
- metadata
- labels
- captions
- numerical/financial information

Typography decisions should consider:

- font size
- weight
- line height
- letter spacing
- hierarchy
- readability

Large text may use tighter tracking.

Small text may require slightly more breathing room.

Do not independently invent typography values inside individual modules.

---

# 16. Spacing

Spacing must follow a consistent system.

Do not choose arbitrary pixel values for every component.

Related content should be grouped through proximity.

Unrelated content should have enough separation to establish hierarchy.

When creating a new component, first determine which existing spacing token or pattern it should use.

---

# 17. Hierarchy

Visual hierarchy should communicate importance immediately.

Use:

- size
- weight
- spacing
- contrast
- position
- grouping

Do not rely on color alone.

The most important information should be visually obvious without requiring the user to study the screen.

---

# 18. Feedback

Meaningful user actions should receive appropriate feedback.

Consider four types:

### Status
What is happening now?

### Completion
Did the action succeed?

### Warning
Is the user approaching a potentially problematic action?

### Error
What went wrong and how can it be fixed?

Feedback should be:

- immediate
- specific
- proportional
- unobtrusive

Avoid unnecessary confirmation dialogs.

Only interrupt the user when confirmation genuinely protects them from a meaningful mistake.

---

# 19. Agency and Forgiveness

The user should remain in control.

Prefer:

- undo
- reversible actions
- cancellation
- inline editing
- clear state changes

over:

- unnecessary confirmation dialogs
- irreversible actions
- forced workflows

When an action can reasonably be undone, prefer making it reversible rather than repeatedly asking:

> "Are you sure?"

---

# 20. Simplicity

**Simplicity does not mean removing useful functionality.**

It means reducing unnecessary cognitive effort.

Prefer:

- the common path first
- advanced options one level deeper
- clear labels
- obvious controls
- fewer steps
- sensible defaults

Do not hide important functionality simply to make a screen appear minimal.

---

# 21. Wayfinding

Every screen should make it clear:

- Where am I?
- What can I do here?
- Where can I go?
- How do I leave this context?

Navigation should never feel ambiguous.

Use clear and specific terminology.

Prefer names that describe actual content and functionality over vague labels.

---

# 22. Accessibility

Accessibility is part of the design system, not an afterthought.

Support:

- reduced motion
- sufficient contrast
- readable typography
- scalable text where technically appropriate
- sufficiently large interactive targets
- visible keyboard/focus states where relevant

### Reduced motion

When the user prefers reduced motion:

- remove unnecessary movement
- remove bounce/elastic effects
- replace large spatial animations with subtle fades or equivalent state changes
- preserve useful feedback

Reduced motion does **not** mean removing all feedback.

---

# 23. Sounds and Audio

**The application does not use sounds as part of its interaction design.**

Do not add:

- click sounds
- notification sounds
- success sounds
- interaction sounds
- decorative audio

unless explicitly requested later.

Audio is not part of the current product design system.

---

# 24. Haptics

Haptic feedback is **not a current priority**.

Do not implement haptics by default.

Potential future use cases may include:

- meaningful completion
- snapping
- important confirmations
- other interactions where tactile feedback clearly adds value

This should be evaluated separately during a later polish phase.

---

# 25. Materials, Glass and Translucency

Do **not** introduce a glass/translucency design system at this stage.

The current visual design should remain the foundation.

Potential future improvements may include:

- subtle translucent surfaces
- floating navigation
- deeper layering
- refined bottom navigation
- improved material hierarchy

These are **future polish opportunities**, not current requirements.

Never introduce them into a new module simply because they are technically possible.

---

# 26. Future Polish Phase

Once the application is functionally mature and has been used in real life, perform a dedicated UX polish review.

Possible areas to evaluate:

- floating bottom navigation
- refinement of the bottom action bar
- subtle material/translucency effects
- carefully selected haptics
- micro-interactions
- animation timing
- spacing refinement
- typography refinement
- interaction friction
- visual hierarchy
- real-world usability issues

These improvements should be based on **actual usage**, not added speculatively.

---

# 27. Design Principles

Use these principles when evaluating design decisions:

### Purpose
Every feature and element should have a clear reason to exist.

### Agency
The user remains in control and can recover from mistakes.

### Familiarity
Use patterns users already understand.

### Flexibility
Support different contexts, devices, and levels of expertise.

### Simplicity
Reduce cognitive load without unnecessarily removing functionality.

### Craft
Small details matter. Alignment, spacing, motion, typography and responsiveness should feel intentional.

### Delight
Delight should emerge from a well-designed product, not from decorative effects.

---

# 28. Decision Framework

When several implementations are possible, evaluate them in this order:

1. Is it intuitive?
2. Is it consistent with the existing application?
3. Is it the simplest solution?
4. Does it reduce user effort?
5. Is it scalable across future modules?
6. Does it feel polished?

If a new solution is technically impressive but less intuitive or less consistent, **do not use it**.

---

# 29. Before Implementing a New Feature

Before writing UI code for a new feature:

### Step 1 — Inspect
Understand the existing implementation.

### Step 2 — Identify
Find existing components and interaction patterns that can be reused.

### Step 3 — Compare
Check whether the proposed feature already exists in another module in a similar form.

### Step 4 — Design
Use existing patterns wherever possible.

### Step 5 — Implement
Build the smallest coherent solution.

### Step 6 — Review
Check the result against this design system.

### Step 7 — Refine
Only then address visual and interaction details.

---

# 30. When You Are Unsure

Do not invent a new design pattern immediately.

First ask:

> **"Does the application already solve a similar problem somewhere else?"**

If yes:

**reuse and adapt the existing pattern.**

If no:

choose the solution that is:

**most intuitive + most consistent + simplest + most scalable.**

---

# 31. Critical Implementation Rule

Do not blindly apply this document to unrelated existing code.

When working on an existing feature:

- preserve working functionality
- avoid unnecessary refactors
- avoid redesigning unrelated components
- minimize regression risk
- make improvements incrementally

When a change affects a shared component, consider its impact on every module using that component.

A design improvement that makes one screen better but breaks consistency elsewhere is **not an improvement**.

---

# 32. Definition of Done — UX/UI

A feature is not considered fully complete merely because it works technically.

Before considering the UI finished, verify:

- Is the interaction immediately responsive?
- Can the user understand what is happening?
- Can an action be cancelled where appropriate?
- Are animations interruptible where appropriate?
- Is motion subtle and purposeful?
- Does the feature reuse existing patterns?
- Does it look like it belongs to the same application?
- Is the hierarchy clear?
- Are spacing and typography consistent?
- Is feedback appropriate?
- Does it work well on the relevant device sizes?
- Does reduced motion behave sensibly?
- Have unnecessary effects been avoided?

---

# 33. Final Principle

The goal is not to make the application look like Apple.

The goal is to make the application feel **considered, direct, calm, predictable and exceptionally well crafted**.

Every interaction should communicate:

> **"The application understands what I am trying to do and gets out of my way."**

When in doubt:

**Choose the solution that makes the user's life easier, not the solution that makes the implementation more impressive.**