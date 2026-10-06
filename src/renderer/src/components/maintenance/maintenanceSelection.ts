import type { ArtifactCleanupCandidate, BranchCleanupCandidate, BranchCleanupEvidence } from '@shared/maintenance';

import { isAnalyzed, MAX_CLEANUP_BRANCHES } from './branchCleanupPresentation';

/** Delay before criteria edits start a new read-only scan. */
export const AUTO_SCAN_DELAY_MS = 300;
export const AGE_PRESETS = [30, 90, 180] as const;

export type HeaderCheckboxState = 'none' | 'some' | 'all';

/** Header checkbox state for the eligible rows currently visible. */
export function headerCheckboxState(selected: ReadonlySet<string>, eligibleVisibleIds: readonly string[]): HeaderCheckboxState {
  if (eligibleVisibleIds.length === 0) {
    return 'none';
  }

  const count = eligibleVisibleIds.filter((id) => selected.has(id)).length;
  return count === 0 ? 'none' : count === eligibleVisibleIds.length ? 'all' : 'some';
}

export type SelectionChange = { next: Set<string>; skipped: number };

/**
 * Header checkbox action. Deselects every eligible visible row when all are
 * selected; otherwise adds them in visible order up to `limit`.
 */
export function toggleAllVisible(
  current: ReadonlySet<string>,
  eligibleVisibleIds: readonly string[],
  limit = MAX_CLEANUP_BRANCHES
): SelectionChange {
  if (headerCheckboxState(current, eligibleVisibleIds) === 'all') {
    const next = new Set(current);
    for (const id of eligibleVisibleIds) {
      next.delete(id);
    }
    return { next, skipped: 0 };
  }

  return addIds(current, eligibleVisibleIds, limit);
}

/**
 * Row click. Without `shift` (or without a usable anchor) toggles one row.
 * With `shift`, applies the target row's new state to every eligible row
 * between the anchor and the target in the visible order.
 */
export function applyRowClick({
  current,
  orderedIds,
  eligibleIds,
  anchorId,
  targetId,
  shift,
  limit = MAX_CLEANUP_BRANCHES
}: {
  current: ReadonlySet<string>;
  orderedIds: readonly string[];
  eligibleIds: ReadonlySet<string>;
  anchorId: string | undefined;
  targetId: string;
  shift: boolean;
  limit?: number;
}): SelectionChange {
  if (!eligibleIds.has(targetId)) {
    return { next: new Set(current), skipped: 0 };
  }

  const select = !current.has(targetId);
  const targetIndex = orderedIds.indexOf(targetId);
  const anchorIndex = shift && anchorId !== undefined ? orderedIds.indexOf(anchorId) : -1;
  const range = anchorIndex < 0 || targetIndex < 0
    ? [targetId]
    : orderedIds
      .slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
      .filter((id) => eligibleIds.has(id));

  if (!select) {
    const next = new Set(current);
    for (const id of range) {
      next.delete(id);
    }
    return { next, skipped: 0 };
  }

  // Add from the anchor towards the target so the cap keeps the rows nearest the anchor.
  return addIds(current, anchorIndex > targetIndex ? [...range].reverse() : range, limit);
}

export function addIds(current: ReadonlySet<string>, ids: readonly string[], limit = MAX_CLEANUP_BRANCHES): SelectionChange {
  const next = new Set(current);
  let skipped = 0;

  for (const id of ids) {
    if (next.has(id)) {
      continue;
    }

    if (next.size >= limit) {
      skipped += 1;
      continue;
    }

    next.add(id);
  }

  return { next, skipped };
}

/** Keeps only ids that are still eligible, preserving identity when nothing changes. */
export function pruneSelection(current: ReadonlySet<string>, eligibleIds: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(Array.from(current).filter((id) => eligibleIds.has(id)));
  return next.size === current.size ? current : next;
}

/** Case-insensitive substring search across every whitespace-separated term. */
export function matchesSearch(query: string, fields: ReadonlyArray<string | undefined>): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const haystack = fields.filter(Boolean).join('\n').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

// --- Freshness -----------------------------------------------------------

export type BranchCriteria = { baseRef: string; olderThanDays: number };

/** A scan result is usable only for the criteria currently entered. */
export function isSameBranchCriteria(left: BranchCriteria | undefined, right: BranchCriteria | undefined): boolean {
  return Boolean(left && right && left.baseRef === right.baseRef && left.olderThanDays === right.olderThanDays);
}

// --- Branches ------------------------------------------------------------

export function isUnverifiedEvidence(evidence: BranchCleanupEvidence): boolean {
  return evidence === 'unmerged' || evidence === 'unknown';
}

export function isHeuristicEvidence(evidence: BranchCleanupEvidence): boolean {
  return evidence === 'patch-equivalent' || evidence === 'content-integrated';
}

/** Advanced mode: analyzed branches, with unmerged ones only when explicitly included. */
export function isBranchSelectable(candidate: BranchCleanupCandidate, includeUnverified: boolean): boolean {
  return isAnalyzed(candidate) && (includeUnverified || !isUnverifiedEvidence(candidate.evidence));
}

const EVIDENCE_ORDER: Record<BranchCleanupEvidence, number> = {
  merged: 0,
  'patch-equivalent': 1,
  'content-integrated': 2,
  unknown: 3,
  unmerged: 4
};

// --- Revalidating a reviewed selection -----------------------------------

/** An item exactly as it was shown on the review step. */
export type ReviewedItem = { id: string; name: string; sha: string; evidence?: BranchCleanupEvidence };

/** The same item in a fresh scan. */
export type RescannedItem = { sha: string; eligible: boolean; evidence?: BranchCleanupEvidence };

export type ReviewRevalidation = {
  /** Ids whose reviewed commit and evidence still hold, in reviewed order. */
  kept: string[];
  /** The tip moved since the review. */
  changed: ReviewedItem[];
  /** No longer present in the scan. */
  missing: ReviewedItem[];
  /** Same commit, but no longer eligible or backed by weaker merge evidence. */
  ineligible: ReviewedItem[];
};

/**
 * Compares a reviewed selection with a fresh scan. Only items with the exact
 * reviewed commit that remain eligible, with evidence at least as strong as
 * what was reviewed, are kept. Items new to the scan are never added.
 */
export function revalidateReviewed(reviewed: readonly ReviewedItem[], rescanned: ReadonlyMap<string, RescannedItem>): ReviewRevalidation {
  const result: ReviewRevalidation = { kept: [], changed: [], missing: [], ineligible: [] };

  for (const item of reviewed) {
    const current = rescanned.get(item.id);

    if (!current) {
      result.missing.push(item);
    } else if (current.sha !== item.sha) {
      result.changed.push(item);
    } else if (!current.eligible || isWeakerEvidence(current.evidence, item.evidence)) {
      result.ineligible.push(item);
    } else {
      result.kept.push(item.id);
    }
  }

  return result;
}

function isWeakerEvidence(current: BranchCleanupEvidence | undefined, reviewed: BranchCleanupEvidence | undefined): boolean {
  return current !== undefined && reviewed !== undefined && EVIDENCE_ORDER[current] > EVIDENCE_ORDER[reviewed];
}

export function compareBranchCandidates(left: BranchCleanupCandidate, right: BranchCleanupCandidate): number {
  return (
    analysisRank(left) - analysisRank(right) ||
    EVIDENCE_ORDER[left.evidence] - EVIDENCE_ORDER[right.evidence] ||
    (right.ageDays ?? -1) - (left.ageDays ?? -1) ||
    left.name.localeCompare(right.name)
  );
}

/** Analyzed first, then recent, then protected. */
function analysisRank(candidate: Pick<BranchCleanupCandidate, 'protectedReason' | 'oldEnough'>): number {
  return candidate.protectedReason ? 2 : candidate.oldEnough ? 0 : 1;
}

// --- Artifacts -----------------------------------------------------------

export function artifactKey(candidate: Pick<ArtifactCleanupCandidate, 'kind' | 'id'>): string {
  return `${candidate.kind}:${candidate.id}`;
}

export function isArtifactSelectable(candidate: ArtifactCleanupCandidate): boolean {
  return !candidate.protectedReason && candidate.oldEnough;
}

export function compareArtifactCandidates(left: ArtifactCleanupCandidate, right: ArtifactCleanupCandidate): number {
  return (
    analysisRank(left) - analysisRank(right) ||
    (right.ageDays ?? -1) - (left.ageDays ?? -1) ||
    left.name.localeCompare(right.name)
  );
}

// --- Simple mode rules ---------------------------------------------------

export type SimpleRules = {
  /** Local branches whose tip is reachable from the comparison branch. */
  mergedLocal: boolean;
  /** Local branches with patch or content evidence only. Requires acknowledgement. */
  likelyLocal: boolean;
  /** Local branches selected by age alone. Requires acknowledgement. */
  ageOnlyLocal: boolean;
  /** Merged remote branches. Never on by default. */
  mergedRemote: boolean;
  stashes: boolean;
  worktrees: boolean;
};

export const DEFAULT_SIMPLE_RULES: SimpleRules = {
  mergedLocal: true,
  likelyLocal: false,
  ageOnlyLocal: false,
  mergedRemote: false,
  stashes: false,
  worktrees: false
};

export type BranchRule = 'mergedLocal' | 'likelyLocal' | 'ageOnlyLocal' | 'mergedRemote';

export function branchRuleFor(candidate: BranchCleanupCandidate): BranchRule | undefined {
  if (!isAnalyzed(candidate)) {
    return undefined;
  }

  if (candidate.scope === 'remote') {
    return candidate.evidence === 'merged' ? 'mergedRemote' : undefined;
  }

  return candidate.evidence === 'merged'
    ? 'mergedLocal'
    : isHeuristicEvidence(candidate.evidence)
      ? 'likelyLocal'
      : 'ageOnlyLocal';
}

export type SimpleBranchPreview = {
  counts: Record<BranchRule, number>;
  /** Selected candidates, capped at the per-cleanup limit, in display order. */
  selected: BranchCleanupCandidate[];
  /** Matching candidates beyond the limit. */
  overflow: number;
};

export function previewSimpleBranches(
  candidates: readonly BranchCleanupCandidate[],
  rules: SimpleRules,
  limit = MAX_CLEANUP_BRANCHES
): SimpleBranchPreview {
  const counts: Record<BranchRule, number> = { mergedLocal: 0, likelyLocal: 0, ageOnlyLocal: 0, mergedRemote: 0 };
  const matching: BranchCleanupCandidate[] = [];

  for (const candidate of candidates) {
    const rule = branchRuleFor(candidate);

    if (!rule) {
      continue;
    }

    counts[rule] += 1;

    if (rules[rule]) {
      matching.push(candidate);
    }
  }

  // Strongest evidence first so the cap never drops merged branches in favour of weaker ones.
  matching.sort((left, right) => Number(left.scope === 'remote') - Number(right.scope === 'remote') || compareBranchCandidates(left, right));
  return { counts, selected: matching.slice(0, limit), overflow: Math.max(0, matching.length - limit) };
}

export type SimpleArtifactPreview = {
  counts: Record<ArtifactCleanupCandidate['kind'], number>;
  selected: ArtifactCleanupCandidate[];
  overflow: number;
};

export function previewSimpleArtifacts(
  candidates: readonly ArtifactCleanupCandidate[],
  rules: Pick<SimpleRules, 'stashes' | 'worktrees'>,
  limit = MAX_CLEANUP_BRANCHES
): SimpleArtifactPreview {
  const counts = { stash: 0, worktree: 0 };
  const matching: ArtifactCleanupCandidate[] = [];

  for (const candidate of candidates) {
    if (!isArtifactSelectable(candidate)) {
      continue;
    }

    counts[candidate.kind] += 1;

    if (candidate.kind === 'stash' ? rules.stashes : rules.worktrees) {
      matching.push(candidate);
    }
  }

  matching.sort((left, right) => Number(left.kind === 'worktree') - Number(right.kind === 'worktree') || compareArtifactCandidates(left, right));
  return { counts, selected: matching.slice(0, limit), overflow: Math.max(0, matching.length - limit) };
}
