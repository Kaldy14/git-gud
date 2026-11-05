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

- Use the `:root` type, spacing, and tone tokens in `main.css` for PR surfaces; keep content text at 11px or larger (10px only for counts, pills, and eyebrows).
- Tones: `pending` = in progress (info blue), `warning` = needs attention (amber), `muted` = no signal. Do not use amber for pending.
- In the Guide, teal marks position (the stop lane, current node and ordinal, selected tab, Next link) and copper (`--guide-annotation`) marks the guide's own commentary (note keys, judgement heads). Note keys are only for real code↔note references, and both directions must stay linked. Merged PRs use the neutral `merged` tone with a merge icon, not success green.

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
