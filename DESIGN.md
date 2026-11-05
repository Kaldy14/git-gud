# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-11-04
- Primary product surfaces: repository graph, commit and WIP details, changed-file lists, file diffs, contextual review, GitHub pull requests, persistent GitHub Actions and Portainer stack monitoring dashboards, and Git operation dialogs.
- Evidence reviewed: `PRODUCT.md`, `PLAN.md`, `README.md`, `docs/images/git-gud-history.png`, `docs/images/git-gud-diff.png`, `docs/images/git-gud-dashboard.png`, `.omx/artifacts/visual-ralph/dashboard-navigation/current-layout.png`, `.omx/artifacts/visual-ralph/dashboard-navigation/dashboard-header.png`, the renderer workspace, sidebar, dashboard source and CSS, GitHub query/IPC/store layers, Portainer API research, and the shared theme tokens.

## Brand
- Personality: Focused, fast, trustworthy, and native to a professional macOS workflow.
- Trust signals: Repository state is explicit, destructive operations are scoped, and controls describe their effect.
- Avoid: Decorative chrome, duplicated information, oversized panels, novelty controls, and inactive product surfaces.

## Product goals
- Goals: Make local repository state legible; keep history, diff, staging, and review flows fast; preserve graph context while inspecting code; let a developer monitor live GitHub Actions and selected Portainer Swarm or Compose stacks without leaving the app; let each Actions tile focus on exact branches, current tags, and pull requests authored by the connected GitHub user; and let developers edit and arrange saved tiles into the monitoring layout they need.
- Non-goals: General analytics, team administration, issue tracking, promotional surfaces, or reproducing another product's branding.
- Success signals: Common Git inspection and mutation flows remain direct and understandable; configured dashboards, edited tile settings, tile filters, and tile order survive restarts; workflow runs refresh automatically; each tile only shows runs matching its configured union of branch, tag, and authored-PR filters; and a run opens its canonical GitHub page in the system browser.

## Personas and jobs
- Primary personas: macOS developers and Git power users working in local repositories.
- User jobs: Understand history, inspect and compare code, stage precise changes, resolve conflicts, perform branch operations confidently, scan current CI health, and verify Portainer stack health, workload convergence, running age, and image freshness.
- Key contexts of use: Dense desktop windows, long file paths, large change sets, repeated keyboard navigation between files, and short monitoring checks while workflows are running.

## Information architecture
- Primary navigation: Repository tabs plus one fixed icon-only Dashboards tab in the title bar; the repository sidebar contains Pull requests and ref navigation only; dashboard names appear as tabs in the dashboard header.
- Core routes/screens: The app uses a single workspace route with stateful repository, dashboard, pull-request inbox, and pull-request review destinations rather than browser-style page navigation.
- Content hierarchy: The selected top-level tab first; within dashboards, the remembered dashboard tab and refresh state, then monitoring tiles, then workflow runs or Portainer workloads. Portainer connections are configured once and referenced by stack tiles rather than repeated per tile.

## Design principles
- Repository truth comes first: Status, scope, and available operations must reflect Git state.
- Preserve flow: Keep inspection dense, keyboard-accessible, and spatially stable; returning to Dashboards restores the last dashboard selected for the active GitHub profile.
- Earn every control: Avoid duplicated actions or labels; one selected-file diff header contains the change icon, file path, necessary scope control, diff layout switch, and close action.
- Spatial control is direct: Tile headers expose compact edit and drag controls; dragging gives immediate placement feedback and dropping persists the new reading order.
- Live truth is visible: Monitoring tiles show when data was loaded, distinguish running from completed workflows without color alone, and keep stale data visible during background refresh.
- Operational state is derived: A Portainer tile distinguishes stack configuration from live service/task health, and labels image freshness separately from rollout convergence.
- Tradeoffs: Prefer a compact persistent control row over explanatory chrome; use tooltips and accessible labels for icon-only actions.

## Visual language
- Color: One graphite frame (`#202329`) holds the toolbar, sidebar, and panels around the inset history and diff canvas (`#15171b`). The title strip is darker (`#111317`). Text uses three inks, with the middle ink `#bcc1cb` and the muted ink `#a0a7b3`. Teal marks the current position and primary actions; blue marks in-progress states. Borders between panels stay quiet; field boundaries and focus indicators remain distinct. Color supplements an icon or label and never carries meaning alone.
- Typography: The system UI font (SF on macOS, Segoe UI on Windows), with Open Sans as the bundled fallback and sentence-case section headings. The roles are Title 17/24 at 600, Heading 13/18 at 600, Body 13/20 at 400, Control 12/16 at 500, Meta 12/16 at 400, and Micro 11/14 at 400. Repository tabs and primary actions are a deliberate exception to Control: they stay at 13px so the move to the system font did not shrink them. The working weights are 400, 500, and 600; Segoe UI has no 500, so hierarchy never rests on 500 alone. Selection never changes weight, because that would re-truncate rows while arrowing through them. System monospace is reserved for code, hashes, and command content. Secondary text must remain readable against raised and selected surfaces.
- Spacing/layout rhythm: Dense 28–40px controls and headers, 4–8px internal gaps, minimal vertical chrome around primary content, and a responsive two-column tile grid that collapses at constrained widths. Dashboard-name tabs are compact, natural-width toolbar labels rather than boxed title-bar tabs.
- Shape/radius/elevation: 5px rows, 7px containers, rounded repository tabs, and restrained panel borders. Elevation is reserved for menus, popovers, and dialogs; dashboard tiles separate by tone, without a shadow. Segmented selections use a raised fill and a visible outline.
- Selection: History rows use a neutral full-row fill and brighter subject text, without a decorative side stripe. Selected row and pill surfaces differ by at least 3:1; labels and metadata retain at least 4.5:1 text contrast. Selected ref pills use an opaque dark surface and light text instead of blending into the row. Sidebar rows, the palette, and local review blocks use a fill plus a 3px teal leading edge, with no box outline. In the nested PR queue the selected block takes a neutral fill and the current file carries the teal.
- Terminal action: A panel's finishing action sits on its last row: Commit in the composer, Save settings in the drawer, Viewed & next in review.
- Motion: Short functional transitions only, disabled under reduced-motion preferences. Tile dragging uses border, opacity, and insertion feedback without decorative motion.
- Imagery/iconography: Lucide icons, with distinct shapes for added, modified, renamed, and deleted file states.

## Components
- Existing components to reuse: Shared buttons, segmented controls, toolbar typography and hover states, theme variables, `@pierre/diffs` renderers, file status colors, and modal/menu primitives.
- New/changed components: A fixed icon-only Dashboards title-bar tab, dashboard-name tabs followed immediately by the create-dashboard control, dashboard editor dialogs, reusable external-service connection dialog, GitHub Actions tile, Portainer stack tile for Swarm and Compose workloads, workflow-run filter controls, workflow-run row, Portainer service row, and a shared tile drag handle. The tile dialog supports both add and edit flows with the same native form controls; editing preserves the tile ID and grid position. The add-tile form reuses native text and checkbox controls for comma-separated exact branch names, current tag runs, and pull requests authored by the connected GitHub user. The GitHub tile header summarizes active filters. Dashboard-wide actions remain right-aligned. Dashboard content uses the full workspace width and does not render repository navigation. The selected-file diff header remains a single compact panel; standard diffs use the same reliable syntax-highlighting path as contextual review.
- Variants and states: Commit, multi-commit, WIP staged/unstaged, loading, empty, binary, too-large, error, unified/split diff layouts, dashboard with no tiles, tile loading/refresh/error/stale, unfiltered GitHub tile, filtered GitHub tile with no matching runs, queued/running/success/failure/cancelled workflow states, and healthy/updating/degraded/stopped/unavailable Portainer stack states. Image freshness uses up-to-date/update-available/checking/unknown states independently of workload health.
- Token/component ownership: Shared CSS variables and component classes live in `src/renderer/src/styles/main.css`; the repository launcher and clone/create form layout live in `src/renderer/src/styles/start-page.css`; dashboard UI and presentation helpers live under `src/renderer/src/components/dashboard`; GitHub-backed queries remain under `src/renderer/src/queries`.

## Accessibility
- Target standard: WCAG 2.2 AA.
- Keyboard/focus behavior: Focused panels accept Escape to close and arrow keys where documented; all actions remain native buttons. A focused tile drag handle moves its tile backward or forward with the arrow keys and announces its position, providing the same persisted ordering outcome as pointer drag and drop.
- Contrast/readability: Use existing semantic text, border, selection, success, and danger tokens.
- Screen-reader semantics: Icon-only actions and file-state icons require accessible labels; headings and regions use semantic elements where practical; workflow filter checkboxes use native labels; workflow rows expose status, repository, branch, and run name as text.
- Reduced motion and sensory considerations: Respect `prefers-reduced-motion`; do not rely on color alone for file state or selection.

## Responsive behavior
- Supported breakpoints/devices: The macOS desktop app must remain useful in constrained split panels and at 200% zoom.
- Layout adaptations: Long paths truncate before controls; optional rename-source context may hide before primary file and diff actions; dashboard tiles collapse from two columns to one without horizontal scrolling.
- Workspace tiers: At 1240px and above, panels follow saved width and collapse preferences. From 900 to 1239px the sidebar is the 36px rail and commit details stay docked per the saved preference. Below 900px details also start as a rail. Width comes from CSS pixels, so 200% zoom uses the lower tiers.
- Sidebar flyout: Below 1240px a rail click floats the full sidebar over the canvas at `min(saved width, 320px)`. The rail's 36px slot stays in the row, so the canvas does not reflow. It opens by click only, has no scrim, and stays open while comparing refs. It closes on Escape, its close button, an outside press, or navigation to another surface. Escape closes a context menu first. Escape and the button return focus to where it was; an outside press leaves focus alone. Rail sections open and scroll to that section, and active Solo or Hide filters always show a labelled rail count.
- Compact panel state: Below 1240px, panel actions are session state and never write saved preferences. Resize handles are hidden. From 900 to 1239px history and code keep separate detail choices, so closing details for a diff leaves history's panel open; below 900px they share one choice. WIP entries open details. Widening to 1240px clears session choices and restores saved state.
- PR chrome: At every window size, the title joins the repository/actions row and status, branch direction and diff counts share a metadata row. Metadata wraps when needed; secondary byline details give way at narrower widths. Tabs share one content edge. Scrolling condenses the metadata while retaining a visible heading.
- Repository tabs shrink within their strip before scrolling; text truncates within each tab, overflow edges fade and selecting a tab or resizing the strip brings the active tab into view. Active tabs use a neutral surface joined to the toolbar and a brighter label, with no decorative coloured edge; hover uses a quieter fill.
- Toolbar context gets spare space below 1280px rather than reserving an equal empty column to centre actions.
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
- Design-token constraints: Extend existing tokens and shared component classes before adding new styling layers. Element resets live in `@layer base` so Tailwind utilities apply to buttons and fields; unlayered component classes such as `btn-subtle` or `icon-btn` still win over utilities, so express variants with modifier classes (`btn-danger`, `icon-btn-danger`) rather than utility overrides. Dashboard header selection uses the existing active/inactive text hierarchy; it does not introduce per-tab borders, filled cells, or decorative accent underlines.
- Performance constraints: Diff rendering must remain bounded for large files and change sets; binary and oversized content uses explicit fallbacks. Filtered Actions tiles poll every 60 seconds, cache tag and pull-request metadata for 10 minutes, and disclose when matching stops after the latest 500 workflow runs.
- Compatibility constraints: macOS is the supported build target; Git and GitHub CLI are provided by the user's environment; GitHub dashboard access uses the GitHub CLI account connected to the selected Git profile. GitHub's workflow-run payload does not expose the historical triggering ref type, so tag filtering matches runs against the repository's current tag names and commit SHAs. Portainer access uses a user-created personal access token sent by the main process, with the base URL supporting HTTPS ports and reverse-proxy subpaths; secrets belong in OS-backed secure storage rather than renderer state or ordinary dashboard persistence.
- Test/screenshot expectations: Run focused parser/filter, persistence, IPC-validation, and renderer tests; run typecheck/lint/build; exercise dashboard creation, filtered GitHub and Portainer tile creation, live refresh, empty/error handling, and run opening; capture screenshots for UI changes.

## Open questions
- [x] The integration is verified against the documented Portainer 2.39.0 CE and Business Edition API contracts; connected installations remain discoverable through connection testing.
- [x] The first Portainer slice is monitoring-only; stack updates, restarts, and other write actions are excluded.
- [x] Tiles use ordered-grid rearrangement rather than freeform coordinates; the saved tile array is the persistent reading and layout order.

## Pull request workspace
- Approved direction (2026-09-07): Inbox A and Review C from the PR layout study.
- Inbox: One compact search and refresh row, action and repository scopes on the left, populated groups ordered by the next action. Recently pushed branches follow the review queue.
- Review: Keep the title bar and a 40px PR command row above the code. Repository navigation and its footer are hidden while reviewing pull requests.
- Navigation: Blocks and their files share a left directory tree. Only the selected block expands; progress, grouping explanation, filters, diff style, and Viewed & next stay in its footer. The selected file follows code scrolling without moving the reader's position.
- Context: Details, discussion, attached images, review submission, and merge confirmation open in a dismissible right panel. It docks from 1400px and overlays at narrower widths; code keeps its full vertical space. Closing a panel preserves its draft and restores focus.
- Keep Git's commit and branch review layout separate from the PR layout. Review and merge still require explicit submission; navigation never publishes local drafts.

## Repository UI polish
- The 44px repository toolbar groups contextual navigation, Git actions, and app actions. Actions have icon-plus-label controls; the Jump field exposes the command shortcut. Labels collapse at constrained widths while accessible names remain.
- Active repository tabs join the toolbar frame and retain a visible close action.
- History selection spans the whole row with brighter subject text and no decorative side stripe. Repeated lane bands and message ticks are removed. Ordinary commits always show their author avatar or initials at full opacity, including at rest. Author identity carries useful information and must not be hidden behind hover or selection. Merges are hollow 5px-radius rings, and WIP uses a neutral dashed node. Hollow nodes fill with `--graph-node-fill`, which follows the row's resting, hover, selected, bulk, and search-match background. Current-ref text is chosen for contrast. Ref chips use the cloud icon for a remote association, never the commit author's image. The graph keeps its existing topology and keyboard interaction.
- Each date group's first row carries its relative date as right-aligned Meta in the subject cell, beneath the group's top hairline. The history list reserves its 11px scrollbar gutter and the column header pads by the same amount, so header and row edges line up.
- Sidebar leaves are Body in the middle ink and section heads are Heading. Folders show only their chevron, and ordinary branch leaves have no icon. Chevrons and state icons (current, worktree, stash, tag) hang in the indent, so labels at one depth share an edge. Hashes are 11px monospace.
- The repository launcher places Open, Clone, and Create beside searchable recents. Clone and Create use one-column forms with visible labels, path previews, and disabled invalid submissions.
- Docked side panels are capped so commit subjects and code keep their width; below 1240px the sidebar gives way to a rail (see Responsive behavior). Graph columns fit the visible lanes; fitted widths never overwrite user preferences on window resize.
- Added and deleted diff lines use distinct backgrounds, inline word emphasis, and explicit plus/minus glyphs. Collapsed unchanged context remains neutral.
- Routine stage/unstage success stays in the changed-file list and live announcement; failures, conflicts, and slow operations retain operation cards.
- Settings and operation dialogs reuse the shared form-input class. The refresh and save behavior, confirmations, and Git operation contracts are unchanged.
- The Settings drawer is at most 560px wide. Each `.settings-group` is a heading above one bordered field surface whose `.settings-row` children are divided by hairlines: label and helper on the left (13px and 12px), control trailing, native checkboxes, and 96px right-aligned number fields. Syntax theme cards and the machine rows take the full row. Below a 420px group width, rows stack and checkboxes stay trailing.
- Author images appear only on the selected, hovered, or focused commit; the node title and row label keep authorship available at rest. Ref names use spare wide-window space before truncating.
- Palette abbreviations match visible labels; metadata supports direct keyword matches. The footer states the number of loaded commits searched.
- Empty repositories report branch/tag refs only and disable branch creation until the first commit exists.
- Git failures lead with a short summary. Multiline command output remains available in an expandable details section.

### Reading scale and run monitoring

- History subjects use 13px type in 30px rows. Code uses 13px monospace with 21px line spacing; settings helpers use 12px.
- Dashboard tiles at least 720px wide show each run as a 36px ledger line, with a bounded title track keeping workflow and run metadata nearby and the branch using spare width: icon, outcome, title, workflow, run number, branch, time, chevron. The title keeps at least 180px, and that floor is what sets the breakpoint. Narrower tiles use two lines, with the outcome after the title and one visible timestamp with the workflow and branch; there the branch truncates before the workflow name or run number. Trigger and start timestamps remain in accessible names. Job names are neutral with colored status icons, and in-progress CI uses info blue.
- Workflow names containing matrix expressions match their expanded runtime names without evaluating expressions, so dependency lines reflect the workflow definition.
- Review navigation, including Viewed & next, remains visibly unavailable while a comment composer is open.

- Resting muted metadata uses `#a0a7b3`. Selected graph rows raise metadata to `#e4e8ee`, with 4.81:1 contrast on the neutral `#5b6572` selection; bulk selection uses `#f1f3f5` metadata on `#626b77`, with 4.85:1 contrast. Palette footers use 12px; review scope and navigation hints use 11px. The PR-grouped Actions view uses at least 11px content type, and pending context loading stays info blue at every width.

- When the sidebar is 240px or narrower, ref hashes recede from its rows and remain available in full row tooltips. Workflow outcomes sit beside their names in the two-line and PR-grouped views, and lead the row in the ledger. Selected PR tabs retain teal under hover.
- Open comment composers keep their targets and typed text under Escape and review shortcuts. Gutter comment controls have accessible labels, and line composers stay beneath their selected line. Comment forms use UI type even inside code annotations.
- Queued workflow time describes waiting, and queued jobs do not present waiting time as execution duration. Graph subject suffixes use the shared muted text token; conflict output headings use sentence case.

### Review composition

- A comment marks its selected code line with a teal edge while retaining the addition/deletion background. Selected syntax tokens temporarily use one readable foreground, and the annotation gutter stays neutral. Selected line numbers use the diff foreground for contrast. The comment field uses the shared visible focus ring.
- File expansion choices use stable chunk identity so background context cannot reopen a collapsed card. Full context arriving mid-draft preserves the editor node, focus and caret.
- A loading PR count is unknown: show the spinner with a reserved blank count and announce loading.

- The review footer keeps its scrollable explanation and navigation controls separate from the fixed terminal action, so keyboard focus never falls under the action. Block position retains its right alignment when the explanation opens. The review footer runs in tab order: grouping explanation and position on one row, Filters and diff layout, shortcut hints, then Viewed & next and any error. On short panes the shortcut hints give way and the block list keeps more height. Unviewed blocks show a plain numeral; only viewed blocks show a tinted ring. File headers show the directory in muted ink and the basename in full ink, and the full path stays in the title and accessible name. Aggregate healthy status is neutral; current run/PR outcomes carry the status colour. Panel rails use matching open-panel icons.
- Review is the one solid teal action in PR Code. Viewed & next is a subtle, semibold button with a teal icon that loses its colour when disabled, on the footer's last row; local review keeps its primary Viewed action.

### Composer and dashboard edges

- The WIP header shows the file count; the branch stays in its title and accessible text. The composer shows the author name and identity source at 12px, adds the email inline when the row is at least 360px wide, and gives the full identity and source explanation in a tooltip on hover and keyboard focus. Commit summaries use 13px type.
- Dashboard tiles sit 15px from both window edges, counting the 11px scrollbar gutter on the right. Run times stay right-aligned beside the chevron, on the facts line in two-line rows and in their own column in the ledger.

- The launcher home uses a bounded 880px measure, with its tall-window offset based on the unfiltered recent list so filtering does not move the search field. Stacked narrow layouts and Clone/Create keep their top-aligned form placement.
