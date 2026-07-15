import type { GitReviewChunk, GitReviewPlan, GitReviewUnit } from '@shared/types';

export type ReviewPreferences = {
  skipTests: boolean;
  skipImports: boolean;
  skipDeletions: boolean;
  skipFilePatterns: boolean;
  filePatterns: string[];
};

export type VisibleReviewUnit = {
  unit: GitReviewUnit;
  visibleChunks: GitReviewChunk[];
  skippedCount: number;
  isViewed: boolean;
};

export type ReviewPresentation = {
  units: VisibleReviewUnit[];
  totalCount: number;
  viewedCount: number;
  skippedCount: number;
  pendingCount: number;
};

export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  skipTests: true,
  skipImports: false,
  skipDeletions: false,
  skipFilePatterns: false,
  filePatterns: []
};

const LEGACY_REVIEW_PREFERENCES_STORAGE_KEY = 'git-gud:review-preferences:v1';
const REVIEW_PREFERENCES_STORAGE_PREFIX = 'git-gud:review-preferences:v2:';
const MAX_REVIEW_FILE_PATTERNS = 100;

export function createReviewPresentation(
  plan: GitReviewPlan,
  preferences: ReviewPreferences,
  reviewedChunkIds: ReadonlySet<string>
): ReviewPresentation {
  let viewedCount = 0;
  let skippedCount = 0;
  let pendingCount = 0;
  let totalCount = 0;
  const units: VisibleReviewUnit[] = [];
  const filePatternMatchers = preferences.skipFilePatterns
    ? preferences.filePatterns.map(compileReviewFilePattern).filter((matcher) => matcher !== undefined)
    : [];

  for (const unit of plan.units) {
    const visibleChunks: GitReviewChunk[] = [];
    let unitSkippedCount = 0;

    for (const chunk of unit.chunks) {
      totalCount += 1;

      if (isChunkSkipped(chunk, preferences, filePatternMatchers)) {
        skippedCount += 1;
        unitSkippedCount += 1;
        continue;
      }

      visibleChunks.push(chunk);

      if (reviewedChunkIds.has(chunk.id)) {
        viewedCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    if (visibleChunks.length > 0) {
      units.push({
        unit,
        visibleChunks,
        skippedCount: unitSkippedCount,
        isViewed: visibleChunks.every((chunk) => reviewedChunkIds.has(chunk.id))
      });
    }
  }

  return {
    units,
    totalCount,
    viewedCount,
    skippedCount,
    pendingCount
  };
}

export function loadReviewPreferences(
  storage: Pick<Storage, 'getItem'>,
  repoPath: string
): ReviewPreferences {
  try {
    const raw =
      storage.getItem(reviewPreferencesStorageKey(repoPath)) ??
      storage.getItem(LEGACY_REVIEW_PREFERENCES_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_REVIEW_PREFERENCES;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return DEFAULT_REVIEW_PREFERENCES;
    }

    const filePatterns = Array.isArray(parsed.filePatterns)
      ? normalizeStoredReviewPatterns(parsed.filePatterns)
      : DEFAULT_REVIEW_PREFERENCES.filePatterns;

    return {
      skipTests: typeof parsed.skipTests === 'boolean' ? parsed.skipTests : DEFAULT_REVIEW_PREFERENCES.skipTests,
      skipImports:
        typeof parsed.skipImports === 'boolean'
          ? parsed.skipImports
          : DEFAULT_REVIEW_PREFERENCES.skipImports,
      skipDeletions:
        typeof parsed.skipDeletions === 'boolean'
          ? parsed.skipDeletions
          : DEFAULT_REVIEW_PREFERENCES.skipDeletions,
      skipFilePatterns:
        typeof parsed.skipFilePatterns === 'boolean'
          ? parsed.skipFilePatterns && filePatterns.length > 0
          : DEFAULT_REVIEW_PREFERENCES.skipFilePatterns,
      filePatterns
    };
  } catch {
    return DEFAULT_REVIEW_PREFERENCES;
  }
}

export function saveReviewPreferences(
  storage: Pick<Storage, 'setItem'>,
  repoPath: string,
  preferences: ReviewPreferences
): void {
  storage.setItem(reviewPreferencesStorageKey(repoPath), JSON.stringify(preferences));
}

export function parseReviewFilePatterns(value: string): string[] {
  const patterns = new Set<string>();

  for (const line of value.split(/\r?\n/)) {
    const pattern = normalizeReviewFilePattern(line);

    if (!pattern || pattern.startsWith('#')) {
      continue;
    }

    patterns.add(pattern);

    if (patterns.size === MAX_REVIEW_FILE_PATTERNS) {
      break;
    }
  }

  return [...patterns];
}

export function matchesReviewFilePattern(path: string, patterns: readonly string[]): boolean {
  const normalizedPath = normalizeReviewPath(path);
  return patterns.some((pattern) => compileReviewFilePattern(pattern)?.test(normalizedPath) ?? false);
}

function isChunkSkipped(
  chunk: GitReviewChunk,
  preferences: ReviewPreferences,
  filePatternMatchers: readonly RegExp[]
): boolean {
  if (preferences.skipTests && (chunk.category === 'test' || chunk.category === 'spec')) {
    return true;
  }

  if (preferences.skipImports && chunk.contentKind === 'imports') {
    return true;
  }

  if (preferences.skipDeletions && chunk.changeType === 'deleted') {
    return true;
  }

  return filePatternMatchers.some((matcher) => matcher.test(normalizeReviewPath(chunk.path)));
}

function reviewPreferencesStorageKey(repoPath: string): string {
  return `${REVIEW_PREFERENCES_STORAGE_PREFIX}${encodeURIComponent(repoPath)}`;
}

function normalizeStoredReviewPatterns(values: unknown[]): string[] {
  return parseReviewFilePatterns(values.filter((value): value is string => typeof value === 'string').join('\n'));
}

function normalizeReviewFilePattern(value: string): string {
  let pattern = normalizeReviewPath(value.trim()).replace(/^\.\//, '').replace(/^\/+/, '');

  if (pattern.endsWith('/')) {
    pattern += '**';
  }

  return pattern;
}

function normalizeReviewPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function compileReviewFilePattern(value: string): RegExp | undefined {
  const pattern = normalizeReviewFilePattern(value);

  if (!pattern || pattern.startsWith('#')) {
    return undefined;
  }

  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExpCharacter(character);
    }
  }

  return pattern.includes('/')
    ? new RegExp(`^${source}$`)
    : new RegExp(`(?:^|/)${source}(?:$|/)`);
}

function escapeRegExpCharacter(character: string): string {
  return '\\^$+.()|{}[]'.includes(character) ? `\\${character}` : character;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
