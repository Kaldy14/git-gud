# Project Guidance

## Review diffs

- Focused local and GitHub pull-request review plans should include bounded, prioritized full-file text context when available so unchanged lines above and below a hunk remain expandable.
- Preserve the patch-only fallback for binary, oversized, unavailable, or non-UTF-8 file contents.

## Pull request detail and Guide

- Keep the Summary, Guide, Activity, and Code tabs; Code must keep `ReviewView`'s section split. Keep inactive panes mounted (hidden) so drafts and review state survive tab switches.
- `PullRequestDetailHeader` (in `PullRequestDetailTabs.tsx`) is shared by the loaded and loading views. Author, branches, and size live in the header, not in Summary's meta rows. Keep Summary and Activity in the same centred column so tab switches keep their edges.
- The Code tab opens with the header folded so the diff keeps its height; whenever the header is folded, the conflict and checks status moves beside the tabs so it never disappears.
- Guide excerpts must stay inside one hunk of the loaded plan; validate model output in `src/shared/pullRequestTour.ts` rather than trusting line numbers.
- Files hidden by review filters stay in the Code tree as `ignored` (dimmed) entries; opening one reveals just that file. Coverage counts files across the whole plan and never counts a hidden file as viewed. Scope (whole pull request vs since last review) lives in the Show menu, not a separate control.
- With a current Guide, a block covering at least half of a stop's files takes that stop's title (`reviewUnitTitles.ts`); each stop names at most one block.
- Each Blocks row has its own chevron (`review-block-toggle`, a sibling of the row button) that shows or hides its files; only the selected block is open by default, and an explicit toggle wins. A file opened from an unselected block goes through `selectUnitFile` so it lands in that block even when other blocks share the path. J/K stay next/previous like the inbox and Guide.
- Guide-to-Code jumps go through `ReviewView`'s `navigationRequest` (path, line range, side) so they land on the section holding those lines.
- The Guide is the only AI layer in the PR view: pass its notes to `ReviewView` as `guideReferences` and do not pass `reviewGuideProvider` there (the AI brief is for local reviews). Pi is the default harness; fall back to the Claude Code CLI only when Pi is missing or signed out, never to hide real Pi failures.
- Guide prose renders through `GuideProse`: inline code naming a changed file (full path or unique suffix such as `machines.ts`) becomes a borderless file link that opens Code; other inline code keeps the T3-style tinted code style.

## Pull request status

- Count only unfinished check runs (and PENDING/EXPECTED status contexts) as pending in `parseChecks`; skipped and neutral runs are derived as `total - passed - failed - pending` and never shown as pending.
- Merge conflicts are actionable: `categorizePullRequest` files conflicting authored PRs under `needs-action`, and `pullRequestStatus` ranks conflicts above Draft so a label never hides them.
- Summary lists merge blockers (conflicts, failing or running checks, draft, behind, branch rules) in `PullRequestMergeChecklist`, each with the action that clears it (`pullRequestMergeBlockers.ts`); the plain Merge row only shows when nothing blocks. "Ready for review" calls `gh pr ready` and must never run without the user's click.
- Recently pushed branch lookups that fail with 403/404/410/422 are permanent and never raise the inbox warning; Retry clears the suggestion cache first. The inbox states what it includes and how many matches GitHub left out (`omittedCount`).

## Line breakdown

- Classify changed lines by path only in `src/shared/lineBreakdown.ts`; the Code tab's `categorizeReviewPath` and `isGeneratedReviewPath` live there too, so both views agree.
- The inbox gets at most 100 files per pull request from GraphQL; show the remainder as `Unlisted` rather than dropping it. The detail header uses the detail's full `files` list.
- Inbox rows and the detail header show it in the same hover/focus table on the `+/−` totals (`PullRequestLineStats` with `breakdown`); don't add an always-visible split line, it was too cluttered.

## PR accessibility

- AI jobs (review guide, bug scan) never start from a single click: idle or outdated jobs open `BackgroundJobConfirm` first. Inbox rows keep the job state icon-only (icon plus status dot, details in the tooltip); words beside the icons were tried and read as clutter.
- Inbox J/K move focus between rows (Enter opens) while focus is in the list or nowhere.
- Busy controls (refresh, Write guide, reviewer options) use `aria-disabled` plus a guarded click instead of `disabled`, so keyboard focus stays put.
- Announce background status changes (guide ready/failed, refresh failed, new activity) through `src/renderer/src/lib/announce.ts`, the single polite live region.
- Single-key shortcuts (Guide J/K) only act inside their pane or with nothing focused.

## PR visual tokens

- Stylelint (`.stylelintrc.json`, part of `pnpm lint`) requires `font-size` to use `--text-*` and `border-radius` to use `--radius-*`; mark a real exception with a `stylelint-disable-next-line` comment that says why.
- Use the `:root` type, spacing, and tone tokens in `main.css` for PR surfaces; keep content text at 11px or larger (10px only for counts, pills, and eyebrows).
- Tones: `pending` = in progress (info blue), `warning` = needs attention (amber), `muted` = no signal. Do not use amber for pending.
- In the Guide, teal marks position (the stop lane, current node and ordinal, selected tab, Next link) and copper (`--guide-annotation`) marks the guide's own commentary (note keys, judgement heads). Note keys are only for real code↔note references, and both directions must stay linked. Merged PRs use the neutral `merged` tone with a merge icon, not success green.
- Custom fields use `--border-control` at rest and the `.form-input:focus` treatment (`--focus-ring` border plus 1px outline) on focus; `--border` and `--select-border` are too faint for field edges or focus (WCAG 1.4.11).
- No content text below 11px anywhere, dashboards and Portainer included (`--text-2xs` stays for counts, pills, eyebrows and avatar initials).
- States that can last minutes (running CI runs, the "N Running" pill, guide writing) use the static `CircleDotDashed` icon or a dashed ring; spinners are only for short fetches, and skeletons are static.
- Electron's "Error invoking remote method" prefix is stripped once in the preload `invoke` (`src/shared/ipcErrors.ts`), so `error.message` is safe to show.


## Workflow run graph

- A job card's look comes from `workflowJobState` (`workflowJobState.ts`). Failed and running are the only filled cards (red, info blue), queued is the blue outline without the fill, passed stays flat and neutral, skipped is dashed. Don't add fills, shadows or weight to passed cards, and never change font weight by state: a heavier name wraps differently and the graph re-flows when a job fails.
- The sidebar and the header tally list jobs by state with failed first (`groupWorkflowJobsByState`). Tally chips for failed, running and queued jump to the next job in that state. Passed is a plain count.
- Opening a run scrolls the graph to its failed jobs, or its running ones when nothing failed. The graph scrolls inside `.workflow-run-job-scroll`, so the run facts and tally stay put.
- Geometry lives in `workflowRunGraphLayout.ts`, which places cards and lines in one coordinate space. Every column is packed from the top in workflow order (collapsed skipped jobs last). Don't reorder or align cards to straighten lines: that was tried and read as a mess. Density is fixed (6px gaps, columns only as wide as their longest name), so never fix clutter by adding space.
- Don't draw every dependency at rest. With the columns packed it is a tangle however it is routed. At rest only the failure flow is drawn (`workflowFailureFlow`): what each failed job held up, in red, and what the first failure of a chain waited for. Hover or focus on a card draws everything it waits for and everything waiting on it, and dims the rest.
- Tracing must not move anything. Pinned lines get their own tracks and set the gutter widths; traced lines fit into the tracks and gaps that are left (`pinnedEdges` and `tracedEdges` in `computeWorkflowGraphGeometry`).
- The lines that can be drawn are the dependencies a longer chain does not imply (`reduceWorkflowJobDependencies`). With skipped jobs collapsed, a job that ran links to the nearest jobs that ran before it, so a collapsed skipped node ends lines and never relays one.
- A dependency that skips columns passes through the gap between two cards or below the column, never behind a card. Lines merge on a vertical track only when they share a job.

## Selection and profiles

- List selection follows the macOS rule: the focused list shows `--select-row-focused` (teal tint), every other list `--select-row` (neutral). Graph rows, the sidebar tree and the PR inbox nav switch with `:focus-within` on their container; keep new lists on the same tokens.
- The PR inbox nav lists only All / Review requests / Yours and repositories; status categories narrow from each group heading's Show only button, never a second copy in the nav.
- The profile menu (`ProfileMenu.tsx`) only switches profiles. The editor lives in `ProfileEditor.tsx` inside Settings › Profiles (`ProfileSettingsSection.tsx`); `onOpenProfileSettings` opens Settings scrolled there.

## Diff readability

- Syntax themes are readable copies registered in `src/renderer/src/components/diff/diffTheme.ts` (`git-gud-dark-plus`, `git-gud-tokyo-night`). `READABLE_COLORS` lifts token colours to 4.5:1 on the `.gg-diff` canvas, added/removed lines and word emphasis; comments only need 4.5:1 on lines so they stay dimmer. Re-derive the map whenever the canvas, line tints or emphasis alphas in `main.css` change.
- Pierre pairs the n-th removed and added lines of a block; `dissimilarLineDiff.ts` drops word emphasis when a pair shares under half its words, so unrelated lines are not painted with confetti.
- The `codeFontFamily` setting (Settings › Diffs › Code font) overrides `--font-mono` on the document root; the name is sanitised in `normalizeCodeFontFamily`.

## Pull request review comments

- Keep new line and file comments local until the user submits the review.
- Render line composers and threads beneath their diff line; do not move active commenting UI above the diff.
- Pierre's gutter utility stays off for large-review hover performance (6489996); hovering a line number shows a CSS `+` and selecting lines opens the composer. Keyboard users get the line cursor in `reviewLineCursor.ts` (PR layout): ↑/↓ move, Shift extends within one chunk, C opens the composer for the range, Escape clears it. J/K still move between blocks.
- Normalize dragged line ranges into ascending GitHub API order regardless of drag direction.
- Keep review-unit and filter navigation disabled while a comment composer is open so typed text cannot be orphaned.
- In the pull-request layout Escape never closes the PR: it dismisses an empty composer (typed text needs Cancel). Closing or adding a comment returns focus to the review so J/K/V keep working.
- Use `btn-regular` for 32px review/header actions, `btn-compact` for 28px composer actions, and `review-comment-action` for 24px tertiary comment controls.
- Publish whole-file comments with GitHub's `subject_type: file` API and omit line fields.
- Only expose published-comment editing for comments authored by the active GitHub viewer. GitHub remains the authorization source of truth.

## Other machines (view-only)

- Never run a command on another machine that can write: keep `GIT_OPTIONAL_LOCKS=0`, and only use status, for-each-ref, and diff reads over SSH. No stage, commit, checkout, or context-menu actions on machine rows.
- Mirror remote branches only into local `refs/machines/<id>/heads/*`, and only inside `gitExecutor.transaction` plus `runDuringRefMutation`, so watchers don't loop.
- Machine WIP rows use `machine-wip:<id>` shas, carry `machineWip`, and never set `worktree`.
- Validate SSH hosts with `SSH_HOST_PATTERN`; a leading `-` must stay impossible.
- Tailscale discovery only runs `tailscale status --json` (`src/main/tailscale.ts`); check the app bundle and Homebrew paths because Finder-launched apps have a minimal PATH. Adding a device saves its full MagicDNS name after a passing connection test, and offers "Add anyway" on failure.
- Keep the last snapshot when SSH fails and show it as stale; changing a machine's SSH host clears its cached snapshot.
- Machine diffs pin `--src-prefix=a/ --dst-prefix=b/` so a remote `diff.mnemonicPrefix` or `diff.noprefix` cannot make patches unparseable.
