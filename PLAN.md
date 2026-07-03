# git-gud - GitKraken-Inspired Personal Git Client for macOS

## Context

Build a personal-use macOS desktop Git client in `/Users/kaldy/Data/Repos/git-gud`. The visual and interaction target is the supplied GitKraken screenshot, but the goal is not to copy GitKraken branding or non-core product surfaces. The app should feel like a focused local desktop Git client: fast repo tabs, a strong commit graph, reliable Git operations, changed-file trees, diffs, and per-repo profiles.

Original user priorities:

1. **Git operations that actually work**: commit, amend, rebase, interactive rebase, merge, stash, push, pull, fetch, checkout, reset, revert, cherry-pick.
2. **Commit graph tree view** as the centerpiece.
3. **Changed files and diff views** using **`@pierre/trees`** and **`@pierre/diffs`**.
4. **Multi profiles** for Git identities and environment/profile-specific behavior.
5. **Tabs per project/repo**.

No distribution or cross-platform support is needed. This runs locally for one macOS user. The repo is currently uninitialized; `git init` is part of M0.

## Product Scope

### Core First

The product should nail the local Git workflow before anything else:

- Open multiple repositories as tabs and restore them on launch.
- Show a GitKraken-like branch graph with branch/tag/ref chips, stash nodes, and a WIP row.
- Show local branches, remotes, worktrees, and tags with counts and filters in the sidebar. Stashes render as nodes in the graph, not as a sidebar section.
- Let the user inspect commits, changed files, file trees, and diffs quickly.
- Let the user stage, unstage, commit, amend, stash, branch, checkout, merge, rebase, interactive rebase, push, pull, fetch, reset, revert, and cherry-pick from the UI.
- Handle conflicts clearly with continue, skip, and abort actions for rebase/cherry-pick/merge.
- Keep the user's macOS Git setup working: `~/.gitconfig`, SSH agent, osxkeychain, local repo config, and directory-scoped GitHub CLI profiles.

### Explicit Non-Goals for the First Build

These GitKraken surfaces are intentionally out of scope until the core client is excellent:

- Cloud Patches.
- AI commit/recompose/chat features.
- Pull request panels, GitHub/GitLab issue panels, or code-hosting workflows.
- Teams, organizations, collaboration feeds, activity centers.
- Built-in 3-way merge editor.
- Windows/Linux support.
- App Store distribution, auto-update, signing/notarization, or public packaging.

The UI can reserve small sidebar placeholders only if useful for matching the screenshot layout, but they should be inert or hidden by default. Do not spend engineering time on these before the local Git workflow is reliable.

## Acceptance Criteria

- `pnpm dev` opens an Electron app with GitKraken-like dark UI, repo tabs, toolbar, sidebar, graph area, and right detail panel.
- A user can open at least two real repos, switch tabs, close/reopen the app, and recover the same tabs and selections.
- The graph renders real Git history from `git log`, including branches, merges, tags, remotes, stash nodes, WIP row, ref chips, selection, context menus, and load-more behavior.
- Commit detail shows metadata, changed files via `@pierre/trees`, and unified/split diffs via `@pierre/diffs`.
- WIP detail supports file-level stage/unstage, all-stage/all-unstage, commit, and amend.
- Core branch operations work from toolbar/context menus: fetch, pull, push, create branch, checkout, merge, stash push/pop/apply/drop, cherry-pick, revert, reset, and rebase.
- Interactive rebase supports reorder, pick, reword, squash, fixup, drop, conflict detection, continue, skip, abort, and post-operation graph refresh.
- Profiles can be created, assigned per repo tab, persisted, and applied to repo-local Git config before commits.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass at every milestone.

## Progress Tracker

Last updated: 2026-07-03.

| Milestone | Status | Notes |
|---|---|---|
| M0 - Scaffold and Shell | Done | Electron shell, tabs, repo open/validation, recent repos, and persisted workspace state are implemented. |
| M1 - Git Kernel, Reads, Watchers, Profiles | Done | Typed IPC, Git executor, read parsers, watchers, sidebar data, profile assignment, profile env, and repo-local profile config are implemented. |
| M2 - Commit Graph | Done | Real Git graph, lane engine, virtualized rows, WIP/stash nodes, ref chips, context menus, selection, and load-more are implemented. |
| M3 - Details, Trees, Diffs, Commit Flow | Done | Commit/WIP details, `@pierre/trees`, `@pierre/diffs`, file/all stage and unstage, commit, amend, rename unstage coverage, and graph/detail refresh are implemented. |
| M4 - Everyday Branch Operations | Next | Fetch, pull, push, branch actions, checkout, merge, tags, stash operations, conflict banner, progress UI, and safe undo still need implementation. |
| M5 - Rebase and Interactive Rebase | Pending | Standard and interactive rebase flows, controlled editors, conflict handling, and temp-repo integration tests remain. |
| M6 - Polish and Power Features | Pending | Hunk/line staging, shortcuts, Terminal button, settings, and large-repo performance pass remain. |

Current verification snapshot: `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed after the M1-M3 review fixes on 2026-07-03.

Tracking rule: update this table whenever a milestone is started, completed, reopened, or materially rescoped; keep `docs/README.md` status in sync with this table.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron + electron-vite** with main/preload/renderer TypeScript | Mature Vite-based Electron workflow, good local dev speed, no distribution complexity required. |
| UI | **React 19 + TypeScript** | `@pierre/trees` and `@pierre/diffs` support React 18/19. |
| Routing | **TanStack Router** with memory history | Repo, settings, and profile views without depending on browser URLs. |
| Data reads | **TanStack Query** | Cache Git reads by repo/resource/params and invalidate from watcher events. |
| UI state | **Zustand** | Lightweight local state for tabs, selection, panel sizes, filters, and view modes. |
| Styling | **Tailwind v4 + CSS variables** | Fast, consistent GitKraken-like dark shell without a large design-system dependency. |
| File trees | **`@pierre/trees@1.0.0-beta.5` pinned exactly** | React export, virtualized tree, `prepareFileTreeInput`, git status decorations, context menu support. |
| Diffs | **`@pierre/diffs@1.2.12` pinned exactly** | React export, Shiki highlighting, unified/split modes, patch rendering, worker support. |
| Git backend | **System `git` spawned from Electron main process** | Maximum Git command coverage, including interactive rebase, using the user's existing Git auth/config. |
| Graph rendering | **Custom lane engine + virtualized DOM rows + per-row SVG rails** | Real repo history needs custom control; archived/simulated graph libraries are not a good fit. |
| Persistence | **electron-store** | Simple JSON for tabs, recent repos, profiles, settings, undo metadata. |
| Watching | **chokidar over resolved git/common dirs** | Fast invalidation for refs/index/worktree changes, including linked worktrees. |
| Tests | **vitest** | Parser and graph logic can be tested against temp Git repos. |
| Package manager | **pnpm** | Use consistently for scripts and dependency management. |

## Architecture

```text
renderer (React, sandboxed)
  TanStack Query hooks + Zustand UI state
  receives repo-changed / operation-progress events

preload
  contextBridge typed window.api

main
  GitExecutor       spawn('git', args, { cwd, env }), cancellation, streaming,
                    NUL-safe stdout parsing, mutation queue per repo
  RepoInspector     resolves repo root, git dir, common dir, worktree state
  Parsers           log, refs, status, stash, worktree, remote, diff, conflicts
  Commands          commit, branch, merge, rebase, interactive rebase, stash,
                    remote, reset, revert, cherry-pick, undo
  RepoWatcher       chokidar over resolved git/common dirs and debounced worktree
  ProfileService    profiles, repo-local config, command env
  Store             electron-store schema
```

IPC contract lives in `src/shared/ipc.ts` as a typed map. Main and preload derive from that contract. The renderer never touches Node or runs Git directly.

Reads use TanStack Query keys like `[repoPath, resource, params]`. Watcher events invalidate scoped keys:

- ref changes -> log, refs, sidebar counts.
- index/worktree changes -> status, WIP row, changed files.
- stash changes -> stash list and graph rows.
- worktree metadata changes -> worktree section.

Writes are IPC mutations. Mutations run through a per-repo queue, stream progress back to the renderer, snapshot operation state where undo is possible, and invalidate affected queries on settle.

## Directory Layout

```text
src/
  main/
    index.ts
    ipc.ts
    store.ts
    profiles.ts
    git/
      exec.ts
      repoInspector.ts
      watcher.ts
      parsers/
        log.ts
        status.ts
        refs.ts
        stash.ts
        worktree.ts
        diff.ts
        conflicts.ts
      commands/
        commit.ts
        branch.ts
        merge.ts
        rebase.ts
        interactiveRebase.ts
        stash.ts
        remote.ts
        reset.ts
        revert.ts
        cherryPick.ts
        undo.ts
  preload/
    index.ts
  shared/
    ipc.ts
    types.ts
  renderer/src/
    main.tsx
    router.tsx
    theme/
    queries/
    state/
    components/
      tabs/
      toolbar/
      sidebar/
      graph/
      commit/
      tree/
      diff/
      rebase/
      conflicts/
      profiles/
      settings/
```

## Git Execution Rules

Use system Git from the main process. Do not use `nodegit`, `dugite`, or `simple-git` for core operations.

`GitExecutor` requirements:

- Use `spawn`, not buffer-limited `execFile`, for large logs/diffs and network operations.
- Provide helpers for collected stdout commands, streamed commands, and long-running mutation commands.
- Parse NUL-delimited output as bytes/strings carefully. Do not rely on line parsing where paths may contain unusual characters.
- Set `GIT_OPTIONAL_LOCKS=0` for read-only commands.
- Apply per-profile env, including `GH_CONFIG_DIR` when configured.
- Serialize mutating commands per repo.
- Support cancellation for reads and clearly block cancellation for unsafe mutation phases.
- Surface structured errors: exit code, stderr, command kind, in-progress operation state, and parsed conflict status.

`RepoInspector` requirements:

- Resolve repo root with `git rev-parse --show-toplevel`.
- Resolve git dir with `git rev-parse --git-dir`.
- Resolve common dir with `git rev-parse --git-common-dir`.
- Handle linked worktrees where `.git` is a file.
- Detect bare/non-worktree repos and reject them for v1 with a clear message.

## Commit Graph Engine

Input command:

```text
git log --branches --remotes --tags HEAD --topo-order -z --date=iso-strict --format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%D%x00%s
```

Initial page size: 1,500 commits. Add "Load more" via cursor/skip pagination once the first page is stable.

Parsing and message handling:

- With `-z`, record terminators and `%x00` field separators collapse into one flat NUL-token stream. Parse by fixed field count (8 tokens per commit) — none of these fields can contain NUL — or switch field separators to `%x1f`. Do not write a naive record-splitting parser.
- The graph query carries `%s` (subject) only. The commit detail panel fetches the full message separately via `git show -s --format=%B <sha>`.

Stash nodes (rendered in the graph, not the sidebar):

- Fetch stashes with `git stash list -z --format=%H%x00%P%x00%gd%x00%aI%x00%s` (hash, parents, `stash@{n}` selector, date, subject), same fixed-field parsing rule as the log.
- Inject stash commits as synthetic tips into the lane engine input before lane assignment.
- Follow only each stash commit's first parent; ignore the index/untracked parents so a stash renders as a single node attached to its base commit.
- Render with a distinct stash icon/dot and the `stash@{n}` label chip; context menu: apply, pop, drop (with confirmation).

Lane assignment:

- Process topo-ordered commits newest to oldest.
- Keep active lanes where each lane expects a future hash.
- If one or more lanes expect the current commit, collapse them into the leftmost matching lane.
- If no lane expects the current commit, allocate the leftmost free lane as a new branch tip.
- After placing the commit, the lane expects the first parent.
- Additional parents for merges reuse an existing expected lane or create a new outgoing lane.
- Output pure data: commit, lane, dot color, rails, joins, exits, and ref decorations.

Rendering:

- Use TanStack Virtual for rows.
- Each row is a grid: branch/tag column, graph SVG cell, message, author/avatar, date.
- Render rails as per-row SVG segments to preserve DOM interactions.
- Show sticky date markers like the screenshot.
- Add synthetic WIP row above HEAD when status is dirty.
- Context menus: checkout, create branch here, merge into current, rebase current onto, interactive rebase from here, reset soft/mixed/hard, revert, cherry-pick, tag, copy SHA.

Test graph behavior with fixture DAGs: linear, branch, merge, octopus, criss-cross, remote-only refs, tags, stash nodes (including multiple stashes on one base commit), and a dirty WIP row.

## Trees and Diffs

### Changed Files Tree

Use `@pierre/trees`:

- Import React `FileTree` from `@pierre/trees/react`.
- Build a tree model with `prepareFileTreeInput(paths, { flattenEmptyDirectories })`.
- Feed Git status decorations through the library's git status support.
- Support Path/Tree toggle, selection, search/filter, add/modify/delete/rename badges, and context menu actions.
- Context actions for WIP: stage, unstage, discard with confirmation, open in editor, reveal in Finder.
- Context actions for commits: copy path, open file at revision when practical.

### Diff View

Use `@pierre/diffs` correctly:

- For raw Git patch text, use React `PatchDiff` or parse with `parsePatchFiles`.
- For full old/new file contents, use React `MultiFileDiff` or generate `FileDiffMetadata` with the library helpers before rendering `FileDiff`.
- Use `FileDiff` only with `FileDiffMetadata`.
- Use unified/split toggle, Shiki dark theme, line numbers, sticky headers, and worker pool support.
- Fetch old/new blob contents with `git cat-file blob <sha>` where full-content diffs are needed.
- For WIP files, compare index/worktree or HEAD/worktree depending on selected view.
- Untracked files never appear in `git diff` output; drive them from status and diff worktree contents against an empty old file.
- Show binary/image fallback instead of trying to render text diffs.

Hunk/line staging is deferred until after file-level staging is stable. When implemented, build patches and apply via `git apply --cached` / reverse patch paths with targeted tests.

## Git Operations Layer

Every operation should use explicit command objects, not ad hoc UI strings. Each command declares:

- Required clean/dirty worktree preconditions.
- Whether it mutates refs, index, worktree, or remote.
- Whether it can be undone, and how.
- Which queries to invalidate.
- Which conflict/rebase/cherry-pick state to inspect afterward.

Core operations:

- Stage/unstage file, stage/unstage all.
- Commit and amend.
- Fetch with prune option.
- Pull with setting for ff-only vs rebase.
- Push and force-with-lease.
- Create, rename, delete, and checkout branches.
- Checkout remote branch as local tracking branch.
- Merge.
- Rebase.
- Interactive rebase.
- Stash push, pop, apply, drop.
- Tag create/delete.
- Cherry-pick.
- Revert.
- Reset soft/mixed/hard with strong confirmation for worktree-changing cases.

Undo:

- Do not implement undo as a blanket `git reset --hard`.
- Store operation-specific undo metadata.
- Support safe undo first: commit/amend, branch create/delete when recoverable, checkout, merge before push, reset when reflog snapshot is available.
- For dangerous undo paths, require explicit confirmation and show affected files/refs.
- Undo metadata can go stale if the repo changes outside the app. Before undoing, validate that the recorded refs still match the repo's current state; if they do not, disable the undo entry with a clear "repo moved externally" reason instead of acting.
- Remote operations should not pretend to be undoable unless there is a precise safe action.

Conflicts:

- Detect merge/rebase/cherry-pick state from git metadata and `status --porcelain=v2 -z`.
- Show a persistent conflict banner with conflicted files.
- Buttons: Continue, Skip where valid, Abort.
- Diff view may show conflict markers for v1.
- 3-way merge UI is explicitly out of scope.

## Interactive Rebase

User flow:

1. Context menu: "Interactive rebase current branch from here".
2. Modal lists commits to replay, oldest-to-newest, with drag reorder.
3. Each row supports pick, reword, squash, fixup, drop.
4. Validate invalid todo combinations before running.
5. Run `git rebase -i <base>` with controlled editor scripts.
6. Detect conflicts and route to ConflictBanner.
7. On success, refresh graph and selected commit.

Implementation requirements:

- Generate todo files in an app temp directory.
- Use an absolute Node/Electron helper path for `GIT_SEQUENCE_EDITOR`; do not depend on a relative `node sequence-editor.js`.
- Set `GIT_EDITOR=true` unless a specific command requires a message editor.
- For reword, prefer generated todo `reword` plus controlled editor behavior, or use tested `exec git commit --amend -m ...` lines only if integration tests prove it works with reorder/squash.
- Support in-progress detection for both `.git/rebase-merge` and `.git/rebase-apply`.
- Integration-test reorder, squash, fixup, reword, drop, conflict, continue, and abort in temp repos.

## Profiles

Profiles are core, not polish, because commits must use the right identity.

Profile shape:

```ts
type GitProfile = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  sshKeyPath?: string;
  ghConfigDir?: string;
  signingKey?: string;
  remoteUrlPatterns?: string[];
};
```

Behavior:

- Store profiles in electron-store.
- Assign a profile per repo tab.
- Auto-suggest profile by repo path and remote URL pattern, for example `~/Data/Vosime` -> Vosime.
- On assignment, write repo-local Git config: `user.name`, `user.email`, optional `core.sshCommand`, optional `user.signingkey`.
- Pass `GH_CONFIG_DIR` in command env when configured.
- Show active profile in the top-right profile menu.
- Before commit/amend, show the effective author identity in the commit panel.

## Tabs Per Project

The top tab strip should match the screenshot's primary workflow:

- One tab per repo.
- Repo name and dirty indicator.
- Close button.
- `+` opens folder picker and recent repo dropdown.
- Persist open tabs, active tab, selected commit, selected file, view mode, sidebar state, panel sizes, and assigned profile.
- Query keys include repo path so switching tabs reuses cached data.
- Watchers are started/stopped per open tab.

## Milestones

### M0 - Scaffold and Shell

- `git init`.
- Scaffold Electron + electron-vite React TS app.
- Add pnpm scripts: `dev`, `typecheck`, `lint`, `test`.
- Add Tailwind v4, TanStack Router, TanStack Query, Zustand, electron-store.
- Build GitKraken-like shell: top tabs, repo/branch selectors, toolbar, sidebar, graph area, right panel.
- Implement open-repo folder picker, recent repos, tab persistence.

Exit: app opens with empty panels, tabs persist, no Git commands yet beyond repo validation.

### M1 - Git Kernel, Reads, Watchers, Profiles

- Implement `GitExecutor`, `RepoInspector`, typed IPC, parser test harness.
- Implement parsers for status, refs, log, stashes, worktrees, remotes.
- Implement RepoWatcher using resolved git/common dirs and worktree debounce.
- Implement ProfileService, profile persistence, per-repo assignment, repo-local config write.
- Wire TanStack Query hooks and sidebar counts/filter.

Exit: opening a real repo shows live sidebar data, branch selector, status/WIP count, active profile, and refreshes on Git changes.

### M2 - Commit Graph

- Implement lane engine with unit tests.
- Render virtualized graph rows, rails, commit dots, ref chips, avatars, date separators.
- Inject stash nodes as synthetic graph tips with distinct icon and `stash@{n}` chip (context menu entries may stay inert until M4).
- Add WIP row.
- Add selection and commit/ref context menus as disabled or read-only entries where commands are not ready.
- Add load-more.

Exit: graph visually matches real history well enough to compare against `git log --graph --oneline --decorate`.

### M3 - Details, Trees, Diffs, Commit Flow

- Commit detail panel with metadata, parents, author/committer, message, stats.
- Changed-files panel with `@pierre/trees`.
- Diff panel with `@pierre/diffs` unified/split modes.
- WIP panel with file-level stage/unstage, stage all, unstage all.
- Commit and amend forms with effective profile identity visible.

Exit: inspect commits and WIP changes, stage files, commit, amend, and see graph/detail refresh.

### M4 - Everyday Branch Operations

- Toolbar/context-menu actions for fetch, pull, push, branch create/delete/rename, checkout, merge, tag create/delete.
- Stash operations: stash push from the toolbar; apply/pop/drop from stash node context menus in the graph.
- Progress toasts/log panel for network operations.
- ConflictBanner for merge/cherry-pick/rebase states.
- Implement safe subset of undo for local operations with explicit confirmations.

Exit: daily Git workflows can be completed without terminal fallback for normal cases.

### M5 - Rebase and Interactive Rebase

- Standard rebase from context menu.
- Interactive rebase modal with reorder and actions.
- Controlled sequence editor and message handling.
- Conflict flow integration: continue, skip, abort.
- Integration tests for successful and conflicting rebase flows.

Exit: reorder/squash/reword/drop workflows work on real temp repos and update the graph correctly.

### M6 - Polish and Power Features

- Hunk/line staging.
- Keyboard shortcuts: repo/branch fuzzy jump, commit submit, fetch, push, toggle tree/path, toggle unified/split.
- Terminal button opens Terminal.app at repo.
- Settings page.
- Performance pass on large repos.
- Optional `pnpm dist` local `.app` build.

Exit: the app is comfortable as the user's daily local Git client.

## Risks and Mitigations

- **Graph correctness is hard.** Keep lane engine pure and heavily tested with known DAG fixtures and real repos.
- **Git output parsing can break on paths/messages.** Prefer NUL-delimited formats and parser tests using real temp repos with spaces, unicode, renames, deletes, and odd filenames.
- **Watchers can miss linked worktree updates.** Always resolve git dir/common dir via Git and test linked worktrees.
- **Undo can destroy work.** Implement operation-specific undo, show affected refs/files, and avoid pretending remote operations are safely undoable.
- **Interactive rebase can get stuck.** Treat rebase state as first-class UI state, test all continue/skip/abort paths, and keep terminal fallback possible.
- **Diff rendering can be expensive.** Use virtualization/worker support and cap eager diff rendering; load selected file diff first.
- **Profiles can silently commit with wrong identity.** Show effective author in the commit form and apply repo-local config on assignment.

## Verification

At every milestone:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm dev`

Automated tests:

- Lane engine fixtures: linear, branch, merge, octopus, criss-cross, tags, remotes.
- Parser tests against temp repos: status, rename, delete, conflict, stash, worktree, refs, ahead/behind.
- Command tests against temp repos for commit, amend, branch, stash, merge conflict, cherry-pick conflict, reset, standard rebase, interactive rebase.
- Profile test: assign profile, commit, verify `git log --format='%an %ae'`.

Manual/e2e checks:

- Open this repo and a large real repo.
- Compare graph with `git log --graph --oneline --decorate`.
- Run branch -> commit -> amend -> stash -> merge -> conflict -> abort/continue flow.
- Run interactive rebase reorder+squash+reword+drop and verify final `git log`.
- Switch profiles and verify commit identity.
- Close/reopen app and verify tabs, selections, panels, and profile assignment restore.

Electron e2e with Playwright `_electron` is optional unless manual smoke testing becomes repetitive or flaky.
