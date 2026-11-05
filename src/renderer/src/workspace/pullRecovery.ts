import type { GitPullInput, GitRepositoryOverview } from '@shared/types';

/** Everything recovery needs, captured when the pull fails so a later tab switch cannot retarget it. */
export type PullRecovery = {
  repoPath: string;
  repoName: string;
  branchName: string;
  upstream?: string;
  mode: GitPullInput['mode'];
};

/** How a failed operation stays on screen: `summary` replaces the raw error, which moves to Details. */
export type OperationFailureState = {
  summary?: string;
  persistent: boolean;
  recovery?: PullRecovery;
};

export type LocalResetPlan = {
  title: string;
  description: string;
  detailItems: string[];
  confirmLabel: string;
  stashChanges: boolean;
};

export const SAVED_IN_STASHES_NOTE = 'Your local changes are saved in Stashes and have not been reapplied.';
const NOT_STASHED_NOTE = 'Your local changes were not stashed and are still in your working tree.';

const LOCAL_CHANGES_BLOCK_PATTERNS = [
  /local changes to the following files would be overwritten/i,
  /untracked working tree files would be overwritten/i,
  /please commit your changes or stash them before you/i,
  /cannot (?:pull with rebase|rebase): (?:you have unstaged changes|your index contains uncommitted changes)/i
];
const SAVED_IN_STASHES_PATTERN = /saved in stashes/i;
const BLOCKED_FILES_HEADER_PATTERN = /files would be overwritten by \w+:\s*$/i;

export function isPullBlockedByLocalChanges(message: string): boolean {
  return !isSavedInStashesMessage(message) &&
    LOCAL_CHANGES_BLOCK_PATTERNS.some((pattern) => pattern.test(message));
}

export function isSavedInStashesMessage(message: string): boolean {
  return SAVED_IN_STASHES_PATTERN.test(message);
}

/** Git lists blocked paths as indented lines under each "would be overwritten by" header. */
export function parsePullBlockedFiles(message: string): string[] {
  const files = new Set<string>();
  let isInFileList = false;

  for (const line of message.split(/\r?\n/)) {
    if (BLOCKED_FILES_HEADER_PATTERN.test(line)) {
      isInFileList = true;
    } else if (isInFileList && /^\s+\S/.test(line)) {
      files.add(line.trim());
    } else {
      isInFileList = false;
    }
  }

  return [...files];
}

export function resolvePullFailure(message: string, context: PullRecovery): OperationFailureState | undefined {
  if (!isPullBlockedByLocalChanges(message)) {
    return undefined;
  }

  return {
    summary: describePullBlock(message, context),
    persistent: true,
    recovery: context
  };
}

/** A failed stash retry or stash-and-reset never offers the same recovery again. */
export function resolveStashedOperationFailure(message: string): OperationFailureState {
  return {
    summary: isSavedInStashesMessage(message) ? SAVED_IN_STASHES_NOTE : NOT_STASHED_NOTE,
    persistent: true
  };
}

/** A conflict message replaces the operation's own text, so the stash note is restored here. */
export function withSavedInStashesNote(detail: string | undefined): string {
  if (!detail) {
    return SAVED_IN_STASHES_NOTE;
  }

  return isSavedInStashesMessage(detail) ? detail : `${detail}\n${SAVED_IN_STASHES_NOTE}`;
}

export function stashAndPullDialogItems(recovery: PullRecovery): string[] {
  return [
    'Save all staged, unstaged, and untracked files in Stashes.',
    `Pull ${recovery.branchName} from ${recovery.upstream ?? 'its upstream'}.`,
    'Your changes are not reapplied automatically. Apply them from Stashes in the sidebar when you are ready.'
  ];
}

/**
 * `assumeDirtyCurrent` covers a recovery whose repository overview is not cached. The backend
 * still validates the branch, and a clean-only reset is refused rather than discarding work.
 */
export function createLocalResetPlan(input: {
  repoName: string;
  localName: string;
  remoteName: string;
  overview?: GitRepositoryOverview;
  assumeDirtyCurrent?: boolean;
}): LocalResetPlan {
  const { repoName, localName, remoteName, overview } = input;
  const branch = overview?.status.branch;
  const isCurrent = branch ? !branch.isDetached && branch.head === localName : Boolean(input.assumeDirtyCurrent);
  const hasChanges = overview ? overview.status.isDirty : Boolean(input.assumeDirtyCurrent);
  const ahead = overview?.refs.localBranches.find((candidate) => candidate.name === localName)?.ahead ?? 0;
  const stashChanges = isCurrent && hasChanges;
  const moveItem = ahead > 0
    ? `Move ${localName} to ${remoteName}. ${ahead} local ${ahead === 1 ? 'commit' : 'commits'} will leave ${localName}.`
    : `Move ${localName} to ${remoteName}. Any commits only on ${localName} will leave the branch.`;
  const undoItem = 'You can undo the reset until the repository changes again.';

  return {
    title: `Reset ${localName} to ${remoteName}?`,
    description: `This changes the local branch ${localName} in ${repoName}.`,
    detailItems: stashChanges
      ? [
          'Save all staged, unstaged, and untracked files in Stashes.',
          moveItem,
          'Your changes are not reapplied automatically. Apply them from Stashes in the sidebar when you are ready.',
          undoItem
        ]
      : [
          moveItem,
          hasChanges && !isCurrent
            ? `Commit or stash your changes first. Stash and reset only works while ${localName} is checked out.`
            : 'Your working tree must be clean.',
          undoItem
        ],
    confirmLabel: stashChanges ? 'Stash and Reset' : 'Reset Local to Remote',
    stashChanges
  };
}

function describePullBlock(message: string, { branchName, repoName }: PullRecovery): string {
  const files = parsePullBlockedFiles(message);
  const blocked = files.length === 0
    ? 'Local changes'
    : `Local changes to ${files.length === 1 ? files[0] : `${files.length} files`}`;

  return `${branchName} in ${repoName} was not updated. ${blocked} would be overwritten.`;
}
