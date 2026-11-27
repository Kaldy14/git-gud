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
    github/workspace/                 pull request workspace: rail + detail + shortcut bar, leave guard, keys
    github/rail/                      the pull request queue beside an open pull request
    github/PullRequestReviewView.tsx  one pull request: header, tabs, drafts, submission, the shared ReviewView
    github/overview/                  Overview tab: merge verdict, checks, risk, issues, behavior changes
    github/conversation/              Conversation tab: description, composer, timeline
    github/tour/                      Tour tab: step panel, progress strip, walk state
    github/shortcuts/                 shortcut rules, the shortcut list, the bar and dialog
    graph/GraphView.tsx               virtualized commit graph: ref chips, per-row SVG rails, nodes, date markers,
                                      arrow-key row navigation, viewport-clamped context menus, WIP status counts
    commit/CommitDetailPanel.tsx      commit metadata, author card, Path/Tree file list, WIP composer/actions
    diff/FileFocusView.tsx            selected-file patch view with unified/split diff modes and WIP hunk staging
    review/ReviewView.tsx              focused local/GitHub review with expandable context above and below each hunk
    review/ReviewFilesView.tsx         the files layout used by pull requests (files panel, stacked files, strip)
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

Dark slate palette defined as CSS variables in `styles/main.css` (`--bg-*`, `--text-1..3`, `--border*`, `--accent`). `:root` also defines a type scale (`--text-2xs` 10px for counts and eyebrows only, `--text-xs` 11 meta, `--text-sm` 12 UI and comment bodies, `--text-md` 13 prose and titles, `--text-xl` 18 large titles, `--text-2xl` 21 display headings; weights 500/600; `--leading-*`), spacing (`--space-1..6`, 4–24px), radii (`--radius-xs`, `--radius-row`, `--radius-container`, `--radius-lg`, `--radius-pill`), and focus/selection tokens (`--focus-ring`, `--select-row`, `--select-row-focused`). Status tones: success, danger, `pending` = in progress (blue `--info-*`), `warning` = blocked or needs attention (amber), `muted` = no signal (drafts, closed, unknown or absent checks). Code chips in comments are neutral so they are not confused with teal links. Branch lane colors (`LANE_COLORS`) and file status colors (`FILE_STATUS_COLORS`) live in `src/shared/graph.ts`. Components use Tailwind v4 utilities referencing the variables; repeated patterns (toolbar actions, chips, menus, segmented controls) are shared classes in `main.css`. Field edges use `--border-control` and focus uses `--focus-ring`; content text never goes below 11px. `pnpm lint` runs Stylelint so every CSS `font-size` and `border-radius` uses these tokens; avatar initials are the only marked exception. Long-running states (CI runs, tour writing) show a static `CircleDotDashed` icon rather than a spinner. The preload `invoke` strips Electron's IPC error prefix, so renderer code can show `error.message` directly. Diff syntax themes are readable copies of Shiki's Dark+ and Tokyo Night (`components/diff/diffTheme.ts`) with every token at 4.5:1 on diff surfaces, word emphasis is skipped for unrelated line pairs (`dissimilarLineDiff.ts`), and the Code font setting overrides `--font-mono`. List selection is teal only in the focused list and neutral elsewhere (`--select-row`, `--select-row-focused`). Profiles are switched from the title-bar menu and edited in Settings › Profiles. The PR inbox nav holds the inbox scopes and repositories; status groups narrow from their headings (Show only).

## Pull request workspace

Opening a pull request shows a review workspace: the queue on the left, the pull request in the middle, and a row of keyboard hints at the bottom. Its layout and keyboard model follow Greptile's pull request view.

```text
┌ title bar ────────────────────────────────────────────────────────────────┐
│ Pull requests (rail)   │ header: repository, #number, title, actions      │
│  search                │ tabs: Overview · Conversation · Tour · Code      │
│  ▾ Needs your review   │ ───────────────────────────────────────────────  │
│  ▾ Ready to merge      │ active tab                                       │
├────────────────────────┴──────────────────────────────────────────────────┤
│ Keyboard shortcuts  J K switch PR · H L switch tabs · …        View all × │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Rail.** The whole inbox in compact form, with the inbox's groups (foldable, remembered), a search field, the Live/refresh control, and a "Viewing" group for a pull request opened by link that is not in the inbox. A row shows the status icon in a tile tinted with its tone, title, author, age and checks ratio. Every status has its own icon (merge conflict, draft, changes requested, failing checks, awaiting review, waiting for approval, blocked, merged, closed), the same one in the inbox and the header. It is shown by default beside Overview and Conversation from 1240px and beside Tour and Code from 1840px, remembered separately; below 1240px it floats over the content. Mod+B or the button before the back arrow toggles it. The inbox page itself is unchanged and stays the landing page. When it floats over a narrow window, Escape closes it from anywhere.
- **Layout.** The header is one row on every tab, so the tabs never move; the author, commits and branch line opens Overview and Conversation. Overview leads with the merge verdict in a band tinted green, blue, amber or red, with each blocker and its action directly beneath; when nothing is unresolved, Behavior changes comes before Issues. Merge is the solid teal button only while the verdict is Ready to merge; Review is always a neutral button.
- **Loading.** A pull request keeps its layout while it loads: the header and tabs are already in place, grey placeholders stand where the content of the tab will be, and the content fades in once it arrives (a pull request that is already loaded appears at once). The header says "Loading pull request", then "Adding context" while full files are fetched for expandable context. The inbox shows placeholder rows on its first load. The tour and bug scan icons show a dot only when there is a result, a run in progress or a failure.
- **Motion.** Small one-shot movements show where you moved and what just happened: the tab underline and the list selection slide, a tour step arrives from the side you came from, a reviewed step fills its segment, the lines a jump lands on start brighter and settle, and a key in the shortcut bar lights when its shortcut did something (a key that could not act stays dark). Background refreshes are silent. "Reduce motion" in the system settings turns all of it off.
- **Switching.** J/K move through the rail. The row selects at once, the pull request loads after 150ms so holding a key does not fire a request per row, the neighbours are prefetched, and the open tab is kept.
- **You act on what you read.** If commits are pushed while you have unsaved text or pending review comments, the pull request stays on the commit you are reviewing and says so; the new commits load once you add, submit or discard. Merging and reviewing are bound to the commit on screen. A pull request that changes while it loads (a push, or a move to another base branch) is read again rather than shown half old, half new.
- **Nothing typed is lost.** If a comment, reply, edit or review summary holds unsaved text, every way out of the pull request (rail, J/K, back, close, title-bar tabs, links, profile switch) first asks "Discard your unsaved comment?".
- **Shortcut bar.** Shows the keys for the open tab. "View all" or `?` lists every shortcut and holds two switches: "Single-key shortcuts" (turns off letter and symbol keys) and "Show shortcut bar". The header's more menu has "Keyboard shortcuts" too.

| Keys | Action |
| --- | --- |
| J / K | next / previous pull request |
| H / L | previous / next tab |
| / | search pull requests |
| Mod+B | show or hide the rail |
| ← / → | previous / next tour step |
| R | mark the tour step reviewed and go on |
| [ / ] | previous / next file |
| V | mark the current file viewed |
| ↑ / ↓, Shift, C | line cursor, extend, comment |
| ? | all shortcuts |

### Overview

A decision page, read top to bottom:

1. **Merge status** with its verdict (Ready to merge, Awaiting approval, Checks failing, Merge conflicts, Draft, Merged…). One line of facts (`12/12 checks passed · 2 approvals · no unresolved threads`), then the checks grouped by outcome (Failed, Running, Passed, Skipped; each opens to its runs with duration and a link), the **Before this can merge** checklist with the action that clears each blocker (conflicting files and Resolve on GitHub, View checks, Ready for review via `gh pr ready`, update a branch behind its base), and the reviewers. Merging is bound to the commit on screen: if someone pushed since, GitHub rejects it and the pull request refreshes.
2. **Risk level** (Low, Medium, High) with a plain summary of what the pull request changes and up to four bullets. This is written by the tour's AI run and says so, with the commit it was written for and a Rewrite button. Without a tour the section is **From the author**: the start of the description, a link to the rest, and "Write tour".
3. **Issues**: review threads from people and bots, split into Unresolved and Resolved. A thread opens Code at its line; an outdated one opens Conversation at the comment. Bug scan findings are listed apart as "Local scan · not posted".
4. **Behavior changes**: the tour's behaviour steps with their risk; a row opens the Tour at that step.

Checks count only unfinished runs as pending; skipped and neutral runs are reported as skipped and left out of the passed/ran ratio. Merge conflicts put an authored pull request in the inbox's **Needs action** group and outrank the Draft label.

### Conversation

The description first (folded when long), then the comment box and the timeline of comments, reviews and collapsed commit runs (newest first by default, optional bot hiding). GitHub alert blockquotes (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) render as titled callouts (`remarkGithubAlerts`).

### Tour

A guided walk through the change on the real diff, made to be scanned rather than read. An AI run (Pi on its flagship model with high thinking; the Claude Code CLI on the `opus` alias when Pi is not installed or signed in) writes ordered steps with word budgets. Each step has a title that states a behaviour, a **Before / Now** pair, a one-sentence reason it matters, a risk, an optional call to make (tradeoff, contract, product, risk, accessibility), numbered **points** (a short headline plus one sentence, anchored to line ranges), the files it owns and, when the step crosses three or more parts of the system, a small **flow**. `src/shared/pullRequestTour.ts` validates the result: a point is trimmed to one real hunk, a point that cannot be placed is kept as text, every changed file belongs to exactly one step, and a flow survives only where its boxes name a point or a changed file.

```text
[Map] Step 2 of 5  ▰▰▰▱▱▱▱▱▱▱◆▱▱▱▱▱▱▱▱      (width = changed lines, ‾ amber/red = risk, ◆ = call)  ‹ ›
┌ step ────────────────────────┐ ┌ this step's files ─────────────────────────┐
│ [Med risk] What it does      │ │ src/a.ts  +40 −5                 ☐ Viewed  │
│ BEFORE  old behaviour        │ │  …diff…                                    │
│ NOW     new behaviour        │ │  ① the point's sentence, under its lines   │
│ ▌RISK TO JUDGE one sentence  │ │ src/b.ts  +6 −3                            │
│   [Poll] → [Mirror] → [Refs] │ └────────────────────────────────────────────┘
│ a.ts  ▬▬▬①▬▬▬▬②   ☐          │
│ b.ts  ▬▬          ☐          │
│ ① Headline          36–47    │
│ ② Headline             12    │
│ [ Reviewed & next ]          │
└──────────────────────────────┘
```

The panel holds only headlines; each point's sentence sits beside its lines in the diff. The footprint draws each file as a +/− bar with the step's points placed where their lines fall, and a viewed tick. Flow boxes are outlined by what the change did (copper changed, green new, red removed, dashed unchanged) and select their point or open their file. Selecting a point scrolls the diff to its lines and tints them; the number on the line selects the point; scrolling the diff moves the selection. **Map** lists every step with its change volume, risk, call and reviewed state. ←/→ change step, R marks the step reviewed and moves on, and the last step offers **Finish review**. Comments, the line cursor and Viewed work as in Code, because Tour and Code are the same diff view with a different left panel. A step's Reviewed state is separate from a file's Viewed state. The tour is kept in the `git-gud-pull-request-guides` store, survives restarts, and when the branch moves it says "written before the latest push", drops its line marks and offers Rewrite. A tour stored in an older format asks to be written again. In Code the same points appear inline, labelled `step.point`, each linking back to its step.

### Code

Every changed file stacked in one scroller in tree order, with a files panel on the left (filter, tree with line counts and a viewed tick, coverage, the Show menu for scope and filters, unified/split) and a strip above showing `File 3 of 48 · 12 viewed`. Each file has a sticky header with a **Viewed** checkbox; ticking it collapses the file and moves on. Files hidden by review filters stay in the tree dimmed (open one to reveal it) and never count as viewed. Hunks render only near the viewport, so large pull requests open quickly. Local branch reviews keep the Blocks layout.

### Line breakdown

Changed lines are grouped by kind: **Code**, **Tests**, **Docs**, **Config**, and **Generated** (generated paths and lockfiles). `src/shared/lineBreakdown.ts` classifies by path alone, reusing the Code tab's test and generated rules, so it works in the inbox without patches. Hovering or focusing the `+/−` totals, in inbox rows and in the detail header, opens a table of files and lines per kind with a total. The inbox query asks GitHub for the first 100 files of each pull request (`fileLineStats`); lines beyond those show as **Unlisted**. The loaded detail uses its full file list.

## Pull request comments

PR reviews support local line comments, whole-file comments, and replies, in both Code and Tour. Hovering a line number shows a `+`; clicking a line number or dragging in either direction across lines opens the composer directly beneath the normalized range. File, tour-step and filter navigation remain disabled until the active composer is added or cancelled, preventing typed text from becoming hidden. File headers provide a persistent **Comment on file** action. Drafts remain local until **Finish your review** submits them. Published line comments, file comments, and replies authored by the active GitHub viewer can be edited inline. File comments use GitHub's standalone review-comment endpoint with `subject_type: file`, while edits use the repository-level pull review comment endpoint. From the keyboard, ↑/↓ move a line cursor through the diff (Shift extends it inside one hunk) and C opens the comment composer for those lines.

Review controls use three shared densities: 32px contained actions in headers and dialogs, 28px contained actions in inline forms, and 24px tertiary actions for comment, edit, reply, and draft removal. This keeps action hierarchy, icons, focus states, and disabled states consistent across the review flow.

## Codex Agent Notes

Git Gud can install its bundled `git-gud-agent-notes` skill into the user's Codex skills directory. Codex then decides whether a finished implementation needs any short, reviewer-facing notes. The deterministic writer stores notes under the active worktree's Git metadata, and `ReviewView` renders matching notes inline with hide and reopen controls.

See [agent-notes.md](agent-notes.md) for the authoring rules, installation behavior, storage format, and current limits.

## Other machines (view-only)

**Settings → Machines** lists the devices on your Tailscale tailnet (from a read-only `tailscale status --json`; phones and TVs are hidden, online devices and those with Tailscale SSH come first). **Add** tests the connection over SSH and saves the device with its full MagicDNS name; a failed test shows the SSH error and an **Add anyway** button. When Tailscale isn't installed, stopped, or signed out, the section says so and shows the manual form, which takes any SSH host or `~/.ssh/config` alias (also reachable from Tailscale via **Use an SSH host instead…**). SSH runs with `StrictHostKeyChecking=accept-new`, so the first connection trusts the host key without a prompt and a changed key still fails. For each open repository, Git Gud looks for the same checkout path relative to the remote home folder, using the main checkout when a linked worktree tab is open. Each machine can be hidden from the graph with the eye toggle in its sidebar section.

- **Reads only.** Remote Git must support `--no-lazy-fetch` (Git 2.45 or newer); connection tests, snapshots, diffs, and branch mirroring reject unsupported installations with an upgrade message. Every 15 seconds one SSH round trip (`ssh -o BatchMode=yes`, a per-user multiplexed control socket under `~/.ssh/gg-*` on macOS/Linux; no multiplexing on Windows) runs `git status --porcelain=v2` and `git for-each-ref refs/heads` with `GIT_OPTIONAL_LOCKS=0` and `GIT_NO_LAZY_FETCH=1`, so the remote index is never refreshed or rewritten and missing objects are never downloaded. Diffs are read on demand the same way; a partial clone missing the required blob reports an error until its owner fetches that object. Nothing on the other machine is ever changed.
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
