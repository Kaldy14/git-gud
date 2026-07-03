# git-gud

A personal macOS Git client (Electron + React), visually modeled on GitKraken. Product plan and milestones live in [PLAN.md](../PLAN.md).

## Status

- **M0 (scaffold + shell): done.** Tabs, repo open/validate, workspace persistence, and the full GitKraken-style UI shell.
- **M1 (Git kernel, reads, watchers, profiles): done.** The shell now uses typed IPC for live status, refs, remotes, worktrees, stashes, repository watchers, effective identity, and per-repo profile assignment.
- **M2 (commit graph): done.** The graph renders real Git history through a typed IPC query, shared lane engine, virtualized rows, WIP/stash nodes, refs, context menu placeholders, and load-more.
- **M3 (details, trees, diffs, commit flow): next.** Commit file trees/diffs and WIP staging/commit actions are still deferred.

## Renderer UI structure

```text
src/renderer/src/
  styles/main.css                     theme tokens (CSS variables) + shared component classes
  workspace/WorkspaceShell.tsx        composition root: tab strip, toolbar, sidebar, graph, detail, status bar
  state/workspace.ts                  Zustand store bridging window.api workspace IPC
  components/
    tabs/TabStrip.tsx                 title-bar repo tabs, + menu (open/recent), profile & settings buttons
    profile/ProfileMenu.tsx           profile create/assign popover backed by typed IPC
    toolbar/Toolbar.tsx               repository/branch selectors + stacked action buttons (inert until M4)
    sidebar/Sidebar.tsx               Local/Remote/Worktrees/Tags sections, filter input, collapse rail
    graph/GraphView.tsx               virtualized commit graph: ref chips, per-row SVG rails, nodes, date markers
    commit/CommitDetailPanel.tsx      commit metadata, author card, Path/Tree file list, WIP composer
    start/StartPage.tsx               empty-state start page with recent repositories
    statusbar/StatusBar.tsx           repo path + preview notice + version
```

## Theme

Dark slate palette defined as CSS variables in `styles/main.css` (`--bg-*`, `--text-1..3`, `--border*`, `--accent`). Branch lane colors live in `src/shared/graph.ts` (`LANE_COLORS`). Components use Tailwind v4 utilities referencing the variables; repeated patterns (toolbar actions, chips, menus, segmented controls) are shared classes in `main.css`.

## Graph rendering model

Each row draws its own SVG cell from declarative `RailSegment`s (`through`, `stopTop`, `startBottom`, `curveIn`, `curveOut`) plus one node (`commit` avatar, `merge` dot, `stash` box, `wip` dashed ring). The shared M2 lane engine emits this shape from topo-ordered Git commits plus synthetic WIP/stash tips.

## Commands

- `pnpm dev` — run the app (assumed already running during development)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — must pass at every milestone
- `pnpm build` — typecheck + production bundles
