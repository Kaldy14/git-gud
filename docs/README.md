# git-gud

A personal macOS Git client (Electron + React), visually modeled on GitKraken. Product plan and milestones live in [PLAN.md](../PLAN.md).

## Status

- **M0 (scaffold + shell): done.** Tabs, repo open/validate, workspace persistence, and the full GitKraken-style UI shell.
- **M1 (Git kernel, reads, watchers, profiles): done.** The shell now uses typed IPC for live status, refs, remotes, worktrees, stashes, repository watchers, effective identity, and per-repo profile assignment.
- **M2 (commit graph): done.** The graph renders real Git history through a typed IPC query, shared lane engine, virtualized rows, WIP/stash nodes, refs, context menu placeholders, and load-more.
- **M3 (details, trees, diffs, commit flow): done.** Commit metadata, `@pierre/trees` changed-file views, `@pierre/diffs` patch rendering, WIP staging, commit, and amend are wired through typed IPC.
- **M4 (everyday branch operations): done.** Fetch, pull, push, branch create/delete/rename, checkout, merge, tags, stash operations, cherry-pick, revert, reset, conflict banner, operation log, and safe local undo are wired through typed IPC.
- **M5 (rebase and interactive rebase): done.** Standard rebase, interactive todo planning, reorder/reword/squash/fixup/drop, controlled editor scripts, rebase conflict continuation, and temp-repo integration tests are wired through typed IPC.
- **M6 (polish and power features): done.** Hunk/line-group staging, WIP file actions, shortcuts, Terminal button, settings, command dialogs, and large-repo graph defaults are wired through typed IPC.

The canonical milestone tracker is the **Progress Tracker** section in [PLAN.md](../PLAN.md); update it whenever milestone scope or status changes.

M4 follow-up debt is tracked in [PLAN.md](../PLAN.md): finish splitting the centralized operations module, add operation progress streaming, and add executor-level cancellation/streaming helpers.

## Renderer UI structure

```text
src/renderer/src/
  styles/main.css                     theme tokens (CSS variables) + shared component classes
  workspace/WorkspaceShell.tsx        composition root: tab strip, toolbar, sidebar, graph, detail, status bar
  state/workspace.ts                  Zustand store bridging window.api workspace IPC
  components/
    tabs/TabStrip.tsx                 title-bar repo tabs, + menu (open/recent), profile & settings buttons
    profile/ProfileMenu.tsx           profile create/assign popover backed by typed IPC
    toolbar/Toolbar.tsx               repository/branch selectors + stacked fetch/pull/push/branch/stash/undo actions
    sidebar/Sidebar.tsx               Local/Remote/Worktrees/Tags sections, filter input, collapse rail
    graph/GraphView.tsx               virtualized commit graph: ref chips, per-row SVG rails, nodes, date markers,
                                      arrow-key row navigation, viewport-clamped context menus, WIP status counts
    commit/CommitDetailPanel.tsx      commit metadata, author card, Path/Tree file list, WIP composer/actions
    diff/FileFocusView.tsx            selected-file patch view with unified/split diff modes and WIP hunk staging
    settings/SettingsPanel.tsx        app defaults for diff layout, graph loading, large-repo mode, and Terminal
    operations/ConflictBanner.tsx     merge/rebase/cherry-pick/revert conflict action banner
    operations/CommandDialog.tsx      app-native command confirmations and simple operation forms
    operations/QuickJumpDialog.tsx    fuzzy repo/branch jump dialog
    operations/OperationLog.tsx       compact pending/success/conflict/error operation log
    rebase/InteractiveRebaseDialog.tsx interactive rebase todo modal
    start/StartPage.tsx               empty-state start page with recent repositories
    statusbar/StatusBar.tsx           repo path + preview notice + version
```

## Theme

Dark slate palette defined as CSS variables in `styles/main.css` (`--bg-*`, `--text-1..3`, `--border*`, `--accent`). Branch lane colors (`LANE_COLORS`) and file status colors (`FILE_STATUS_COLORS`) live in `src/shared/graph.ts`. Components use Tailwind v4 utilities referencing the variables; repeated patterns (toolbar actions, chips, menus, segmented controls) are shared classes in `main.css`.

## Graph rendering model

Each row draws its own SVG cell from declarative `RailSegment`s (`through`, `stopTop`, `startBottom`, `curveIn`, `curveOut`) plus one node (`commit` avatar, `merge` dot, `stash` box, `wip` dashed ring). The shared M2 lane engine emits this shape from topo-ordered Git commits plus synthetic WIP/stash tips. Rail segments may carry `color`/`dashed` style metadata: lanes started by synthetic tips stay dashed in their override color all the way down to their base commit. Ref chips mark the checked-out branch (`current`, rendered filled and sorted first), and the commit-graph query keeps previous rows on screen during load-more refetches (scoped per repository).

## Commands

- `pnpm dev` — run the app (assumed already running during development)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — must pass at every milestone
- `pnpm build` — typecheck + production bundles
