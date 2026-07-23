# Changelog

All notable changes to Git Gud are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.9] - 2026-07-23

### Added

- Added a toggleable Pierre file tree to the right side of reviews, with changed-file statuses, search, and file selection that navigates to the matching review group and diff.

### Changed

- Let review mode use the commit-detail panel space so diffs remain readable with the file tree open, restoring commit details when review closes.
- Remembered file-tree visibility per repository and kept review keyboard navigation from intercepting tree interactions.

## [0.4.8] - 2026-07-23

### Added

- Added whole-branch reviews with context-based grouping, fast navigation, and expandable nearby diff blocks.
- Added a focused pull-request inbox and pull-request review flow backed by live GitHub data.
- Added an optional asynchronous AI walkthrough that ranks existing review groups, summarizes intent, explains changes, and reports only evidence-backed issues while the diff remains usable.

### Changed

- Simplified the review header around the selected commit, branch, working directory, or pull request, with consolidated filters, progress, diff layout, and AI controls.
- Improved review grouping for related symbol extensions and matching references.

### Fixed

- Restored live pull-request inbox data and clearer return navigation from pull-request review states.
- Kept generated AI walkthrough copy harness agnostic.
- Resumed AI guide cache pruning after long-running jobs complete.

## [0.4.6] - 2026-07-21

### Fixed

- Kept truncated branch and tag labels contained within their graph column instead of expanding over commit lanes on hover or focus.
- Scoped working-directory WIP rows to the currently opened worktree so dirty linked worktrees no longer appear in a clean repository graph.

## [0.4.5] - 2026-07-21

### Added

- Added an editable conflict resolver with ours/theirs previews, per-marker choices, manual output editing, deletion support, and save-and-stage navigation across unresolved files.
- Added a guarded reset-to-remote flow for same-named or diverged local branches, including undo metadata when the branch tip moves.
- Added linked-worktree working-directory rows and worktree reference chips to the commit graph.
- Added automatic and manual update checks for packaged macOS builds, with background downloads and a restart-to-install prompt.
- Added automatic signed macOS updates with background downloads, restart prompts, and a manual update check.

### Changed

- Refined commit-graph sizing, lanes, references, side-panel layout, and diff highlighting to better match the target graph design.

### Fixed

- Preserved structured conflict state across merge, rebase, cherry-pick, revert, and stash operations so conflicted files open directly in the resolver.
- Showed branch-chip loading feedback while the checked-out branch fast-forwards from its remote.
- Stabilized graph switching and repository queries when activating linked worktrees.

## [0.4.4] - 2026-07-20

### Fixed

- Resolved remote branch activation by exact local tracking-branch identity when several local branches share the same upstream.
- Preserved renamed tracking-branch activation while requiring an explicit checkout when multiple renamed candidates are ambiguous.

## [0.4.2] - 2026-07-16

### Added

- Added GraphQL-aware, syntax-backed review relationships and story clustering powered by Tree-sitter.
- Added inline tag creation from a commit's context menu, contained within the branch/tag column.

### Changed

- Improved review grouping, contextual rendering, generated-file filtering, and syntax cache invalidation.

## [0.3.2] - 2026-07-15

### Changed

- Bounded the Gravatar URL cache and deferred commit-search indexing until search is opened.
- Reduced large-sidebar rendering work and made stageable patch parsing scale linearly with hunk count.
- Capped sparse multi-commit detail pipelines to lower peak Git subprocess and memory pressure.

## [0.3.1] - 2026-07-15

### Changed

- Bounded per-repository Git read concurrency, prioritized queued mutations, and added cancellation deadlines with bounded progress and error buffering.
- Reduced checkout, conflict inspection, and working-tree mutation subprocess work while batching and capping bulk cherry-pick preflight.
- Replaced recursive Git metadata watching with targeted native watchers and mutation-aware refresh coalescing.

### Fixed

- Prevented stale commit and file selection responses from overriding newer renderer selections.
- Preserved working-directory rename metadata without reloading immutable history and flushed deferred selection persistence on quit.
- Scoped busy state per repository and blocked file or hunk actions while a mutation is active.

## [0.3.0] - 2026-07-14

### Added

- Multi-commit inspection with aggregate metadata, combined file changes, and contiguous or per-commit diff previews.
- Shift-range selection in the commit graph with synchronized selection details.
- A diff context-menu handoff that opens a prefilled Codex task for the active repository, selected code, revision, and follow-up question.

### Fixed

- Preserved rename and copy paths while combining file changes across selected commits.
- Rejected invalid, duplicate, or oversized commit selections before invoking Git.

## [0.2.1] - 2026-07-14

### Fixed

- Display the packaged application version in the status bar instead of a placeholder version.

## [0.2.0] - 2026-07-14

### Added

- Multi-select commit workflows for ordered cherry-picks and contiguous commit squashing.
- Commit-history search and expanded branch lifecycle actions.
- Per-profile workspace state for open tabs, recent repositories, and GitHub CLI identities.

### Changed

- Improved commit ordering, date presentation, branch-label display, and commit-detail layout.
- Polished repository navigation, graph interactions, and operation feedback.

### Fixed

- Prevented commit-detail content from overflowing or losing access to file changes.
- Hardened bulk Git operation validation and undo behavior.

## [0.1.0] - 2026-07-14

### Added

- Local-first repository tabs with restored workspaces and per-repository Git profiles.
- Virtualized commit history with branch, remote, tag, worktree, stash, and working-directory context.
- Commit details, file trees, syntax-highlighted unified and split diffs, and precise staging workflows.
- Everyday Git operations, interactive rebase, conflict recovery, progress reporting, and safe local undo.
- Keyboard navigation, command palette, repository inspection, and responsive panels.
- Pull-request and `main` branch CI for linting, tests, type checking, and production builds.
- Tag-driven GitHub Releases with Apple Silicon and Intel macOS application archives and SHA-256 checksums.

### Changed

- Clarified that macOS is the currently supported release platform rather than an architectural limitation of the project.
