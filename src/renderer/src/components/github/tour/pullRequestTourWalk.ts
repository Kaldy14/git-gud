import { tourStepPaths, type PullRequestTour, type PullRequestTourPoint, type PullRequestTourStop } from '@shared/pullRequestTour';
import type { GitHubPullRequestLocator } from '@shared/types';

import type { PullRequestCodeLocation } from '../pullRequestNavigation';

// The reader's walk through one tour: where they are, which steps they marked reviewed and which point is
// selected. Step and reviewed persist per tour generation; a rewritten tour starts a fresh walk.

// Tour and Code share one diff; while a composer is open, moving between them or between steps would hide it.
export const COMPOSER_OPEN_NOTICE = 'Add or cancel your comment first';

export type TourWalk = { step: number; reviewed: readonly number[]; point: number | null };

export type TourWalkAction =
  | { type: 'go'; step: number; point?: number | null }
  | { type: 'point'; point: number | null }
  | { type: 'toggle-reviewed'; step: number }
  // Marks the step reviewed and moves to the next one (stays on the last step).
  | { type: 'review-and-next'; step: number; count: number };

export function tourWalkReducer(walk: TourWalk, action: TourWalkAction): TourWalk {
  switch (action.type) {
    case 'go':
      if (action.step === walk.step && (action.point === undefined || action.point === walk.point)) return walk;
      return { ...walk, step: action.step, point: action.point ?? null };
    case 'point':
      return action.point === walk.point ? walk : { ...walk, point: action.point };
    case 'toggle-reviewed':
      return {
        ...walk,
        reviewed: walk.reviewed.includes(action.step)
          ? walk.reviewed.filter((step) => step !== action.step)
          : [...walk.reviewed, action.step].sort((a, b) => a - b)
      };
    case 'review-and-next': {
      const reviewed = walk.reviewed.includes(action.step) ? walk.reviewed : [...walk.reviewed, action.step].sort((a, b) => a - b);
      const step = Math.min(action.step + 1, action.count - 1);
      return { reviewed, step, point: step === walk.step ? walk.point : null };
    }
  }
}

/** Steps not yet marked reviewed, in order. */
export function unreviewedTourSteps(walk: Pick<TourWalk, 'reviewed'>, count: number): number[] {
  return Array.from({ length: count }, (_, step) => step).filter((step) => !walk.reviewed.includes(step));
}

/** One walk per pull request and tour generation: a rewritten or re-headed tour starts over. */
export function tourWalkStorageKey(locator: GitHubPullRequestLocator, tour: Pick<PullRequestTour, 'headSha' | 'generatedAt'>): string {
  return `git-gud:pr-tour-walk:v1:${JSON.stringify([locator.profileId, locator.owner, locator.repository, locator.number, tour.headSha, tour.generatedAt])}`;
}

type WalkStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadTourWalk(storage: WalkStorage, key: string, count: number): TourWalk {
  const fresh: TourWalk = { step: 0, reviewed: [], point: null };
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as Partial<Record<keyof TourWalk, unknown>> | null;
    if (!value || count === 0) return fresh;
    const inRange = (item: unknown): item is number => Number.isInteger(item) && (item as number) >= 0 && (item as number) < count;
    return {
      step: inRange(value.step) ? value.step : 0,
      reviewed: Array.isArray(value.reviewed) ? [...new Set(value.reviewed.filter(inRange))].sort((a, b) => a - b) : [],
      point: Number.isInteger(value.point) && (value.point as number) >= 0 ? value.point as number : null
    };
  } catch {
    return fresh;
  }
}

export function saveTourWalk(storage: WalkStorage, key: string, walk: TourWalk): void {
  try {
    storage.setItem(key, JSON.stringify(walk));
  } catch {
    // The walk is a convenience; losing it only means starting at step 1 next time.
  }
}

/** The diff scope for a step: its files in tour order, never hidden by filters. */
export function tourStepScope(tour: Pick<PullRequestTour, 'generatedAt'>, step: number, stop: Pick<PullRequestTourStop, 'points' | 'files'>) {
  return { key: `tour:${tour.generatedAt}:${step}`, paths: tourStepPaths(stop) };
}

export function isAnchoredPoint(point: PullRequestTourPoint): point is PullRequestTourPoint & { start: number } {
  return point.start !== null;
}

/** Where an anchored point's lines are; the inline mark sits under the last line. */
export function tourPointRange(point: PullRequestTourPoint & { start: number }): Required<Pick<PullRequestCodeLocation, 'line' | 'endLine' | 'side'>> & { path: string } {
  return { path: point.path, line: point.start, endLine: point.end ?? point.start, side: point.side === 'old' ? 'left' : 'right' };
}

export type TourInlineNote = {
  path: string;
  line: number;
  side: 'left' | 'right';
  body: string;
  marker: string;
  step: number;
  point: number;
};

/**
 * Inline marks for anchored points. Code shows every point of the tour labelled `step.point`; the Tour shows
 * only the current step's points labelled with their number. Text-only points have no mark.
 */
export function tourInlineNotes(tour: Pick<PullRequestTour, 'stops'>, scope: { tab: 'code' } | { tab: 'tour'; step: number }): TourInlineNote[] {
  return tour.stops.flatMap((stop, step) => scope.tab === 'tour' && scope.step !== step ? [] : stop.points.flatMap((point, index) => {
    if (!isAnchoredPoint(point)) return [];
    const range = tourPointRange(point);
    return [{
      path: point.path,
      line: range.endLine,
      side: range.side,
      body: point.body,
      marker: scope.tab === 'tour' ? String(index + 1) : `${step + 1}.${index + 1}`,
      step,
      point: index
    }];
  }));
}
