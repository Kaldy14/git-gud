# Changelog

All notable changes to Git Gud are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
