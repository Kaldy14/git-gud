import type { GitReviewChunk, GitStatusCode } from '@shared/types';

type HunkSideLine = {
  text: string;
  changed: boolean;
};

export function categorizeReviewPath(filePath: string): GitReviewChunk['category'] {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const segments = normalized.split('/');
  const basename = segments.at(-1) ?? '';

  if (
    segments.some((segment) => segment === 'test' || segment === 'tests' || segment === '__tests__') ||
    /(?:^|[._])tests?(?:[._])/.test(basename)
  ) {
    return 'test';
  }

  if (
    segments.some(
      (segment) => segment === 'spec' || segment === 'specs' || segment === '__specs__'
    ) ||
    /(?:^|[._])specs?(?:[._])/.test(basename)
  ) {
    return 'spec';
  }

  return 'source';
}

export function classifyReviewChangeType(
  status: GitStatusCode,
  additions: number,
  deletions: number
): GitReviewChunk['changeType'] {
  if (status === 'deleted' || (deletions > 0 && additions === 0)) {
    return 'deleted';
  }

  if (additions > 0 && deletions === 0) {
    return 'added';
  }

  return 'modified';
}

export function classifyReviewContent(bodyLines: string[]): GitReviewChunk['contentKind'] {
  const sides = [hunkSideLines(bodyLines, 'old'), hunkSideLines(bodyLines, 'new')];
  let hasSemanticChange = false;

  for (const lines of sides) {
    const changedLineIndexes = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.changed && line.text.trim().length > 0)
      .map(({ index }) => index);

    if (changedLineIndexes.length === 0) {
      continue;
    }

    hasSemanticChange = true;
    const importLines = importLineMask(lines);

    if (changedLineIndexes.some((index) => !importLines[index])) {
      return 'code';
    }
  }

  return hasSemanticChange ? 'imports' : 'code';
}

function hunkSideLines(bodyLines: string[], side: 'old' | 'new'): HunkSideLine[] {
  const lines: HunkSideLine[] = [];

  for (const line of bodyLines) {
    if (line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('+')) {
      if (side === 'new') {
        lines.push({ text: line.slice(1).trimEnd(), changed: true });
      }
      continue;
    }

    if (line.startsWith('-')) {
      if (side === 'old') {
        lines.push({ text: line.slice(1).trimEnd(), changed: true });
      }
      continue;
    }

    lines.push({ text: line.startsWith(' ') ? line.slice(1).trimEnd() : line.trimEnd(), changed: false });
  }

  return lines;
}

function importLineMask(lines: HunkSideLine[]): boolean[] {
  const importLines = lines.map(() => false);
  let inImport = false;
  let delimiterDepth = 0;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.text.trim();

    if (!inImport && startsImportStatement(trimmed)) {
      inImport = true;
      delimiterDepth = 0;
    }

    if (!inImport) {
      continue;
    }

    importLines[index] = true;
    delimiterDepth += delimiterDelta(trimmed);

    if (delimiterDepth <= 0 && !continuesImportStatement(trimmed)) {
      inImport = false;
      delimiterDepth = 0;
    }
  }

  return importLines;
}

function startsImportStatement(value: string): boolean {
  if (!value || /^import\s*[.(]/.test(value) || /^using\s+(?:var\b|\()/.test(value)) {
    return false;
  }

  return /^(?:import\b|from\s+\S+\s+import\b|use\b|using\b|require(?:_relative)?\b|#\s*include\b|@import\b|(?:const|let|var)\s+.+?=\s*require\s*\()/.test(
    value
  );
}

function continuesImportStatement(value: string): boolean {
  return /[,\\]$/.test(value);
}

function delimiterDelta(value: string): number {
  let delta = 0;

  for (const character of value) {
    if (character === '(' || character === '[' || character === '{') {
      delta += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      delta -= 1;
    }
  }

  return delta;
}
