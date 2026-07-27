# git-gud

A personal macOS Git client (Electron + React), visually modeled on GitKraken. Product plan and milestones live in [PLAN.md](../PLAN.md).

## Status

- **M0 (scaffold + shell): done.** Tabs, repo open/validate, workspace persistence, and the full GitKraken-style UI shell.
- **M1 (Git kernel, reads, watchers, profiles): done.** The shell now uses typed IPC for live status, refs, remotes, worktrees, stashes, repository watchers, effective identity, and per-repo profile assignment.
- **M2 (commit graph): done.** The graph renders real Git history through a typed IPC query, shared lane engine, virtualized rows, WIP/stash nodes, refs, context menu placeholders, and load-more.
- **M3 (details, trees, diffs, commit flow): done.** Commit metadata, `@pierre/trees` changed-file views, `@pierre/diffs` patch rendering, WIP staging, commit, and amend are wired through typed IPC.
- **M4 (everyday branch operations): done.** Fetch, pull, push, branch create/delete/rename, checkout, merge, tags, stash operations, cherry-pick, revert, reset, conflict banner, operation log, and safe local undo are wired through typed IPC.
- **M5 (rebase and interactive rebase): done.** Standard rebase, interactive todo planning, reorder/reword/squash/fixup/drop, controlled editor scripts, rebase conflict continuation, and temp-repo integration tests are wired through typed IPC.
- **M6 (polish and power features): done.** Hunk/line-group staging, WIP file actions, keyboard navigation, responsive panels, command palette, repository inspection, advanced profiles, progress/cancellation, settings, and large-repo graph defaults are wired through typed IPC.

The canonical milestone tracker is the **Progress Tracker** section in [PLAN.md](../PLAN.md); update it whenever milestone scope or status changes.

The M4 reliability follow-up is tracked in [PLAN.md](../PLAN.md): progress streaming and safe cancellation are complete; splitting the centralized operations module remains an optional maintenance refactor.

## Renderer UI structure

```text
src/renderer/src/
  styles/main.css                     theme tokens (CSS variables) + shared component classes
  workspace/WorkspaceShell.tsx        composition root: tab strip, toolbar, sidebar, graph, detail, status bar
  state/workspace.ts                  Zustand store bridging window.api workspace IPC
  components/
    tabs/TabStrip.tsx                 title-bar repo tabs, + menu (open/recent), profile & settings buttons
    profile/ProfileMenu.tsx           profile create/edit/assign popover with identity, SSH, signing, and remote matching
    toolbar/Toolbar.tsx               repository/branch selectors + stacked fetch/pull/push/branch/stash/undo actions
    sidebar/Sidebar.tsx               PR destination, expandable dashboard list, refs sections, collapse rail
    dashboard/DashboardView.tsx       GitHub Actions tiles, live run rows, dashboard and tile dialogs
    github/PullRequestInboxView.tsx   profile-scoped GitHub pull-request inbox
    github/PullRequestReviewView.tsx  focused PR review, local line/file drafts, comment editing, submission
    graph/GraphView.tsx               virtualized commit graph: ref chips, per-row SVG rails, nodes, date markers,
                                      arrow-key row navigation, viewport-clamped context menus, WIP status counts
    commit/CommitDetailPanel.tsx      commit metadata, author card, Path/Tree file list, WIP composer/actions
    diff/FileFocusView.tsx            selected-file patch view with unified/split diff modes and WIP hunk staging
    review/ReviewView.tsx              focused local/GitHub review with expandable context above and below each hunk
    settings/SettingsPanel.tsx        app defaults for diff layout, graph loading, and large-repo mode
    operations/ConflictBanner.tsx     merge/rebase/cherry-pick/revert conflict action banner
    operations/CommandDialog.tsx      app-native command confirmations and simple operation forms
    inspection/RepositoryInspectorDialog.tsx file history, blame, and ref comparison dialog
    operations/QuickJumpDialog.tsx    command palette for commits, refs, repos, stashes, worktrees, and app actions
    operations/OperationLog.tsx       streamed pending/success/conflict/error/cancelled operation log
    rebase/InteractiveRebaseDialog.tsx interactive rebase todo modal
    start/StartPage.tsx               empty-state start page with recent repositories
    statusbar/StatusBar.tsx           repo path + preview notice + version
```

## Theme

Dark slate palette defined as CSS variables in `styles/main.css` (`--bg-*`, `--text-1..3`, `--border*`, `--accent`). Branch lane colors (`LANE_COLORS`) and file status colors (`FILE_STATUS_COLORS`) live in `src/shared/graph.ts`. Components use Tailwind v4 utilities referencing the variables; repeated patterns (toolbar actions, chips, menus, segmented controls) are shared classes in `main.css`.

## Pull request comments

PR reviews support local line comments, whole-file comments, and replies. Hovering the left diff gutter reveals an accessibly labelled `+` comment action; selecting it, clicking a line number, or dragging in either direction across lines opens the composer directly beneath the normalized range. Review-unit and filter navigation remain disabled until the active composer is added or cancelled, preventing typed text from becoming hidden. File headers provide a persistent **Comment on file** action. Drafts remain local until **Finish your review** submits them. Published line comments, file comments, and replies authored by the active GitHub viewer can be edited inline. File comments use GitHub's standalone review-comment endpoint with `subject_type: file`, while edits use the repository-level pull review comment endpoint.

Review controls use three shared densities: 32px contained actions in headers and dialogs, 28px contained actions in inline forms, and 24px tertiary actions for comment, edit, reply, and draft removal. This keeps action hierarchy, icons, focus states, and disabled states consistent across the review flow.

## Graph rendering model

Each row draws its own SVG cell from declarative `RailSegment`s (`through`, `stopTop`, `startBottom`, `curveIn`, `curveOut`) plus one node (`commit` avatar, `merge` dot, `stash` box, `wip` dashed ring). The shared M2 lane engine emits this shape from topo-ordered Git commits plus synthetic WIP/stash tips. Rail segments may carry `color`/`dashed` style metadata: lanes started by synthetic tips stay dashed in their override color all the way down to their base commit. Ref chips mark the checked-out branch (`current`, rendered filled and sorted first), and the commit-graph query keeps previous rows on screen during load-more refetches (scoped per repository).

## Commands

- `pnpm dev` — run the app (assumed already running during development)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — must pass at every milestone
- `pnpm build` — typecheck + production bundles
