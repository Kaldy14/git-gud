---
name: git-gud-agent-notes
description: After implementation tasks that change files in a Git repository, inspect the finished diff and optionally leave concise Git Gud Agent Notes for non-obvious constraints, behavior contracts, or risks. Most tasks need no notes. Do not use for read-only work or reviews with no code changes.
---

# Git Gud Agent Notes

After finishing the implementation and its validation, inspect the resulting diff. Usually leave no notes.

Add an Agent Note only when a future reviewer must know something the diff does not explain by itself:

- a non-obvious constraint that shaped the implementation;
- a behavior or compatibility contract that must remain true;
- a concrete risk or tradeoff that matters during review.

Do not add progress updates, change summaries, test results, obvious code narration, general advice, or speculative concerns. Keep the summary short. Add detail only when it earns the extra space. There is no note quota or target count.

Attach each note to the most relevant non-blank added line. Run the writer installed beside this `SKILL.md` file:

```bash
node "$HOME/.agents/skills/git-gud-agent-notes/scripts/add-agent-note.mjs" agent-note add \
  --repo . \
  --file src/example.ts \
  --new-line 42 \
  --summary "Keep this optional for older saved tasks." \
  --detail "Existing records do not contain the field."
```

The writer resolves the worktree Git directory, verifies that the target is an added line, captures its anchor, and appends the note for Git Gud. Omit `--detail` when the summary is enough. If the writer rejects a note, correct the target or leave no note. Do not edit Git Gud's notes file directly.

If the task also requires a commit, make this decision and write any notes before committing. The writer intentionally accepts only lines in the current uncommitted diff.
