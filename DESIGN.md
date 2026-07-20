# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-20
- Primary product surfaces: repository graph, commit and WIP details, changed-file lists, file diffs, contextual review, and Git operation dialogs.
- Evidence reviewed: `PRODUCT.md`, `PLAN.md`, `README.md`, `docs/images/git-gud-history.png`, `docs/images/git-gud-diff.png`, the renderer components and theme tokens, and the supplied diff-view screenshots.

## Brand
- Personality: Focused, fast, trustworthy, and native to a professional macOS workflow.
- Trust signals: Repository state is explicit, destructive operations are scoped, and controls describe their effect.
- Avoid: Decorative chrome, duplicated information, oversized panels, novelty controls, and inactive product surfaces.

## Product goals
- Goals: Make local repository state legible; keep history, diff, staging, and review flows fast; preserve graph context while inspecting code.
- Non-goals: Cloud collaboration, promotional surfaces, or reproducing another product's branding.
- Success signals: Common Git inspection and mutation flows remain direct, keyboard-accessible, and understandable without leaving the app.

## Personas and jobs
- Primary personas: macOS developers and Git power users working in local repositories.
- User jobs: Understand history, inspect and compare code, stage precise changes, resolve conflicts, and perform branch operations confidently.
- Key contexts of use: Dense desktop windows, long file paths, large change sets, and repeated keyboard navigation between files.

## Information architecture
- Primary navigation: Repository tabs, sidebar/ref navigation, commit graph, commit detail, file detail, and contextual review.
- Core routes/screens: The app uses a single workspace route with stateful panels and focused overlays rather than page navigation.
- Content hierarchy: Repository and selection context first, then changed files, then the selected diff or review content.

## Design principles
- Repository truth comes first: Status, scope, and available operations must reflect Git state.
- Preserve flow: Keep inspection dense, keyboard-accessible, and spatially stable.
- Earn every control: Avoid duplicated actions or labels; one selected-file diff header contains the change icon, file path, necessary scope control, diff layout switch, and close action.
- Tradeoffs: Prefer a compact persistent control row over explanatory chrome; use tooltips and accessible labels for icon-only actions.

## Visual language
- Color: Use the existing dark theme and semantic status tokens; color supplements an icon or label and never carries meaning alone.
- Typography: System sans-serif for chrome and UI; system monospace for code, hashes, and command content.
- Spacing/layout rhythm: Dense 28–40px controls and headers, 4–8px internal gaps, and minimal vertical chrome around primary content.
- Shape/radius/elevation: Small radii and restrained borders; elevation is reserved for menus, popovers, and dialogs.
- Motion: Short functional transitions only, disabled under reduced-motion preferences.
- Imagery/iconography: Lucide icons, with distinct shapes for added, modified, renamed, and deleted file states.

## Components
- Existing components to reuse: Shared buttons, segmented controls, theme variables, `@pierre/diffs` renderers, file status colors, and modal/menu primitives.
- New/changed components: The selected-file diff header is a single compact panel; standard diffs use the same reliable syntax-highlighting path as contextual review.
- Variants and states: Commit, multi-commit, WIP staged/unstaged, loading, empty, binary, too-large, error, and unified/split diff layouts.
- Token/component ownership: Shared CSS variables and component classes live in `src/renderer/src/styles/main.css`; diff options and palette live under `src/renderer/src/components/commit` and `src/renderer/src/components/diff`.

## Accessibility
- Target standard: WCAG 2.2 AA.
- Keyboard/focus behavior: Focused panels accept Escape to close and arrow keys where documented; all actions remain native buttons.
- Contrast/readability: Use existing semantic text, border, selection, success, and danger tokens.
- Screen-reader semantics: Icon-only actions and file-state icons require accessible labels; headings and regions use semantic elements where practical.
- Reduced motion and sensory considerations: Respect `prefers-reduced-motion`; do not rely on color alone for file state or selection.

## Responsive behavior
- Supported breakpoints/devices: The macOS desktop app must remain useful in constrained split panels and at 200% zoom.
- Layout adaptations: Long paths truncate before controls; optional rename-source context may hide before primary file and diff actions.
- Touch/hover differences: Primary actions remain visible; hover may reveal secondary file actions but keyboard focus must reveal them too.

## Interaction states
- Loading: Centered, concise progress message with activity icon.
- Empty: Explain what selection is required or why no content exists.
- Error: Show the concrete operation or retrieval error in context.
- Success: Refresh repository truth and preserve the user's current spatial context where possible.
- Disabled: Keep controls legible and explain unavailable actions through title or adjacent context.
- Offline/slow network, if applicable: Core repository workflows are local-first; remote operations expose progress and cancellation.

## Content voice
- Tone: Direct, compact, and technical without jargon for its own sake.
- Terminology: Use Git terms such as commit, worktree, staged, diff, branch, and conflict consistently.
- Microcopy rules: Prefer action labels and concrete state; remove labels that merely repeat the surrounding context.

## Implementation constraints
- Framework/styling system: Electron, React 19, TypeScript, Tailwind v4 utilities, and repository CSS variables.
- Design-token constraints: Extend existing tokens and shared component classes before adding new styling layers.
- Performance constraints: Diff rendering must remain bounded for large files and change sets; binary and oversized content uses explicit fallbacks.
- Compatibility constraints: macOS is the supported build target; Git is provided by the user's environment.
- Test/screenshot expectations: Run focused tests, typecheck/lint/build as appropriate, exercise affected UI flows, and capture screenshots for UI changes.

## Open questions
- None for the current selected-file diff and syntax-highlighting work.
