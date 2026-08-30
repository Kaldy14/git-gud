# Codex Agent Notes

Git Gud Agent Notes are brief, agent-authored explanations attached to changed lines. They exist for implementation context that a reviewer needs but cannot reliably infer from the diff.

## Install the skill

Open **Settings → Codex** and select **Install skill**. Git Gud copies its managed skill to:

```text
~/.agents/skills/git-gud-agent-notes
```

Codex discovers user-level skills for local tasks regardless of which repository or application started the task. If Codex was already running and the skill does not appear, restart Codex once.

Git Gud reports **Update available** when its bundled copy changes. Updating replaces only the Git Gud-managed skill directory. If an unmanaged skill already occupies the target path, Git Gud reports a conflict and does not overwrite it.

## When Codex should leave a note

Most implementation tasks need no notes. A note should explain one of these:

- a non-obvious constraint that shaped the implementation;
- a behavior or compatibility contract that must remain true;
- a concrete risk or tradeoff that matters during review.

Agent Notes are not progress logs. Codex should not record summaries, tests, obvious code narration, general advice, or speculative concerns. Notes should remain short, but they are not restricted to one sentence and there is no count limit.

## How notes are written

The skill runs its bundled deterministic writer after implementation and validation:

```bash
node "$HOME/.agents/skills/git-gud-agent-notes/scripts/add-agent-note.mjs" agent-note add \
  --repo . \
  --file src/example.ts \
  --new-line 42 \
  --summary "Keep this optional for older saved tasks." \
  --detail "Existing records do not contain the field."
```

The writer lives inside the installed skill. Repository paths remain relative to the active checkout. The writer:

- resolves the repository root and the exact linked-worktree Git directory;
- requires a non-blank line added by the current diff;
- captures the trimmed source line as a relocation anchor;
- validates note lengths and paths;
- appends one JSON object without changing working-tree files.

For tasks that also require a commit, Codex writes any warranted notes before committing. The writer accepts only lines in the current uncommitted diff so stale context cannot be attached after the implementation has left the review surface.

`--detail` and `--author` are optional. `--json` returns the stored object for automation. Codex should use the bundled writer rather than edit storage directly.

## Storage and display

Notes are stored as append-only JSONL in the current worktree's Git directory:

```text
<git-dir>/git-gud-agent-notes.jsonl
```

Because storage lives under Git metadata, notes do not appear in commits or working-tree status. Git Gud validates the file before rendering it. Invalid records are ignored. The reader accepts at most 1 MB of data and keeps the latest 200 unique note IDs in memory.

Git Gud first matches the recorded line and anchor. If nearby edits moved the line, it relocates the note only when the anchor has one unambiguous match. A note is displayed only when its target line belongs to the current diff. This prevents stale context from attaching to unrelated code.

Selecting **Hide note** marks it as read for that local repository and collapses it to a small inline marker. Selecting **Show** opens it again. This read state belongs to the human reviewer and is not exposed to the agent.

## Current limits

- The skill is available to local Codex clients on the machine where it is installed.
- Agent Notes require a local Git checkout or linked worktree. Remote-only pull-request views have no local Git directory for note storage.
- Installing the skill does not force Codex to write notes. Codex decides whether the finished diff contains context worth preserving.
- Agent Notes do not let Codex navigate or control the Git Gud interface. That would require a separate live integration and is outside this feature.
