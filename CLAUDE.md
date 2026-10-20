# Project Guidance

## Review diffs

- Focused local and GitHub pull-request review plans should include bounded, prioritized full-file text context when available so unchanged lines above and below a hunk remain expandable.
- Preserve the patch-only fallback for binary, oversized, unavailable, or non-UTF-8 file contents.

## Pull request review comments

- Keep new line and file comments local until the user submits the review.
- Render line composers and threads beneath their diff line; do not move active commenting UI above the diff.
- Keep Pierre's gutter utility enabled when no composer is open so hovering a diff line reveals an accessibly labelled `+` comment affordance.
- Normalize dragged line ranges into ascending GitHub API order regardless of drag direction.
- Keep review-unit and filter navigation disabled while a comment composer is open so typed text cannot be orphaned.
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
