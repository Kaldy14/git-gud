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
    review/agentNotes.ts               Agent Note matching, relocation, and per-repository hidden state
    settings/SettingsPanel.tsx        app defaults plus Codex Agent Notes skill management
    operations/ConflictBanner.tsx     merge/rebase/cherry-pick/revert conflict action banner
    operations/CommandDialog.tsx      app-native command confirmations and simple operation forms
    inspection/RepositoryInspectorDialog.tsx file history, blame, and ref comparison dialog
    maintenance/RepositoryMaintenanceDialog.tsx branch cleanup scan, review, deletion outcomes, and recovery refs
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

## Codex Agent Notes

Git Gud can install its bundled `git-gud-agent-notes` skill into the user's Codex skills directory. Codex then decides whether a finished implementation needs any short, reviewer-facing notes. The deterministic writer stores notes under the active worktree's Git metadata, and `ReviewView` renders matching notes inline with hide and reopen controls.

See [agent-notes.md](agent-notes.md) for the authoring rules, installation behavior, storage format, and current limits.

## Other machines (view-only)

**Settings → Machines** lists the devices on your Tailscale tailnet (from a read-only `tailscale status --json`; phones and TVs are hidden, online devices and those with Tailscale SSH come first). **Add** tests the connection over SSH and saves the device with its full MagicDNS name; a failed test shows the SSH error and an **Add anyway** button. When Tailscale isn't installed, stopped, or signed out, the section says so and shows the manual form, which takes any SSH host or `~/.ssh/config` alias (also reachable from Tailscale via **Use an SSH host instead…**). SSH runs with `StrictHostKeyChecking=accept-new`, so the first connection trusts the host key without a prompt and a changed key still fails. For each open repository, Git Gud looks for the same checkout path relative to the remote home folder, using the main checkout when a linked worktree tab is open. Each machine can be hidden from the graph with the eye toggle in its sidebar section.

- **Reads only.** Every 15 seconds one SSH round trip (`ssh -o BatchMode=yes`, a per-user multiplexed control socket under `~/.ssh/gg-*` on macOS/Linux; no multiplexing on Windows) runs `git status --porcelain=v2` and `git for-each-ref refs/heads` with `GIT_OPTIONAL_LOCKS=0`, so the remote index is never refreshed or rewritten. Diffs are fetched on demand the same way. Nothing on the other machine is ever changed.
- **Content filters.** Checkouts with tracked Git content filters, including Git LFS, report an inspection error and retain the last snapshot. Git Gud cannot accurately compare their stored and working-tree content without running conversion helpers, so it leaves them unavailable. External diff drivers, text conversion, and FSMonitor are disabled for remote reads too.
- **Submodules.** Remote inspection shows changes to submodule commits, but does not scan submodule working files, where separate Git helpers could run.
- **Local mirror refs.** When the remote branch tips change, Git Gud fetches them into the local repository under `refs/machines/<machine-id>/heads/*` (no tags, no FETCH_HEAD, no gc). The graph log includes those refs, so machine-only commits appear in history. Configured `uploadpack.packObjectsHook` helpers block branch mirroring with a sync error. Removing a machine deletes its `refs/machines/<id>/` refs from open repositories. Closed repositories retain hidden mirror refs after removal; they are excluded from the graph.
- **Graph.** Machine branches render as chips with a monitor icon, folded into the matching local or remote chip when they point at the same commit. Commits reachable only from a machine branch get an **unpushed** badge. A dirty remote working directory adds an orange `// WIP` row above its base commit; selecting it opens a read-only panel (conflicted, staged, unstaged, and untracked groups) and clicking a file shows its diff. Stage, commit, review, and context-menu actions are not offered for machine rows.
- **Offline.** If SSH fails, the last snapshot stays visible, dimmed with a dashed chip and "as of HH:MM", and the panel shows the SSH error.

Implementation: `src/main/machines.ts` (store, SSH, ref sync), `src/main/tailscale.ts` (device discovery), `src/main/git/parsers/machine.ts` (remote commands and parsing), `mergeCommitGraphMachines` in `src/shared/graph.ts`, and `src/renderer/src/components/machines/`.

## Graph rendering model

Each row draws its own SVG cell from declarative `RailSegment`s (`through`, `stopTop`, `startBottom`, `curveIn`, `curveOut`) plus one node (`commit` avatar, `merge` dot, `stash` box, `wip` dashed ring). The shared M2 lane engine emits this shape from topo-ordered Git commits plus synthetic WIP/stash tips. Rail segments may carry `color`/`dashed` style metadata: lanes started by synthetic tips stay dashed in their override color all the way down to their base commit. Ref chips mark the checked-out branch (`current`, rendered filled and sorted first), and the commit-graph query keeps previous rows on screen during load-more refetches (scoped per repository).

## Commands

- `pnpm dev` — run the app (assumed already running during development)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — must pass at every milestone
- `pnpm build` — typecheck + production bundles
- `pnpm test:maintenance` — actual Electron branch maintenance validation with agent-browser, isolated Git fixtures, and screenshots under `artifacts/maintenance`

See [repository maintenance research](repository-maintenance-research.md) for native Git and cleanup-tool comparisons, evidence limits, and the implemented safety rules.
