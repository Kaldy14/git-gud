import type { GitCommitStats, GitFileChangeDetail, GitStatusCode } from '@shared/types';

export function parseNameStatus(output: string): GitFileChangeDetail[] {
  const tokens = output.split('\0').filter((token) => token.length > 0);
  const files: GitFileChangeDetail[] = [];

  for (let index = 0; index < tokens.length;) {
    const rawStatus = tokens[index];
    index += 1;

    if (!rawStatus) {
      continue;
    }

    const normalizedStatus = rawStatus.trim();
    const statusLetter = normalizedStatus[0] ?? 'M';
    const status = statusLetterToCode(statusLetter);

    if (statusLetter === 'R' || statusLetter === 'C') {
      const originalPath = tokens[index];
      const path = tokens[index + 1];
      index += 2;

      if (path) {
        files.push(createCommitFileDetail(path, originalPath, status));
      }

      continue;
    }

    const path = tokens[index];
    index += 1;

    if (path) {
      files.push(createCommitFileDetail(path, undefined, status));
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function parseShortStat(output: string): GitCommitStats {
  return {
    filesChanged: readStatCount(output, /(\d+) files? changed/),
    additions: readStatCount(output, /(\d+) insertions?\(\+\)/),
    deletions: readStatCount(output, /(\d+) deletions?\(-\)/)
  };
}

function createCommitFileDetail(
  path: string,
  originalPath: string | undefined,
  status: GitStatusCode
): GitFileChangeDetail {
  return {
    path,
    originalPath,
    status,
    staged: false,
    unstaged: false,
    conflicted: false
  };
}

function statusLetterToCode(value: string): GitStatusCode {
  switch (value) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'U':
      return 'conflicted';
    case 'M':
    case 'T':
    default:
      return 'modified';
  }
}

function parsePositiveInteger(value: string | undefined): number {
  return value ? Number.parseInt(value, 10) : 0;
}

function readStatCount(output: string, pattern: RegExp): number {
  return parsePositiveInteger(pattern.exec(output)?.[1]);
}
