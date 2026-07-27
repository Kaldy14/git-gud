# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-27
- Primary product surfaces: repository graph, commit and WIP details, changed-file lists, file diffs, contextual review, GitHub pull requests, persistent GitHub Actions and Portainer Swarm monitoring dashboards, and Git operation dialogs.
- Evidence reviewed: `PRODUCT.md`, `PLAN.md`, `README.md`, `docs/images/git-gud-history.png`, `docs/images/git-gud-diff.png`, `docs/images/git-gud-dashboard.png`, `.omx/artifacts/visual-ralph/dashboard-navigation/current-layout.png`, `.omx/artifacts/visual-ralph/dashboard-navigation/dashboard-header.png`, the renderer workspace, sidebar, dashboard source and CSS, GitHub query/IPC/store layers, Portainer API research, and the shared theme tokens.

## Brand
- Personality: Focused, fast, trustworthy, and native to a professional macOS workflow.
- Trust signals: Repository state is explicit, destructive operations are scoped, and controls describe their effect.
- Avoid: Decorative chrome, duplicated information, oversized panels, novelty controls, and inactive product surfaces.

## Product goals
- Goals: Make local repository state legible; keep history, diff, staging, and review flows fast; preserve graph context while inspecting code; let a developer monitor live GitHub Actions and selected Portainer Swarm stacks without leaving the app; let each Actions tile focus on exact branches, current tags, and pull requests authored by the connected GitHub user; and let developers edit and arrange saved tiles into the monitoring layout they need.
- Non-goals: General analytics, team administration, issue tracking, promotional surfaces, or reproducing another product's branding.
- Success signals: Common Git inspection and mutation flows remain direct and understandable; configured dashboards, edited tile settings, tile filters, and tile order survive restarts; workflow runs refresh automatically; each tile only shows runs matching its configured union of branch, tag, and authored-PR filters; and a run opens its canonical GitHub page in the system browser.

## Personas and jobs
- Primary personas: macOS developers and Git power users working in local repositories.
- User jobs: Understand history, inspect and compare code, stage precise changes, resolve conflicts, perform branch operations confidently, scan current CI health, and verify Swarm stack health, replica convergence, running age, and image freshness.
- Key contexts of use: Dense desktop windows, long file paths, large change sets, repeated keyboard navigation between files, and short monitoring checks while workflows are running.

## Information architecture
- Primary navigation: Repository tabs plus one fixed icon-only Dashboards tab in the title bar; the repository sidebar contains Pull requests and ref navigation only; dashboard names appear as tabs in the dashboard header.
- Core routes/screens: The app uses a single workspace route with stateful repository, dashboard, pull-request inbox, and pull-request review destinations rather than browser-style page navigation.
- Content hierarchy: The selected top-level tab first; within dashboards, the remembered dashboard tab and refresh state, then monitoring tiles, then workflow runs or Swarm services. Portainer connections are configured once and referenced by stack tiles rather than repeated per tile.

## Design principles
- Repository truth comes first: Status, scope, and available operations must reflect Git state.
- Preserve flow: Keep inspection dense, keyboard-accessible, and spatially stable; returning to Dashboards restores the last dashboard selected for the active GitHub profile.
- Earn every control: Avoid duplicated actions or labels; one selected-file diff header contains the change icon, file path, necessary scope control, diff layout switch, and close action.
- Spatial control is direct: Tile headers expose compact edit and drag controls; dragging gives immediate placement feedback and dropping persists the new reading order.
- Live truth is visible: Monitoring tiles show when data was loaded, distinguish running from completed workflows without color alone, and keep stale data visible during background refresh.
- Operational state is derived: A Portainer tile distinguishes stack configuration from live service/task health, and labels image freshness separately from rollout convergence.
- Tradeoffs: Prefer a compact persistent control row over explanatory chrome; use tooltips and accessible labels for icon-only actions.

## Visual language
- Color: Use the existing dark theme and semantic status tokens; color supplements an icon or label and never carries meaning alone.
- Typography: System sans-serif for chrome and UI; system monospace for code, hashes, and command content.
- Spacing/layout rhythm: Dense 28–40px controls and headers, 4–8px internal gaps, minimal vertical chrome around primary content, and a responsive two-column tile grid that collapses at constrained widths. Dashboard-name tabs are compact, natural-width toolbar labels rather than boxed title-bar tabs.
- Shape/radius/elevation: Small radii and restrained borders; elevation is reserved for menus, popovers, and dialogs.
- Motion: Short functional transitions only, disabled under reduced-motion preferences. Tile dragging uses border, opacity, and insertion feedback without decorative motion.
- Imagery/iconography: Lucide icons, with distinct shapes for added, modified, renamed, and deleted file states.

## Components
- Existing components to reuse: Shared buttons, segmented controls, toolbar typography and hover states, theme variables, `@pierre/diffs` renderers, file status colors, and modal/menu primitives.
- New/changed components: A fixed icon-only Dashboards title-bar tab, dashboard-name tabs followed immediately by the create-dashboard control, dashboard editor dialogs, reusable external-service connection dialog, GitHub Actions tile, Portainer Swarm stack tile, workflow-run filter controls, workflow-run row, Swarm service row, and a shared tile drag handle. The tile dialog supports both add and edit flows with the same native form controls; editing preserves the tile ID and grid position. The GitHub tile header summarizes active filters. Dashboard-wide actions remain right-aligned. Dashboard content uses the full workspace width and does not render repository navigation. The selected-file diff header remains a single compact panel; standard diffs use the same reliable syntax-highlighting path as contextual review.
- Variants and states: Commit, multi-commit, WIP staged/unstaged, loading, empty, binary, too-large, error, unified/split diff layouts, dashboard with no tiles, tile loading/refresh/error/stale, unfiltered GitHub tile, filtered GitHub tile with no matching runs, queued/running/success/failure/cancelled workflow states, and healthy/updating/degraded/stopped/unavailable Swarm states. Image freshness uses up-to-date/update-available/checking/unknown states independently of service health.
- Token/component ownership: Shared CSS variables and component classes live in `src/renderer/src/styles/main.css`; dashboard UI and presentation helpers live under `src/renderer/src/components/dashboard`; GitHub-backed queries remain under `src/renderer/src/queries`.

## Accessibility
- Target standard: WCAG 2.2 AA.
- Keyboard/focus behavior: Focused panels accept Escape to close and arrow keys where documented; all actions remain native buttons. A focused tile drag handle moves its tile backward or forward with the arrow keys and announces its position, providing the same persisted ordering outcome as pointer drag and drop.
- Contrast/readability: Use existing semantic text, border, selection, success, and danger tokens.
- Screen-reader semantics: Icon-only actions and file-state icons require accessible labels; headings and regions use semantic elements where practical; workflow filter checkboxes use native labels; workflow rows expose status, repository, branch, and run name as text.
- Reduced motion and sensory considerations: Respect `prefers-reduced-motion`; do not rely on color alone for file state or selection.

## Responsive behavior
- Supported breakpoints/devices: The macOS desktop app must remain useful in constrained split panels and at 200% zoom.
- Layout adaptations: Long paths truncate before controls; optional rename-source context may hide before primary file and diff actions; dashboard tiles collapse from two columns to one without horizontal scrolling.
- Touch/hover differences: Primary actions remain visible; hover may reveal secondary file actions but keyboard focus must reveal them too.

## Interaction states
- Loading: Centered, concise progress message with activity icon. Dashboard tiles use local skeleton/run placeholders so other projects remain readable.
- Empty: Explain what selection is required or why no content exists. An empty dashboard provides one direct “Add tile” action. A filtered GitHub tile distinguishes “no matching runs” from an unfiltered repository with no runs.
- Error: Show the concrete operation or retrieval error in context. A failed tile keeps its last successful data visible when available and offers a retry. Portainer authentication, TLS, environment access, deleted-stack, and registry-freshness errors remain distinguishable.
- Success: Refresh repository or GitHub truth and preserve the user's current spatial context where possible.
- Save failure: If editing or reordering cannot be saved, keep the last persisted tile configuration and show the concrete error in the dashboard header.
- Disabled: Keep controls legible and explain unavailable actions through title or adjacent context.
- Offline/slow network, if applicable: Core repository workflows are local-first; remote operations expose progress and cancellation; dashboard tiles retain their configuration and clearly identify GitHub or Portainer fetch failures. Portainer image-freshness checks may update less frequently than task health and display their own checked time.

## Content voice
- Tone: Direct, compact, and technical without jargon for its own sake.
- Terminology: Use Git terms such as commit, worktree, staged, diff, branch, tag, pull request, conflict, workflow, and run consistently. Use “project” in GitHub setup copy and the canonical `owner/repository` name in monitoring views. “My pull requests” means pull requests authored by the connected GitHub user. Use Portainer’s environment, stack, service, task, replica, image, and access token terminology.
- Microcopy rules: Prefer action labels and concrete state; remove labels that merely repeat the surrounding context. State that GitHub filters combine with OR semantics and that leaving all GitHub filter controls empty shows every run.

## Implementation constraints
- Framework/styling system: Electron, React 19, TypeScript, Tailwind v4 utilities, and repository CSS variables.
- Design-token constraints: Extend existing tokens and shared component classes before adding new styling layers. Dashboard header selection uses the existing active/inactive text hierarchy; it does not introduce per-tab borders, filled cells, or decorative accent underlines.
- Performance constraints: Diff rendering must remain bounded for large files and change sets; binary and oversized content uses explicit fallbacks. Filtered Actions tiles poll every 60 seconds, cache tag and pull-request metadata for 10 minutes, and disclose when matching stops after the latest 500 workflow runs.
- Compatibility constraints: macOS is the supported build target; Git and GitHub CLI are provided by the user's environment; GitHub dashboard access uses the GitHub CLI account connected to the selected Git profile. GitHub's workflow-run payload does not expose the historical triggering ref type, so tag filtering matches runs against the repository's current tag names and commit SHAs. Portainer access uses a user-created personal access token sent by the main process, with the base URL supporting HTTPS ports and reverse-proxy subpaths; secrets belong in OS-backed secure storage rather than renderer state or ordinary dashboard persistence.
- Test/screenshot expectations: Run focused parser/filter, persistence, IPC-validation, and renderer tests; run typecheck/lint/build; exercise dashboard creation, filtered GitHub and Portainer tile creation, live refresh, empty/error handling, and run opening; capture screenshots for UI changes.

## Open questions
- [x] The initial implementation targets the documented Portainer Business Edition 2.39.5 API contract; connected installations remain discoverable through connection testing.
- [x] The first Portainer slice is monitoring-only; stack updates, restarts, and other write actions are excluded.
- [x] Tiles use ordered-grid rearrangement rather than freeform coordinates; the saved tile array is the persistent reading and layout order.
