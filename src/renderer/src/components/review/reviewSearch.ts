import type {
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewPlan,
  GitReviewUnit
} from '@shared/types';

import type { VisibleReviewUnit } from './reviewFilters';

export type ReviewSearchScope = 'changed-lines' | 'full-files';
export type ReviewSearchInclusion = 'visible-blocks' | 'whole-review';

export type ReviewSearchLine = {
  number: number;
  text: string;
  isMatch: boolean;
  kind: 'addition' | 'deletion' | 'context';
};

export type ReviewSearchLocation = {
  id: string;
  startLine: number;
  endLine: number;
  lines: ReviewSearchLine[];
  kind: ReviewSearchLine['kind'];
};

export type ReviewSearchFileResult = {
  id: string;
  path: string;
  chunk: GitReviewChunk;
  ownerUnitId: string;
  ownerUnitTitle: string;
  relationship: string;
  source: GitReviewChunk['source'];
  isFiltered: boolean;
  usedChangedLinesFallback: boolean;
  locations: ReviewSearchLocation[];
};

export type ReviewSearchResults = {
  files: ReviewSearchFileResult[];
  locationCount: number;
  limitReached: boolean;
  fullFileFallbackCount: number;
};

type ReviewSearchCandidate = {
  chunk: GitReviewChunk;
  owner: GitReviewUnit;
  isVisible: boolean;
};

type SourceLine = {
  number: number;
  text: string;
  kind: ReviewSearchLine['kind'];
};

type SourceLineGroup = {
  kind: 'addition' | 'deletion';
  lines: SourceLine[];
};

type SearchLocationInput = {
  lines: SourceLine[];
  matchedIndexes: number[];
  kind: ReviewSearchLine['kind'];
};

const MAX_REVIEW_SEARCH_LOCATIONS = 200;
const SEARCH_CONTEXT_LINE_COUNT = 2;

export function createReviewSearchResults(
  plan: GitReviewPlan,
  visibleUnits: readonly VisibleReviewUnit[],
  query: string,
  scope: ReviewSearchScope,
  inclusion: ReviewSearchInclusion
): ReviewSearchResults {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return emptyResults();
  }

  const candidates = collectSearchCandidates(plan, visibleUnits, inclusion);

  return scope === 'full-files'
    ? searchFullChangedFiles(plan.fileContexts, candidates, normalizedQuery)
    : searchChangedLines(candidates, normalizedQuery);
}

export function normalizeReviewSearchSelection(value: string): string {
  return value.replace(/\r\n/g, '\n').trim().slice(0, 4_000);
}

export function readReviewSearchSelection(
  selection: Pick<Selection, 'isCollapsed' | 'toString'> | null | undefined
): string {
  return normalizeReviewSearchSelection(selection?.toString() ?? '');
}

function collectSearchCandidates(
  plan: GitReviewPlan,
  visibleUnits: readonly VisibleReviewUnit[],
  inclusion: ReviewSearchInclusion
): ReviewSearchCandidate[] {
  const visibleChunkIds = new Set(
    visibleUnits.flatMap((unit) => unit.visibleChunks.map((chunk) => chunk.id))
  );
  const ownerByChunkId = new Map<string, GitReviewUnit>();

  for (const unit of plan.units) {
    for (const chunk of unit.chunks) {
      ownerByChunkId.set(chunk.id, unit);
    }
  }

  const chunks = inclusion === 'whole-review'
    ? plan.units.flatMap((unit) => unit.chunks)
    : visibleUnits.flatMap((unit) => unit.visibleChunks);
  const seenChunkIds = new Set<string>();
  const candidates: ReviewSearchCandidate[] = [];

  for (const chunk of chunks) {
    if (seenChunkIds.has(chunk.id)) {
      continue;
    }

    const owner = ownerByChunkId.get(chunk.id);

    if (!owner) {
      continue;
    }

    seenChunkIds.add(chunk.id);
    candidates.push({
      chunk,
      owner,
      isVisible: visibleChunkIds.has(chunk.id)
    });
  }

  return candidates;
}

function searchChangedLines(
  candidates: readonly ReviewSearchCandidate[],
  normalizedQuery: string
): ReviewSearchResults {
  const results = new Map<string, ReviewSearchFileResult>();
  let locationCount = 0;

  for (const candidate of candidates) {
    for (const group of extractChangedLineGroups(candidate.chunk.patch)) {
      const remaining = MAX_REVIEW_SEARCH_LOCATIONS - locationCount;

      if (remaining <= 0) {
        return finalizeResults(results, true, 0);
      }

      const locations = findSearchLocations(group.lines, normalizedQuery, remaining);

      if (locations.length === 0) {
        continue;
      }

      appendFileLocations(results, candidate, locations, false);
      locationCount += locations.length;
    }
  }

  return finalizeResults(results, false, 0);
}

function searchFullChangedFiles(
  fileContexts: readonly GitReviewFileContext[],
  candidates: readonly ReviewSearchCandidate[],
  normalizedQuery: string
): ReviewSearchResults {
  const contextsById = new Map(fileContexts.map((context) => [context.id, context]));
  const candidatesByFile = groupCandidatesByFile(candidates);
  const results = new Map<string, ReviewSearchFileResult>();
  let locationCount = 0;
  let fullFileFallbackCount = 0;

  for (const fileCandidates of candidatesByFile.values()) {
    const preferredCandidate =
      fileCandidates.find((candidate) => candidate.isVisible) ??
      fileCandidates[0];

    if (!preferredCandidate) {
      continue;
    }

    const contextId = fileCandidates
      .map((candidate) => candidate.chunk.fileContextId)
      .find((id): id is string => Boolean(id));
    const context = contextId ? contextsById.get(contextId) : undefined;

    if (!context) {
      fullFileFallbackCount += 1;

      for (const candidate of fileCandidates) {
        for (const group of extractChangedLineGroups(candidate.chunk.patch)) {
          const remaining = MAX_REVIEW_SEARCH_LOCATIONS - locationCount;

          if (remaining <= 0) {
            return finalizeResults(results, true, fullFileFallbackCount);
          }

          const locations = findSearchLocations(group.lines, normalizedQuery, remaining);
          appendFileLocations(results, candidate, locations, true);
          locationCount += locations.length;
        }
      }

      continue;
    }

    const isDeletedFile = fileCandidates.every(
      (candidate) => candidate.chunk.changeType === 'deleted'
    );
    const primaryContents = isDeletedFile ? context.oldContents : context.newContents;
    const primaryKind: ReviewSearchLine['kind'] = isDeletedFile ? 'deletion' : 'context';
    const primaryLines = sourceLinesFromContents(primaryContents, primaryKind);
    const remaining = MAX_REVIEW_SEARCH_LOCATIONS - locationCount;

    if (remaining <= 0) {
      return finalizeResults(results, true, fullFileFallbackCount);
    }

    const primaryLocations = findSearchLocations(primaryLines, normalizedQuery, remaining);
    appendFileLocations(results, preferredCandidate, primaryLocations, false);
    locationCount += primaryLocations.length;

    if (isDeletedFile) {
      continue;
    }

    for (const candidate of fileCandidates) {
      for (const group of extractChangedLineGroups(candidate.chunk.patch)) {
        if (group.kind !== 'deletion') {
          continue;
        }

        const deletionRemaining = MAX_REVIEW_SEARCH_LOCATIONS - locationCount;

        if (deletionRemaining <= 0) {
          return finalizeResults(results, true, fullFileFallbackCount);
        }

        const deletedLocations = findSearchLocations(
          group.lines,
          normalizedQuery,
          deletionRemaining
        );
        appendFileLocations(results, candidate, deletedLocations, false);
        locationCount += deletedLocations.length;
      }
    }
  }

  return finalizeResults(results, false, fullFileFallbackCount);
}

function groupCandidatesByFile(
  candidates: readonly ReviewSearchCandidate[]
): Map<string, ReviewSearchCandidate[]> {
  const grouped = new Map<string, ReviewSearchCandidate[]>();

  for (const candidate of candidates) {
    const key = `${candidate.chunk.source}:${candidate.chunk.path}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.push(candidate);
    } else {
      grouped.set(key, [candidate]);
    }
  }

  return grouped;
}

function appendFileLocations(
  results: Map<string, ReviewSearchFileResult>,
  candidate: ReviewSearchCandidate,
  locations: readonly ReviewSearchLocation[],
  usedChangedLinesFallback: boolean
): void {
  if (locations.length === 0) {
    return;
  }

  const key = `${candidate.chunk.source}:${candidate.chunk.path}:${candidate.chunk.id}`;
  const existing = results.get(key);

  if (existing) {
    existing.locations.push(...locations);
    existing.isFiltered &&= !candidate.isVisible;
    existing.usedChangedLinesFallback ||= usedChangedLinesFallback;
    return;
  }

  results.set(key, {
    id: key,
    path: candidate.chunk.path,
    chunk: candidate.chunk,
    ownerUnitId: candidate.owner.id,
    ownerUnitTitle: candidate.owner.title,
    relationship: candidate.chunk.relationship,
    source: candidate.chunk.source,
    isFiltered: !candidate.isVisible,
    usedChangedLinesFallback,
    locations: [...locations]
  });
}

function findSearchLocations(
  lines: readonly SourceLine[],
  normalizedQuery: string,
  limit: number
): ReviewSearchLocation[] {
  if (lines.length === 0 || limit <= 0) {
    return [];
  }

  const queryLineCount = Math.max(normalizedQuery.split('\n').length, 1);
  const windowLineCount = Math.min(queryLineCount, lines.length);
  const locations: ReviewSearchLocation[] = [];
  const seenRanges = new Set<string>();

  for (let startIndex = 0; startIndex < lines.length && locations.length < limit; startIndex += 1) {
    const endIndex = Math.min(startIndex + windowLineCount, lines.length);
    const windowLines = lines.slice(startIndex, endIndex);
    const normalizedWindow = normalizeSearchValue(windowLines.map((line) => line.text).join('\n'));

    if (!normalizedWindow.includes(normalizedQuery)) {
      continue;
    }

    const matchedIndexes = windowLines.map((_line, index) => startIndex + index);
    const rangeKey = `${matchedIndexes[0]}:${matchedIndexes.at(-1)}`;

    if (seenRanges.has(rangeKey)) {
      continue;
    }

    seenRanges.add(rangeKey);
    locations.push(createSearchLocation({
      lines: [...lines],
      matchedIndexes,
      kind: windowLines[0]?.kind ?? 'context'
    }, locations.length));

    if (queryLineCount > 1) {
      startIndex += Math.max(queryLineCount - 1, 0);
    }
  }

  return locations;
}

function createSearchLocation(
  input: SearchLocationInput,
  occurrenceIndex: number
): ReviewSearchLocation {
  const firstMatchedIndex = input.matchedIndexes[0] ?? 0;
  const lastMatchedIndex = input.matchedIndexes.at(-1) ?? firstMatchedIndex;
  const sliceStart = Math.max(firstMatchedIndex - SEARCH_CONTEXT_LINE_COUNT, 0);
  const sliceEnd = Math.min(
    lastMatchedIndex + SEARCH_CONTEXT_LINE_COUNT + 1,
    input.lines.length
  );
  const matchedIndexes = new Set(input.matchedIndexes);
  const lines = input.lines.slice(sliceStart, sliceEnd).map((line, index) => ({
    ...line,
    isMatch: matchedIndexes.has(sliceStart + index)
  }));
  const startLine = lines[0]?.number ?? 1;
  const endLine = lines.at(-1)?.number ?? startLine;

  return {
    id: `${input.kind}:${startLine}:${endLine}:${occurrenceIndex}`,
    startLine,
    endLine,
    lines,
    kind: input.kind
  };
}

function extractChangedLineGroups(patch: string): SourceLineGroup[] {
  const groups: SourceLineGroup[] = [];
  let currentGroup: SourceLineGroup | undefined;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  function flushGroup(): void {
    if (currentGroup?.lines.length) {
      groups.push(currentGroup);
    }
    currentGroup = undefined;
  }

  for (const line of patch.split(/\r?\n/)) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);

    if (header) {
      flushGroup();
      oldLineNumber = Number.parseInt(header[1] ?? '0', 10);
      newLineNumber = Number.parseInt(header[2] ?? '0', 10);
      continue;
    }

    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git ')) {
      continue;
    }

    if (line.startsWith('+')) {
      if (currentGroup?.kind !== 'addition') {
        flushGroup();
        currentGroup = { kind: 'addition', lines: [] };
      }
      currentGroup.lines.push({
        number: newLineNumber,
        text: line.slice(1),
        kind: 'addition'
      });
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith('-')) {
      if (currentGroup?.kind !== 'deletion') {
        flushGroup();
        currentGroup = { kind: 'deletion', lines: [] };
      }
      currentGroup.lines.push({
        number: oldLineNumber,
        text: line.slice(1),
        kind: 'deletion'
      });
      oldLineNumber += 1;
      continue;
    }

    flushGroup();

    if (!line.startsWith('\\')) {
      oldLineNumber += 1;
      newLineNumber += 1;
    }
  }

  flushGroup();
  return groups;
}

function sourceLinesFromContents(
  contents: string,
  kind: ReviewSearchLine['kind']
): SourceLine[] {
  return contents.split(/\r?\n/).map((text, index) => ({
    number: index + 1,
    text,
    kind
  }));
}

function normalizeSearchValue(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .join('\n')
    .trim()
    .toLocaleLowerCase();
}

function finalizeResults(
  results: ReadonlyMap<string, ReviewSearchFileResult>,
  limitReached: boolean,
  fullFileFallbackCount: number
): ReviewSearchResults {
  const files = [...results.values()];

  return {
    files,
    locationCount: files.reduce((count, file) => count + file.locations.length, 0),
    limitReached,
    fullFileFallbackCount
  };
}

function emptyResults(): ReviewSearchResults {
  return {
    files: [],
    locationCount: 0,
    limitReached: false,
    fullFileFallbackCount: 0
  };
}
