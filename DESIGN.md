# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-25
- Primary product surfaces: repository graph, commit and WIP details, changed-file lists, file diffs, contextual review, GitHub pull requests, persistent monitoring dashboards, and Git operation dialogs.
- Evidence reviewed: `PRODUCT.md`, `PLAN.md`, `README.md`, `docs/images/git-gud-history.png`, `docs/images/git-gud-diff.png`, the renderer workspace, sidebar, GitHub query/IPC/store layers, and the shared theme tokens.

## Brand
- Personality: Focused, fast, trustworthy, and native to a professional macOS workflow.
- Trust signals: Repository state is explicit, destructive operations are scoped, and controls describe their effect.
- Avoid: Decorative chrome, duplicated information, oversized panels, novelty controls, and inactive product surfaces.

## Product goals
- Goals: Make local repository state legible; keep history, diff, staging, and review flows fast; preserve graph context while inspecting code; let a developer monitor live GitHub Actions state for several projects without leaving the app.
- Non-goals: General analytics, team administration, issue tracking, promotional surfaces, or reproducing another product's branding.
- Success signals: Common Git inspection and mutation flows remain direct and understandable; configured dashboards survive restarts; workflow runs refresh automatically; and a run opens its canonical GitHub page in the system browser.

## Personas and jobs
- Primary personas: macOS developers and Git power users working in local repositories.
- User jobs: Understand history, inspect and compare code, stage precise changes, resolve conflicts, perform branch operations confidently, and scan current CI health across active projects.
- Key contexts of use: Dense desktop windows, long file paths, large change sets, repeated keyboard navigation between files, and short monitoring checks while workflows are running.

## Information architecture
- Primary navigation: Repository tabs, a single sidebar with Pull requests followed by an expandable Dashboards section, ref navigation, commit graph, commit detail, file detail, and contextual review.
- Core routes/screens: The app uses a single workspace route with stateful repository, dashboard, pull-request inbox, and pull-request review destinations rather than browser-style page navigation.
- Content hierarchy: The selected destination first; within dashboards, dashboard identity and refresh state, then project tiles, then individual workflow runs.

## Design principles
- Repository truth comes first: Status, scope, and available operations must reflect Git state.
- Preserve flow: Keep inspection dense, keyboard-accessible, and spatially stable.
- Earn every control: Avoid duplicated actions or labels; one selected-file diff header contains the change icon, file path, necessary scope control, diff layout switch, and close action.
- Live truth is visible: Monitoring tiles show when data was loaded, distinguish running from completed workflows without color alone, and keep stale data visible during background refresh.
- Tradeoffs: Prefer a compact persistent control row over explanatory chrome; use tooltips and accessible labels for icon-only actions.

## Visual language
- Color: Use the existing dark theme and semantic status tokens; color supplements an icon or label and never carries meaning alone.
- Typography: System sans-serif for chrome and UI; system monospace for code, hashes, and command content.
- Spacing/layout rhythm: Dense 28–40px controls and headers, 4–8px internal gaps, minimal vertical chrome around primary content, and a responsive two-column tile grid that collapses at constrained widths.
- Shape/radius/elevation: Small radii and restrained borders; elevation is reserved for menus, popovers, and dialogs.
- Motion: Short functional transitions only, disabled under reduced-motion preferences.
- Imagery/iconography: Lucide icons, with distinct shapes for added, modified, renamed, and deleted file states.

## Components
- Existing components to reuse: Shared buttons, segmented controls, theme variables, `@pierre/diffs` renderers, file status colors, and modal/menu primitives.
- New/changed components: Expandable dashboard navigation inside the existing repository sidebar, dashboard editor dialogs, GitHub Actions tile, and workflow-run row. The dashboard content area does not add a second navigation sidebar. The selected-file diff header remains a single compact panel; standard diffs use the same reliable syntax-highlighting path as contextual review.
- Variants and states: Commit, multi-commit, WIP staged/unstaged, loading, empty, binary, too-large, error, unified/split diff layouts, dashboard with no tiles, tile loading/refresh/error, and queued/running/success/failure/cancelled workflow states.
- Token/component ownership: Shared CSS variables and component classes live in `src/renderer/src/styles/main.css`; dashboard UI and presentation helpers live under `src/renderer/src/components/dashboard`; GitHub-backed queries remain under `src/renderer/src/queries`.

## Accessibility
- Target standard: WCAG 2.2 AA.
- Keyboard/focus behavior: Focused panels accept Escape to close and arrow keys where documented; all actions remain native buttons.
- Contrast/readability: Use existing semantic text, border, selection, success, and danger tokens.
- Screen-reader semantics: Icon-only actions and file-state icons require accessible labels; headings and regions use semantic elements where practical; workflow rows expose status, repository, branch, and run name as text.
- Reduced motion and sensory considerations: Respect `prefers-reduced-motion`; do not rely on color alone for file state or selection.

## Responsive behavior
- Supported breakpoints/devices: The macOS desktop app must remain useful in constrained split panels and at 200% zoom.
- Layout adaptations: Long paths truncate before controls; optional rename-source context may hide before primary file and diff actions; dashboard tiles collapse from two columns to one without horizontal scrolling.
- Touch/hover differences: Primary actions remain visible; hover may reveal secondary file actions but keyboard focus must reveal them too.

## Interaction states
- Loading: Centered, concise progress message with activity icon. Dashboard tiles use local skeleton/run placeholders so other projects remain readable.
- Empty: Explain what selection is required or why no content exists. An empty dashboard provides one direct “Add GitHub Actions tile” action.
- Error: Show the concrete operation or retrieval error in context. A failed tile keeps its last successful data visible when available and offers a retry.
- Success: Refresh repository or GitHub truth and preserve the user's current spatial context where possible.
- Disabled: Keep controls legible and explain unavailable actions through title or adjacent context.
- Offline/slow network, if applicable: Core repository workflows are local-first; remote operations expose progress and cancellation; dashboard tiles retain their configuration and clearly identify GitHub fetch failures.

## Content voice
- Tone: Direct, compact, and technical without jargon for its own sake.
- Terminology: Use Git terms such as commit, worktree, staged, diff, branch, conflict, workflow, and run consistently. Use “project” in setup copy and the canonical `owner/repository` name in monitoring views.
- Microcopy rules: Prefer action labels and concrete state; remove labels that merely repeat the surrounding context.

## Implementation constraints
- Framework/styling system: Electron, React 19, TypeScript, Tailwind v4 utilities, and repository CSS variables.
- Design-token constraints: Extend existing tokens and shared component classes before adding new styling layers.
- Performance constraints: Diff rendering must remain bounded for large files and change sets; binary and oversized content uses explicit fallbacks.
- Compatibility constraints: macOS is the supported build target; Git and GitHub CLI are provided by the user's environment; dashboard access uses the GitHub CLI account connected to the selected Git profile.
- Test/screenshot expectations: Run focused parser, persistence, IPC-validation, and renderer tests; run typecheck/lint/build; exercise dashboard creation, tile creation, live refresh, error/empty handling, and run opening; capture screenshots for UI changes.

## Open questions
- None for the first GitHub Actions-only dashboard slice. Additional tile types and freeform tile rearrangement remain intentionally out of scope.
