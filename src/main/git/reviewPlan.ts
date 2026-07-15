import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  GitFileDiff,
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewPlan,
  GitReviewTarget,
  GitReviewUnit,
  GitStatusCode
} from '@shared/types';

import {
  categorizeReviewPath,
  classifyReviewChangeType,
  classifyReviewContent
} from './reviewChunkClassification';
import {
  extractDeclarations,
  extractEnclosingDeclarationSymbols
} from './reviewCodeRelationships';
import {
  extractGraphqlSymbols,
  isGraphqlReviewPath
} from './reviewGraphqlRelationships';
import {
  collectSymbolAnchors,
  getSymbolAnchorIds,
  selectChunkSymbol
} from './reviewSymbolRelationships';

export type ReviewPatchInput = {
  path: string;
  originalPath?: string;
  status: GitStatusCode;
  source: GitReviewChunk['source'];
  diff: GitFileDiff;
  fileContext?: Pick<GitReviewFileContext, 'oldContents' | 'newContents'>;
};

type ParsedReviewChunk = Omit<GitReviewChunk, 'id' | 'role'> & {
  id: string;
  declarations: string[];
  enclosingSymbols: string[];
  graphqlSymbols: string[];
  identifiers: Set<string>;
  functionContext?: string;
};

type ReviewGroupMetadata = {
  symbol?: string;
  anchorIds?: ReadonlySet<string>;
  functionContext?: string;
  path?: string;
  kind?: 'translations';
};

const ignoredIdentifiers = new Set([
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'interface',
  'let',
  'new',
  'null',
  'number',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'static',
  'string',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

export function buildReviewPlan(
  repoPath: string,
  target: GitReviewTarget,
  patches: ReviewPatchInput[]
): GitReviewPlan {
  const chunks = patches.flatMap(parseReviewPatch);
  const units = groupReviewChunks(chunks);
  const fileContexts = patches.flatMap((patch): GitReviewFileContext[] => {
    if (!patch.fileContext) {
      return [];
    }

    return [{
      id: reviewFileContextId(patch.path, patch.source),
      path: patch.path,
      originalPath: patch.originalPath,
      source: patch.source,
      ...patch.fileContext
    }];
  });

  return {
    repoPath,
    target,
    targetKey: target.kind === 'commit' ? `commit:${target.sha}` : `wip:${target.scope}`,
    units,
    fileContexts,
    reviewedChunkIds: [],
    loadedAt: new Date().toISOString()
  };
}

function parseReviewPatch(input: ReviewPatchInput): ParsedReviewChunk[] {
  if (input.diff.omittedReason || !input.diff.patch.includes('@@')) {
    return [createOmittedChunk(input)];
  }

  const lines = splitPatchLines(input.diff.patch);
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));

  if (firstHunkIndex === -1) {
    return [createOmittedChunk(input)];
  }

  const fileHeader = lines.slice(0, firstHunkIndex);
  const chunks: ParsedReviewChunk[] = [];
  let hunkStart = firstHunkIndex;

  while (hunkStart < lines.length) {
    const hunkEnd = findNextHunkIndex(lines, hunkStart + 1);
    const hunkLines = lines.slice(hunkStart, hunkEnd);
    const header = hunkLines[0]?.trim() ?? '';
    const bodyLines = hunkLines.slice(1);
    const additions = bodyLines.filter(isAdditionLine).length;
    const deletions = bodyLines.filter(isDeletionLine).length;
    const changedText = bodyLines
      .filter((line) => isAdditionLine(line) || isDeletionLine(line))
      .map((line) => line.slice(1))
      .join('\n');
    const declarations = extractDeclarations(changedText);
    const enclosingSymbols = extractEnclosingDeclarationSymbols(bodyLines);
    const graphqlSymbols = isGraphqlReviewPath(input.path) ? extractGraphqlSymbols(changedText) : [];
    const identifiers = extractIdentifiers(changedText);
    const startLine = parseNewStartLine(header);
    const patch = ensureTrailingNewline([...fileHeader, ...hunkLines].join(''));
    const functionContext = parseFunctionContext(header);
    const boundaryContext = extractBoundaryContext(bodyLines);

    chunks.push({
      id: chunkId(input.path, input.source, functionContext ?? '', changedText, boundaryContext),
      path: input.path,
      originalPath: input.originalPath,
      fileContextId: input.fileContext ? reviewFileContextId(input.path, input.source) : undefined,
      patch,
      header,
      startLine,
      additions,
      deletions,
      category: categorizeReviewPath(input.path),
      changeType: classifyReviewChangeType(input.status, additions, deletions),
      contentKind: classifyReviewContent(bodyLines),
      source: input.source,
      declarations,
      enclosingSymbols,
      graphqlSymbols,
      identifiers,
      functionContext
    });

    hunkStart = hunkEnd;
  }

  return chunks;
}

function createOmittedChunk(input: ReviewPatchInput): ParsedReviewChunk {
  const omittedReason = input.diff.omittedReason ?? 'no-text';
  const label = omittedReason === 'binary' ? 'Binary change' : omittedReason === 'too-large' ? 'Large change' : 'Change without textual hunks';

  return {
    id: chunkId(input.path, input.source, label, omittedReason, ''),
    path: input.path,
    originalPath: input.originalPath,
    patch: '',
    header: label,
    startLine: 0,
    additions: 0,
    deletions: 0,
    category: categorizeReviewPath(input.path),
    changeType: input.status === 'deleted' ? 'deleted' : 'modified',
    contentKind: 'code',
    source: input.source,
    omittedReason,
    declarations: [],
    enclosingSymbols: [],
    graphqlSymbols: [],
    identifiers: new Set()
  };
}

function groupReviewChunks(chunks: ParsedReviewChunk[]): GitReviewUnit[] {
  const symbolAnchors = collectSymbolAnchors(chunks.filter((chunk) => !isTranslationReviewPath(chunk.path)));
  const chunksByGroup = new Map<string, ParsedReviewChunk[]>();
  const groupMetadata = new Map<string, ReviewGroupMetadata>();

  for (const chunk of chunks) {
    let key: string;

    if (isTranslationReviewPath(chunk.path)) {
      key = 'translations';
      groupMetadata.set(key, { kind: 'translations' });
    } else {
      const symbol = selectChunkSymbol(chunk, symbolAnchors);

      if (symbol) {
        key = `symbol:${symbol}`;
        groupMetadata.set(key, { symbol, anchorIds: getSymbolAnchorIds(symbolAnchors, symbol) });
      } else if (chunk.functionContext) {
        key = `context:${chunk.path}:${chunk.functionContext}`;
        groupMetadata.set(key, { functionContext: chunk.functionContext, path: chunk.path });
      } else {
        key = `file:${chunk.path}`;
        groupMetadata.set(key, { path: chunk.path });
      }
    }

    const grouped = chunksByGroup.get(key) ?? [];
    grouped.push(chunk);
    chunksByGroup.set(key, grouped);
  }

  return [...chunksByGroup.entries()]
    .map(([key, groupedChunks]) => createReviewUnit(key, groupedChunks, groupMetadata.get(key)))
    .sort(compareUnits);
}

function createReviewUnit(
  key: string,
  chunks: ParsedReviewChunk[],
  metadata: ReviewGroupMetadata | undefined
): GitReviewUnit {
  const orderedChunks = chunks
    .map((chunk): GitReviewChunk => ({
      ...withoutGroupingMetadata(chunk),
      role: metadata?.symbol
        ? metadata.anchorIds?.has(chunk.id) ||
          chunk.declarations.includes(metadata.symbol) ||
          chunk.enclosingSymbols.includes(metadata.symbol) ||
          chunk.graphqlSymbols.includes(metadata.symbol)
          ? 'anchor'
          : 'usage'
        : 'related'
    }))
    .sort(compareChunks);
  const fileCount = new Set(orderedChunks.map((chunk) => chunk.path)).size;
  const title = metadata?.kind === 'translations'
    ? 'Translations'
    : metadata?.symbol
    ? metadata.symbol
    : metadata?.functionContext
      ? metadata.functionContext
      : `Changes in ${path.basename(metadata?.path ?? orderedChunks[0]?.path ?? 'file')}`;
  const reason = metadata?.kind === 'translations'
    ? `${orderedChunks.length} change${orderedChunks.length === 1 ? '' : 's'} across ${fileCount} translation file${fileCount === 1 ? '' : 's'}`
    : metadata?.symbol
    ? `${orderedChunks.length} related change${orderedChunks.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}`
    : metadata?.functionContext
      ? `Changes grouped by surrounding code in ${path.basename(metadata.path ?? '')}`
      : `Changes grouped by file`;

  return {
    id: stableId(`${key}\0${orderedChunks.map((chunk) => chunk.id).join('\0')}`),
    title,
    reason,
    symbol: metadata?.symbol,
    chunks: orderedChunks
  };
}

function isTranslationReviewPath(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return basename === 'translation.json' || basename === 'translations.json';
}

function withoutGroupingMetadata(chunk: ParsedReviewChunk): Omit<GitReviewChunk, 'role'> {
  return {
    id: chunk.id,
    path: chunk.path,
    originalPath: chunk.originalPath,
    fileContextId: chunk.fileContextId,
    patch: chunk.patch,
    header: chunk.header,
    startLine: chunk.startLine,
    additions: chunk.additions,
    deletions: chunk.deletions,
    category: chunk.category,
    changeType: chunk.changeType,
    contentKind: chunk.contentKind,
    source: chunk.source,
    omittedReason: chunk.omittedReason
  };
}

function compareChunks(left: GitReviewChunk, right: GitReviewChunk): number {
  return (
    roleRank(left.role) - roleRank(right.role) ||
    categoryRank(left.category) - categoryRank(right.category) ||
    left.path.localeCompare(right.path) ||
    left.startLine - right.startLine ||
    left.source.localeCompare(right.source)
  );
}

function compareUnits(left: GitReviewUnit, right: GitReviewUnit): number {
  const leftFirst = left.chunks[0];
  const rightFirst = right.chunks[0];
  return (
    Number(Boolean(right.symbol)) - Number(Boolean(left.symbol)) ||
    (leftFirst?.path ?? '').localeCompare(rightFirst?.path ?? '') ||
    (leftFirst?.startLine ?? 0) - (rightFirst?.startLine ?? 0) ||
    left.title.localeCompare(right.title)
  );
}

function roleRank(role: GitReviewChunk['role']): number {
  return role === 'anchor' ? 0 : role === 'usage' ? 1 : 2;
}

function categoryRank(category: GitReviewChunk['category']): number {
  return category === 'source' ? 0 : category === 'test' ? 1 : 2;
}

function extractIdentifiers(value: string): Set<string> {
  const identifiers = new Set<string>();

  for (const match of value.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const identifier = match[0];

    if (identifier.length >= 3 && !ignoredIdentifiers.has(identifier)) {
      identifiers.add(identifier);
    }
  }

  return identifiers;
}

function parseNewStartLine(header: string): number {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(header);
  return Number.parseInt(match?.[1] ?? '0', 10);
}

function parseFunctionContext(header: string): string | undefined {
  const match = /^@@ .*? @@\s*(.+)$/.exec(header);
  const context = match?.[1]?.trim();
  return context || undefined;
}

function extractBoundaryContext(lines: string[]): string {
  const contextLines = lines.filter((line) => line.startsWith(' ')).map((line) => line.slice(1).trimEnd());
  return [...contextLines.slice(0, 2), ...contextLines.slice(-2)].join('\n');
}

function splitPatchLines(patch: string): string[] {
  const rawLines = patch.split('\n');
  return rawLines
    .map((line, index) => (index < rawLines.length - 1 ? `${line}\n` : line))
    .filter((line) => line.length > 0);
}

function findNextHunkIndex(lines: string[], startIndex: number): number {
  const nextIndex = lines.findIndex((line, index) => index >= startIndex && line.startsWith('@@'));
  return nextIndex === -1 ? lines.length : nextIndex;
}

function isAdditionLine(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++');
}

function isDeletionLine(line: string): boolean {
  return line.startsWith('-') && !line.startsWith('---');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function chunkId(
  filePath: string,
  source: GitReviewChunk['source'],
  section: string,
  changedText: string,
  boundaryContext: string
): string {
  return stableId(`${filePath}\0${source}\0${section}\0${changedText.trimEnd()}\0${boundaryContext}`);
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function reviewFileContextId(filePath: string, source: GitReviewChunk['source']): string {
  return stableId(`${source}\0${filePath}`);
}
