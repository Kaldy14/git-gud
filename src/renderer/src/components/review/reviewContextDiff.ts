import type { FileDiffMetadata, Hunk } from '@pierre/diffs';
import { parseDiffFromFile, processFile } from '@pierre/diffs';

import type {
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewSyntaxNode
} from '@shared/types';

export type ExpandableReviewDiff = {
  fileDiff: FileDiffMetadata;
  leadingContextLines: string[];
  trailingContextLines: string[];
  leadingContextStartLine: number;
  trailingContextStartLine: number;
  syntaxNodes: GitReviewSyntaxNode[];
};

export type PreparedReviewDiff = {
  fileDiff: FileDiffMetadata;
  expandable?: ExpandableReviewDiff;
};

export function prepareReviewDiff(
  chunk: GitReviewChunk,
  context: GitReviewFileContext | undefined,
  cacheKeyPrefix: string
): PreparedReviewDiff | undefined {
  const cacheKey = `review:${cacheKeyPrefix}:${chunk.id}`;
  const expandable = context ? createExpandableReviewDiff(chunk, context) : undefined;

  if (expandable) {
    const fileDiff = { ...expandable.fileDiff, cacheKey };

    return {
      fileDiff,
      expandable: { ...expandable, fileDiff }
    };
  }

  try {
    const fileDiff = processFile(chunk.patch, { cacheKey, throwOnError: true });
    return fileDiff ? { fileDiff } : undefined;
  } catch {
    return undefined;
  }
}

export function createExpandableReviewDiff(
  chunk: GitReviewChunk,
  context: GitReviewFileContext
): ExpandableReviewDiff | undefined {
  try {
    const patchDiff = processFile(chunk.patch, { throwOnError: true });
    const expectedHunk = patchDiff?.hunks[0];

    if (!expectedHunk || patchDiff.hunks.length !== 1) {
      return undefined;
    }

    const fullDiff = parseDiffFromFile(
      {
        name: chunk.originalPath ?? chunk.path,
        contents: context.oldContents
      },
      {
        name: chunk.path,
        contents: context.newContents
      },
      { context: 3 },
      true
    );
    const hunkIndex = fullDiff.hunks.findIndex((candidate) => hunksMatch(candidate, expectedHunk));
    const hunk = fullDiff.hunks[hunkIndex];

    if (!hunk) {
      return undefined;
    }

    const nextHunk = fullDiff.hunks[hunkIndex + 1];
    const leadingLineCount = hunk.collapsedBefore;
    const trailingLineCount = nextHunk?.collapsedBefore ?? trailingContextLineCount(fullDiff, hunk);
    const deletionSliceStart = hunk.deletionLineIndex - leadingLineCount;
    const additionSliceStart = hunk.additionLineIndex - leadingLineCount;
    const deletionSliceEnd = hunk.deletionLineIndex + hunk.deletionCount + trailingLineCount;
    const additionSliceEnd = hunk.additionLineIndex + hunk.additionCount + trailingLineCount;
    const deletionLines = fullDiff.deletionLines.slice(deletionSliceStart, deletionSliceEnd);
    const additionLines = fullDiff.additionLines.slice(additionSliceStart, additionSliceEnd);
    const isolatedHunk: Hunk = {
      ...hunk,
      collapsedBefore: leadingLineCount,
      deletionLineIndex: leadingLineCount,
      additionLineIndex: leadingLineCount,
      splitLineStart: leadingLineCount,
      unifiedLineStart: leadingLineCount,
      hunkContent: hunk.hunkContent.map((content) => ({
        ...content,
        deletionLineIndex: content.deletionLineIndex - deletionSliceStart,
        additionLineIndex: content.additionLineIndex - additionSliceStart
      }))
    };

    return {
      fileDiff: {
        ...fullDiff,
        cacheKey: `review:${context.id}:${chunk.id}`,
        hunks: [isolatedHunk],
        deletionLines,
        additionLines,
        splitLineCount: leadingLineCount + isolatedHunk.splitLineCount + trailingLineCount,
        unifiedLineCount: leadingLineCount + isolatedHunk.unifiedLineCount + trailingLineCount
      },
      leadingContextLines: additionLines.slice(0, leadingLineCount),
      leadingContextStartLine: Math.max(hunk.additionStart - leadingLineCount, 1),
      trailingContextLines: additionLines.slice(
        isolatedHunk.additionLineIndex + isolatedHunk.additionCount
      ),
      trailingContextStartLine: hunk.additionStart + hunk.additionCount,
      syntaxNodes: context.syntax?.newNodes ?? []
    };
  } catch {
    return undefined;
  }
}

function hunksMatch(candidate: Hunk, expected: Hunk): boolean {
  return candidate.additionStart === expected.additionStart &&
    candidate.additionCount === expected.additionCount &&
    candidate.deletionStart === expected.deletionStart &&
    candidate.deletionCount === expected.deletionCount;
}

function trailingContextLineCount(diff: FileDiffMetadata, hunk: Hunk): number {
  const deletionCount = diff.deletionLines.length - (hunk.deletionLineIndex + hunk.deletionCount);
  const additionCount = diff.additionLines.length - (hunk.additionLineIndex + hunk.additionCount);
  return Math.max(Math.min(deletionCount, additionCount), 0);
}

const MAX_SMART_EXPANSION_LINES = 80;

export function getSmartExpansionLineCount(
  hiddenLines: readonly string[],
  direction: 'before' | 'after',
  filePath: string
): number {
  if (hiddenLines.length === 0) {
    return 0;
  }

  const isGraphql = /\.(?:graphql|gql)$/i.test(filePath);
  const isJson = /\.json$/i.test(filePath);
  const indexes = direction === 'before'
    ? Array.from({ length: hiddenLines.length }, (_, index) => hiddenLines.length - index - 1)
    : Array.from({ length: hiddenLines.length }, (_, index) => index);
  let balance = 0;
  let count = 0;
  let sawCode = false;
  let sawBrace = false;

  for (const index of indexes) {
    const line = hiddenLines[index] ?? '';
    count += 1;

    if (line.trim().length === 0) {
      if (sawCode && balance <= 0) {
        return count;
      }

      if (count >= MAX_SMART_EXPANSION_LINES) {
        return count;
      }

      continue;
    }

    sawCode = true;
    const structuralLine = stripStringsAndLineComment(line);
    const openings = countCharacters(structuralLine, /[{[]/g);
    const closings = countCharacters(structuralLine, /[}\]]/g);
    sawBrace ||= openings > 0 || closings > 0;
    balance += direction === 'before' ? closings - openings : openings - closings;

    if (balance <= 0 && (
      isStandaloneStructure(structuralLine, isGraphql, isJson) ||
      (sawBrace && structureClosed(structuralLine, direction))
    )) {
      return includeAttachedLeadingLines(hiddenLines, index, count, direction);
    }

    if (count >= MAX_SMART_EXPANSION_LINES) {
      return count;
    }
  }

  return count;
}

export function getSyntaxExpansionLineCount(
  nodes: readonly GitReviewSyntaxNode[],
  direction: 'before' | 'after',
  boundaryLine: number,
  remainingLineCount: number
): number | undefined {
  if (nodes.length === 0 || remainingLineCount <= 0) {
    return undefined;
  }

  const candidate = direction === 'before'
    ? syntaxNodeBefore(nodes, boundaryLine)
    : syntaxNodeAfter(nodes, boundaryLine);

  if (!candidate) {
    return undefined;
  }

  const lineCount = direction === 'before'
    ? boundaryLine - candidate.startLine
    : candidate.endLine - boundaryLine + 1;

  return lineCount > 0 ? Math.min(lineCount, remainingLineCount) : undefined;
}

function syntaxNodeBefore(
  nodes: readonly GitReviewSyntaxNode[],
  boundaryLine: number
): GitReviewSyntaxNode | undefined {
  const containing = nodes
    .filter((node) => node.startLine < boundaryLine && node.endLine >= boundaryLine - 1)
    .sort((left, right) =>
      right.startLine - left.startLine ||
      left.endLine - right.endLine ||
      syntaxKindRank(left.kind) - syntaxKindRank(right.kind)
    )[0];

  if (containing) {
    return containing;
  }

  return nodes
    .filter((node) => node.endLine < boundaryLine)
    .sort((left, right) =>
      right.endLine - left.endLine ||
      right.startLine - left.startLine ||
      syntaxKindRank(left.kind) - syntaxKindRank(right.kind)
    )[0];
}

function syntaxNodeAfter(
  nodes: readonly GitReviewSyntaxNode[],
  boundaryLine: number
): GitReviewSyntaxNode | undefined {
  const containing = nodes
    .filter((node) => node.startLine <= boundaryLine && node.endLine >= boundaryLine)
    .sort((left, right) =>
      left.endLine - right.endLine ||
      right.startLine - left.startLine ||
      syntaxKindRank(left.kind) - syntaxKindRank(right.kind)
    )[0];

  if (containing) {
    return containing;
  }

  return nodes
    .filter((node) => node.startLine > boundaryLine)
    .sort((left, right) =>
      left.startLine - right.startLine ||
      left.endLine - right.endLine ||
      syntaxKindRank(left.kind) - syntaxKindRank(right.kind)
    )[0];
}

function syntaxKindRank(kind: GitReviewSyntaxNode['kind']): number {
  return kind === 'member' ? 0 : kind === 'block' ? 1 : 2;
}

function includeAttachedLeadingLines(
  lines: readonly string[],
  boundaryIndex: number,
  count: number,
  direction: 'before' | 'after'
): number {
  if (direction === 'after') {
    return count;
  }

  let index = boundaryIndex - 1;
  let nextCount = count;

  while (index >= 0 && /^\s*(?:@|\/\/|\/\*|\*|#)/.test(lines[index] ?? '')) {
    nextCount += 1;
    index -= 1;
  }

  return Math.min(nextCount, MAX_SMART_EXPANSION_LINES);
}

function isStandaloneStructure(line: string, isGraphql: boolean, isJson: boolean): boolean {
  if (isJson && /^\s*"(?:[^"\\]|\\.)+"\s*:/.test(line)) {
    return true;
  }

  if (isGraphql && /^\s*(?:\.\.\.|[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*(?::|{))/.test(line)) {
    return true;
  }

  return /^\s*(?:(?:export|default|declare|abstract|async|public|private|protected|static|readonly)\s+)*(?:class|interface|type|enum|function|const|let|var|namespace|module)\b/.test(line);
}

function structureClosed(line: string, direction: 'before' | 'after'): boolean {
  return direction === 'before' ? /[{[]/.test(line) : /[}\]]/.test(line);
}

function stripStringsAndLineComment(line: string): string {
  return line
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '')
    .replace(/\/\/.*$/, '');
}

function countCharacters(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}
