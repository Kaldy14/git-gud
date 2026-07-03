# git-gud

A personal macOS Git client (Electron + React), visually modeled on GitKraken. Product plan and milestones live in [PLAN.md](../PLAN.md).

## Status

- **M0 (scaffold + shell): done.** Tabs, repo open/validate, workspace persistence, and the full GitKraken-style UI shell.
- **M1 (Git kernel, reads, watchers, profiles): done for the read path.** The shell now uses typed IPC for live status, refs, remotes, worktrees, stashes, repository watchers, and effective profile identity.
- **M2 (commit graph): next.** The graph and commit detail panel still render a hand-authored preview dataset until real graph rows and commit details land.

## Renderer UI structure

```text
src/renderer/src/
  styles/main.css                     theme tokens (CSS variables) + shared component classes
  workspace/WorkspaceShell.tsx        composition root: tab strip, toolbar, sidebar, graph, detail, status bar
  state/workspace.ts                  Zustand store bridging window.api workspace IPC
  components/
    tabs/TabStrip.tsx                 title-bar repo tabs, + menu (open/recent), profile & settings buttons
    toolbar/Toolbar.tsx               repository/branch selectors + stacked action buttons (inert until M4)
    sidebar/Sidebar.tsx               Local/Remote/Worktrees/Tags sections, filter input, collapse rail
    graph/sampleGraph.ts              preview graph dataset + lane colors + rail segment types
    graph/GraphView.tsx               commit graph: ref chips, per-row SVG rails, nodes, date markers
    commit/CommitDetailPanel.tsx      commit metadata, author card, Path/Tree file list, WIP composer
    start/StartPage.tsx               empty-state start page with recent repositories
    statusbar/StatusBar.tsx           repo path + preview notice + version
```

## Theme

Dark slate palette defined as CSS variables in `styles/main.css` (`--bg-*`, `--text-1..3`, `--border*`, `--accent`). Branch lane colors live in `components/graph/sampleGraph.ts` (`LANE_COLORS`). Components use Tailwind v4 utilities referencing the variables; repeated patterns (toolbar actions, chips, menus, segmented controls) are shared classes in `main.css`.

## Graph rendering model

Each row draws its own SVG cell from declarative `RailSegment`s (`through`, `stopTop`, `startBottom`, `curveIn`, `curveOut`) plus one node (`commit` avatar, `merge` dot, `stash` box, `wip` dashed ring). The M2 lane engine should emit this same shape so `GraphView` swaps from sample data to real history without rework.

## Commands

- `pnpm dev` — run the app (assumed already running during development)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — must pass at every milestone
- `pnpm build` — typecheck + production bundles
