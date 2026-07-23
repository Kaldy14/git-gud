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
  extractGraphqlOwnerAtLine,
  extractGraphqlReviewFacts,
  isGraphqlReviewPath
} from './reviewGraphqlRelationships';
import {
  collectSymbolAnchors,
  selectChunkReviewGroup,
  type ReviewGroupSelection
} from './reviewSymbolRelationships';
import {
  extractReviewIdentifiers,
  extractReviewPathConcepts,
  extractReviewRenameCandidates,
  isGeneratedReviewPath,
  type ReviewRenameCandidate
} from './reviewRelationshipFacts';
import {
  clusterReviewStories,
  createReviewStoryTitle,
  type ReviewStoryGroup
} from './reviewStoryClusters';
import {
  reviewStructureContextName,
  reviewStructureEnclosingSymbols,
  type ReviewPatchSyntax,
  type ReviewSyntaxIdentifier
} from './reviewStructure';

export type ReviewPatchInput = {
  path: string;
  originalPath?: string;
  status: GitStatusCode;
  source: GitReviewChunk['source'];
  diff: GitFileDiff;
  fileContext?: Pick<GitReviewFileContext, 'oldContents' | 'newContents'>;
  syntax?: ReviewPatchSyntax;
};

type ParsedReviewChunk = Omit<GitReviewChunk, 'id' | 'role' | 'relationship' | 'reviewSection'> & {
  id: string;
  declarations: string[];
  enclosingSymbols: string[];
  graphqlSymbols: string[];
  graphqlQualifiedSymbols: string[];
  syntaxQualifiedSymbols: string[];
  syntaxIdentifiers: ReviewSyntaxIdentifier[];
  identifiers: Set<string>;
  renameCandidates: ReviewRenameCandidate[];
  structuralFingerprints: string[];
  pathConcepts: Set<string>;
  generated: boolean;
  functionContext?: string;
};

type ReviewGroupMetadata = {
  symbol?: string;
  title?: string;
  explanation?: string;
  confidence?: GitReviewUnit['confidence'];
  contextCount?: number;
  functionContext?: string;
  path?: string;
  kind?: 'translations';
};

export function buildReviewPlan(
  repoPath: string,
  target: GitReviewTarget,
  patches: ReviewPatchInput[]
): GitReviewPlan {
  const chunks = patches.flatMap(parseReviewPatch);
  const units = groupReviewChunks(chunks);
  assertCanonicalChunkOwnership(chunks, units);
  const fileContexts = patches.flatMap((patch): GitReviewFileContext[] => {
    if (!patch.fileContext) {
      return [];
    }

    return [{
      id: reviewFileContextId(patch.path, patch.source),
      path: patch.path,
      originalPath: patch.originalPath,
      source: patch.source,
      ...patch.fileContext,
      syntax: patch.syntax
        ? {
            language: patch.syntax.language,
            oldNodes: patch.syntax.oldNodes,
            newNodes: patch.syntax.newNodes,
            hasErrors: patch.syntax.hasErrors
          }
        : undefined
    }];
  });

  return {
    repoPath,
    target,
    targetKey:
      target.kind === 'commit'
        ? `commit:${target.sha}`
        : target.kind === 'branch'
          ? `branch:${target.name}`
          : `wip:${target.scope}`,
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
  const chunkIdOccurrences = new Map<string, number>();
  let hunkStart = firstHunkIndex;
  let hunkOrdinal = 0;

  while (hunkStart < lines.length) {
    const hunkEnd = findNextHunkIndex(lines, hunkStart + 1);
    const hunkLines = lines.slice(hunkStart, hunkEnd);
    const header = hunkLines[0]?.trim() ?? '';
    const bodyLines = hunkLines.slice(1);
    const additions = bodyLines.filter(isAdditionLine).length;
    const deletions = bodyLines.filter(isDeletionLine).length;
    const addedText = changedLineText(bodyLines, isAdditionLine);
    const deletedText = changedLineText(bodyLines, isDeletionLine);
    const changedText = [deletedText, addedText].filter(Boolean).join('\n');
    const syntaxHunk = input.syntax?.hunks[hunkOrdinal];
    const trustedSyntax = Boolean(syntaxHunk && !syntaxHunk.hasErrors);
    const syntaxFacts = [
      ...(syntaxHunk?.oldIdentifiers ?? []),
      ...(syntaxHunk?.newIdentifiers ?? [])
    ];
    const declarations = trustedSyntax
      ? [...new Set(syntaxFacts
          .filter((fact) => fact.role === 'declaration')
          .map((fact) => fact.name))]
      : extractDeclarations(changedText);
    const syntaxQualifiedSymbols = trustedSyntax
      ? [...new Set(syntaxFacts
          .filter((fact) =>
            fact.qualifiedName && (fact.role === 'declaration' || fact.role === 'member')
          )
          .map((fact) => fact.qualifiedName!))]
      : [];
    const syntaxIdentifiers = trustedSyntax ? syntaxFacts : [];
    const enclosingSymbols = [
      ...new Set([
        ...extractEnclosingDeclarationSymbols(bodyLines),
        ...(trustedSyntax ? reviewStructureEnclosingSymbols(syntaxHunk) : [])
      ])
    ];
    const functionContext = parseFunctionContext(header) ??
      (trustedSyntax ? reviewStructureContextName(syntaxHunk) : undefined);
    const oldStartLine = parseOldStartLine(header);
    const startLine = parseNewStartLine(header);
    const graphqlOwnerContext = input.fileContext && isGraphqlReviewPath(input.path)
      ? {
          oldOwner: extractGraphqlOwnerAtLine(input.fileContext.oldContents, oldStartLine),
          newOwner: extractGraphqlOwnerAtLine(input.fileContext.newContents, startLine)
        }
      : undefined;
    const graphqlFacts = isGraphqlReviewPath(input.path)
      ? extractGraphqlReviewFacts(bodyLines, functionContext, graphqlOwnerContext)
      : { symbols: [], qualifiedSymbols: [] };
    const addedIdentifiers = trustedSyntax
      ? new Set(syntaxHunk!.newIdentifiers.map((fact) => fact.name))
      : extractReviewIdentifiers(addedText);
    const deletedIdentifiers = trustedSyntax
      ? new Set(syntaxHunk!.oldIdentifiers.map((fact) => fact.name))
      : extractReviewIdentifiers(deletedText);
    const identifiers = new Set([...addedIdentifiers, ...deletedIdentifiers]);
    const generated = isGeneratedReviewPath(input.path);
    const patch = ensureTrailingNewline([...fileHeader, ...hunkLines].join(''));
    const boundaryContext = extractBoundaryContext(bodyLines);

    const baseId = chunkId(input.path, input.source, functionContext ?? '', changedText, boundaryContext);

    chunks.push({
      id: uniqueChunkId(baseId, chunkIdOccurrences),
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
      graphqlSymbols: graphqlFacts.symbols,
      graphqlQualifiedSymbols: graphqlFacts.qualifiedSymbols,
      syntaxQualifiedSymbols,
      syntaxIdentifiers,
      identifiers,
      renameCandidates: generated
        ? []
        : extractReviewRenameCandidates(deletedIdentifiers, addedIdentifiers),
      structuralFingerprints: trustedSyntax ? syntaxHunk!.structuralFingerprints : [],
      pathConcepts: extractReviewPathConcepts(input.path),
      generated,
      functionContext
    });

    hunkStart = hunkEnd;
    hunkOrdinal += 1;
  }

  return chunks;
}

function uniqueChunkId(baseId: string, occurrences: Map<string, number>): string {
  const occurrence = occurrences.get(baseId) ?? 0;
  occurrences.set(baseId, occurrence + 1);
  return occurrence === 0 ? baseId : stableId(`${baseId}\0duplicate:${occurrence}`);
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
    graphqlQualifiedSymbols: [],
    syntaxQualifiedSymbols: [],
    syntaxIdentifiers: [],
    identifiers: new Set(),
    renameCandidates: [],
    structuralFingerprints: [],
    pathConcepts: extractReviewPathConcepts(input.path),
    generated: isGeneratedReviewPath(input.path)
  };
}

function groupReviewChunks(chunks: ParsedReviewChunk[]): GitReviewUnit[] {
  const symbolAnchors = collectSymbolAnchors(chunks.filter((chunk) => !isTranslationReviewPath(chunk.path)));
  const chunksByGroup = new Map<string, ParsedReviewChunk[]>();
  const groupMetadata = new Map<string, ReviewGroupMetadata>();
  const selectionsByChunkId = new Map<string, ReviewGroupSelection>();
  const contextTitlesByChunkId = new Map<string, string>();

  for (const chunk of chunks) {
    let key: string;

    if (isTranslationReviewPath(chunk.path)) {
      key = 'translations';
      groupMetadata.set(key, { kind: 'translations' });
      contextTitlesByChunkId.set(chunk.id, 'Translations');
    } else {
      const selection = selectChunkReviewGroup(chunk, symbolAnchors);

      if (selection) {
        key = selection.group.key;
        selectionsByChunkId.set(chunk.id, selection);
        contextTitlesByChunkId.set(chunk.id, selection.group.title);
        groupMetadata.set(key, {
          symbol: selection.group.symbol,
          title: selection.group.title,
          explanation: selection.group.explanation,
          confidence: selection.group.confidence
        });
      } else {
        key = `file:${chunk.path}`;
        groupMetadata.set(key, { path: chunk.path });
        contextTitlesByChunkId.set(
          chunk.id,
          chunk.functionContext ?? `Changes in ${path.basename(chunk.path)}`
        );
      }
    }

    const grouped = chunksByGroup.get(key) ?? [];
    grouped.push(chunk);
    chunksByGroup.set(key, grouped);
  }

  const initialGroups = [...chunksByGroup.entries()].map(([key, groupedChunks]) =>
    createStoryGroup(key, groupedChunks, groupMetadata.get(key))
  );
  const initialGroupsByKey = new Map(initialGroups.map((group) => [group.key, group]));

  return clusterReviewStories(initialGroups)
    .map((cluster) => {
      const storyGroups = cluster.groupKeys.map((key) => initialGroupsByKey.get(key)!);
      const groupedChunks = storyGroups.flatMap((group) => group.chunks) as ParsedReviewChunk[];
      const metadata = createStoryMetadata(storyGroups, groupMetadata);

      return createReviewUnit(
        cluster.key,
        groupedChunks,
        metadata,
        selectionsByChunkId,
        contextTitlesByChunkId
      );
    })
    .sort(compareUnits);
}

function assertCanonicalChunkOwnership(chunks: ParsedReviewChunk[], units: GitReviewUnit[]): void {
  const expectedIds = chunks.map((chunk) => chunk.id);
  const ownedIds = units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id));
  const ownershipCounts = new Map<string, number>();

  for (const id of ownedIds) {
    ownershipCounts.set(id, (ownershipCounts.get(id) ?? 0) + 1);
  }

  if (
    new Set(expectedIds).size !== expectedIds.length ||
    ownedIds.length !== expectedIds.length ||
    expectedIds.some((id) => ownershipCounts.get(id) !== 1)
  ) {
    throw new Error('Context review invariant failed: every changed hunk must have exactly one canonical owner.');
  }
}

function createStoryGroup(
  key: string,
  chunks: ParsedReviewChunk[],
  metadata: ReviewGroupMetadata | undefined
): ReviewStoryGroup {
  return {
    key,
    kind: metadata?.kind === 'translations'
      ? 'translations'
      : metadata?.symbol
        ? 'relationship'
        : 'file',
    symbols: [metadata?.symbol, ...splitRenameTitle(metadata?.title)].filter((value): value is string => Boolean(value)),
    chunks
  };
}

function createStoryMetadata(
  storyGroups: ReviewStoryGroup[],
  metadataByKey: ReadonlyMap<string, ReviewGroupMetadata>
): ReviewGroupMetadata | undefined {
  if (storyGroups.length === 1) {
    return metadataByKey.get(storyGroups[0]!.key);
  }

  const primary = storyGroups
    .map((group) => ({ group, metadata: metadataByKey.get(group.key) }))
    .sort((left, right) =>
      confidenceRank(left.metadata?.confidence ?? 'context') - confidenceRank(right.metadata?.confidence ?? 'context') ||
      right.group.chunks.length - left.group.chunks.length ||
      left.group.key.localeCompare(right.group.key)
    )[0];
  const fallbackTitle = primary?.metadata?.title ?? `Changes in ${path.basename(primary?.metadata?.path ?? 'related files')}`;

  return {
    title: createReviewStoryTitle(storyGroups, fallbackTitle),
    explanation: `${storyGroups.length} related contexts combined by shared changed files and symbols`,
    confidence: storyGroups.every((group) => group.kind === 'relationship') ? 'strong' : 'context',
    contextCount: storyGroups.length
  };
}

function splitRenameTitle(title: string | undefined): string[] {
  return title?.includes(' → ') ? title.split(' → ') : [];
}

function createReviewUnit(
  key: string,
  chunks: ParsedReviewChunk[],
  metadata: ReviewGroupMetadata | undefined,
  selectionsByChunkId: ReadonlyMap<string, ReviewGroupSelection>,
  contextTitlesByChunkId: ReadonlyMap<string, string>
): GitReviewUnit {
  const orderedChunks = chunks
    .map((chunk): GitReviewChunk => {
      const selection = selectionsByChunkId.get(chunk.id);
      const role = selection?.role ?? syntaxReviewRole(chunk);

      return {
        ...withoutGroupingMetadata(chunk),
        role,
        relationship: selection?.relationship ?? fallbackChunkRelationship(metadata),
        reviewContext: contextTitlesByChunkId.get(chunk.id),
        reviewSection: classifyReviewSection(chunk, role, metadata)
      };
    })
    .sort(compareChunks);
  const fileCount = new Set(orderedChunks.map((chunk) => chunk.path)).size;
  const title = metadata?.kind === 'translations'
    ? 'Translations'
    : metadata?.title
    ? metadata.title
    : metadata?.functionContext
      ? metadata.functionContext
      : `Changes in ${path.basename(metadata?.path ?? orderedChunks[0]?.path ?? 'file')}`;
  const reason = metadata?.kind === 'translations'
    ? `${orderedChunks.length} change${orderedChunks.length === 1 ? '' : 's'} across ${fileCount} translation file${fileCount === 1 ? '' : 's'}`
    : metadata?.contextCount
      ? `${orderedChunks.length} related change${orderedChunks.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'} · ${metadata.contextCount} contexts`
    : metadata?.symbol
    ? `${orderedChunks.length} related change${orderedChunks.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}`
    : metadata?.functionContext
      ? `Changes grouped by surrounding code in ${path.basename(metadata.path ?? '')}`
      : `Changes grouped by file`;

  return {
    id: stableId(`review-unit-v2\0${key}`),
    title,
    reason,
    explanation: metadata?.kind === 'translations'
      ? 'Translation resources reviewed as one change'
      : metadata?.explanation ?? (metadata?.functionContext
        ? 'Shared surrounding code'
        : 'Same changed file'),
    confidence: metadata?.confidence ?? (metadata?.kind === 'translations' ? 'exact' : 'context'),
    symbol: metadata?.symbol,
    chunks: orderedChunks
  };
}

function isTranslationReviewPath(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return basename === 'translation.json' || basename === 'translations.json';
}

function withoutGroupingMetadata(
  chunk: ParsedReviewChunk
): Omit<GitReviewChunk, 'role' | 'relationship' | 'reviewSection'> {
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
    reviewSectionRank(left.reviewSection) - reviewSectionRank(right.reviewSection) ||
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
    reviewSectionRank(leftFirst?.reviewSection ?? 'other') - reviewSectionRank(rightFirst?.reviewSection ?? 'other') ||
    confidenceRank(left.confidence) - confidenceRank(right.confidence) ||
    (leftFirst?.path ?? '').localeCompare(rightFirst?.path ?? '') ||
    (leftFirst?.startLine ?? 0) - (rightFirst?.startLine ?? 0) ||
    left.title.localeCompare(right.title)
  );
}

function roleRank(role: GitReviewChunk['role']): number {
  return role === 'anchor' ? 0 : role === 'usage' ? 1 : 2;
}

function syntaxReviewRole(chunk: ParsedReviewChunk): GitReviewChunk['role'] {
  if (chunk.generated) {
    return 'related';
  }

  if (chunk.syntaxIdentifiers.some((identifier) =>
    identifier.role === 'declaration' || identifier.role === 'member'
  )) {
    return 'anchor';
  }

  return chunk.syntaxIdentifiers.length > 0 ? 'usage' : 'related';
}

function categoryRank(category: GitReviewChunk['category']): number {
  return category === 'source' ? 0 : category === 'test' ? 1 : 2;
}

function reviewSectionRank(section: GitReviewChunk['reviewSection']): number {
  return section === 'storage'
    ? 0
    : section === 'definition'
      ? 1
      : section === 'api'
        ? 2
        : section === 'generated'
          ? 3
          : section === 'implementation'
            ? 4
            : section === 'tests'
              ? 5
              : section === 'translations'
                ? 6
                : 7;
}

function confidenceRank(confidence: GitReviewUnit['confidence']): number {
  return confidence === 'exact' ? 0 : confidence === 'strong' ? 1 : 2;
}

function classifyReviewSection(
  chunk: ParsedReviewChunk,
  role: GitReviewChunk['role'],
  metadata: ReviewGroupMetadata | undefined
): GitReviewChunk['reviewSection'] {
  const normalizedPath = chunk.path.replace(/\\/g, '/').toLowerCase();

  if (metadata?.kind === 'translations') {
    return 'translations';
  }

  if (chunk.category === 'test' || chunk.category === 'spec') {
    return 'tests';
  }

  if (chunk.generated) {
    return 'generated';
  }

  if (
    normalizedPath.endsWith('.sql') ||
    normalizedPath.includes('/migrations/') ||
    normalizedPath.includes('/database/') ||
    normalizedPath.includes('/drizzle/schema/')
  ) {
    return 'storage';
  }

  if (isGraphqlReviewPath(chunk.path)) {
    return 'api';
  }

  if (role === 'anchor') {
    return 'definition';
  }

  return role === 'usage' ? 'implementation' : 'other';
}

function fallbackChunkRelationship(metadata: ReviewGroupMetadata | undefined): string {
  return metadata?.kind === 'translations'
    ? 'Translation resource'
    : metadata?.functionContext
      ? 'Same surrounding code'
      : 'Same changed file';
}

function changedLineText(
  lines: string[],
  predicate: (line: string) => boolean
): string {
  return lines.filter(predicate).map((line) => line.slice(1)).join('\n');
}

function parseNewStartLine(header: string): number {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(header);
  return Number.parseInt(match?.[1] ?? '0', 10);
}

function parseOldStartLine(header: string): number {
  const match = /^@@ -(\d+)/.exec(header);
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
