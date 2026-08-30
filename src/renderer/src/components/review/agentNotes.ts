import type { GitAgentNote, GitReviewFileContext } from '@shared/types';

const HIDDEN_AGENT_NOTES_STORAGE_PREFIX = 'git-gud:hidden-agent-notes:v1:';
const MAX_HIDDEN_AGENT_NOTE_IDS = 500;

export function resolveAgentNotes(
  notes: readonly GitAgentNote[],
  fileContexts: readonly GitReviewFileContext[]
): GitAgentNote[] {
  const contextsByPath = new Map<string, GitReviewFileContext[]>();

  for (const context of fileContexts) {
    const contexts = contextsByPath.get(context.path) ?? [];
    contexts.push(context);
    contextsByPath.set(context.path, contexts);
  }

  return notes.flatMap((note) => {
    const contexts = contextsByPath.get(note.path);

    if (!contexts) {
      return [];
    }

    if (contexts.some((context) =>
      context.newContents.split(/\r?\n/u)[note.line - 1]?.trim() === note.anchor
    )) {
      return [note];
    }

    const matchingLines = new Set(
      contexts.flatMap((context) =>
        context.newContents.split(/\r?\n/u).flatMap((line, index) =>
          line.trim() === note.anchor ? [index + 1] : []
        )
      )
    );

    return matchingLines.size === 1
      ? [{ ...note, line: [...matchingLines][0]! }]
      : [];
  });
}

export function loadHiddenAgentNoteIds(
  storage: Pick<Storage, 'getItem'>,
  repoPath: string
): Set<string> {
  const stored = storage.getItem(hiddenAgentNotesStorageKey(repoPath));

  if (!stored) {
    return new Set();
  }

  try {
    const value: unknown = JSON.parse(stored);

    if (!Array.isArray(value)) {
      return new Set();
    }

    return new Set(
      value
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(-MAX_HIDDEN_AGENT_NOTE_IDS)
    );
  } catch {
    return new Set();
  }
}

export function saveHiddenAgentNoteIds(
  storage: Pick<Storage, 'setItem'>,
  repoPath: string,
  hiddenIds: ReadonlySet<string>
): void {
  storage.setItem(
    hiddenAgentNotesStorageKey(repoPath),
    JSON.stringify([...hiddenIds].slice(-MAX_HIDDEN_AGENT_NOTE_IDS))
  );
}

function hiddenAgentNotesStorageKey(repoPath: string): string {
  return `${HIDDEN_AGENT_NOTES_STORAGE_PREFIX}${encodeURIComponent(repoPath)}`;
}
