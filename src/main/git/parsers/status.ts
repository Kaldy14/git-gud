import type { GitBranchState, GitFileChange, GitStatusCode, GitStatusSummary } from '@shared/types';

const ZERO_BRANCH: GitBranchState = {
  head: '(unknown)',
  ahead: 0,
  behind: 0,
  isDetached: false
};

export function parseStatusPorcelainV2(output: string): GitStatusSummary {
  const tokens = output.split('\0').filter((token) => token.length > 0);
  const files: GitFileChange[] = [];
  const branch: GitBranchState = { ...ZERO_BRANCH };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.startsWith('# ')) {
      parseBranchHeader(token, branch);
      continue;
    }

    if (token.startsWith('? ')) {
      files.push(createFileChange(token.slice(2), undefined, 'untracked', 'untracked', false));
      continue;
    }

    if (token.startsWith('! ')) {
      files.push(createFileChange(token.slice(2), undefined, 'ignored', 'ignored', false));
      continue;
    }

    if (token.startsWith('1 ')) {
      const fields = token.split(' ');
      const status = fields[1] ?? '..';
      const path = fields.slice(8).join(' ');
      files.push(createFileChange(path, undefined, statusCharToCode(status[0]), statusCharToCode(status[1]), false));
      continue;
    }

    if (token.startsWith('2 ')) {
      const fields = token.split(' ');
      const status = fields[1] ?? '..';
      const path = fields.slice(9).join(' ');
      const nextToken = tokens[index + 1];
      const originalPath = nextToken && !isStatusRecord(nextToken) ? nextToken : undefined;

      if (originalPath) {
        index += 1;
      }

      files.push(createFileChange(path, originalPath, statusCharToCode(status[0]), statusCharToCode(status[1]), false));
      continue;
    }

    if (token.startsWith('u ')) {
      const fields = token.split(' ');
      const path = fields.slice(10).join(' ');
      files.push(createFileChange(path, undefined, 'conflicted', 'conflicted', true));
    }
  }

  const stagedCount = files.filter((file) => file.staged).length;
  const unstagedCount = files.filter((file) => file.unstaged).length;
  const untrackedCount = files.filter((file) => file.status === 'untracked').length;
  const conflictedCount = files.filter((file) => file.conflicted).length;

  return {
    branch,
    files,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictedCount,
    dirtyCount: files.filter((file) => file.status !== 'ignored').length,
    isDirty: files.some((file) => file.status !== 'ignored')
  };
}

function parseBranchHeader(token: string, branch: GitBranchState): void {
  const [key, value] = splitHeader(token);

  if (key === 'branch.oid') {
    branch.oid = value === '(initial)' ? undefined : value;
    return;
  }

  if (key === 'branch.head') {
    branch.head = value;
    branch.isDetached = value === '(detached)';
    return;
  }

  if (key === 'branch.upstream') {
    branch.upstream = value;
    return;
  }

  if (key === 'branch.ab') {
    const match = /^\+(\d+) -(\d+)$/.exec(value);

    if (match) {
      branch.ahead = Number(match[1]);
      branch.behind = Number(match[2]);
    }
  }
}

function splitHeader(token: string): [string, string] {
  const separatorIndex = token.indexOf(' ', 2);

  if (separatorIndex === -1) {
    return [token.slice(2), ''];
  }

  return [token.slice(2, separatorIndex), token.slice(separatorIndex + 1)];
}

function createFileChange(
  path: string,
  originalPath: string | undefined,
  indexStatus: GitStatusCode,
  worktreeStatus: GitStatusCode,
  conflicted: boolean
): GitFileChange {
  const staged = !conflicted && indexStatus !== 'unmodified' && indexStatus !== 'untracked' && indexStatus !== 'ignored';
  const unstaged = !conflicted && (worktreeStatus !== 'unmodified' || indexStatus === 'untracked');
  const status = conflicted ? 'conflicted' : selectDisplayStatus(indexStatus, worktreeStatus);

  return {
    path,
    originalPath,
    indexStatus,
    worktreeStatus,
    status,
    staged,
    unstaged,
    conflicted
  };
}

function selectDisplayStatus(indexStatus: GitStatusCode, worktreeStatus: GitStatusCode): GitStatusCode {
  if (indexStatus === 'untracked' || worktreeStatus === 'untracked') {
    return 'untracked';
  }

  if (worktreeStatus !== 'unmodified') {
    return worktreeStatus;
  }

  return indexStatus;
}

function statusCharToCode(value: string | undefined): GitStatusCode {
  switch (value) {
    case undefined:
    case '.':
    case ' ':
      return 'unmodified';
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    case 'U':
      return 'conflicted';
    default:
      return 'modified';
  }
}

function isStatusRecord(token: string): boolean {
  return (
    token.startsWith('# ') ||
    token.startsWith('1 ') ||
    token.startsWith('2 ') ||
    token.startsWith('u ') ||
    token.startsWith('? ') ||
    token.startsWith('! ')
  );
}
