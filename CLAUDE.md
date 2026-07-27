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
