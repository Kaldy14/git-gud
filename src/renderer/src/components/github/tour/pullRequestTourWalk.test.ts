import { describe, expect, it } from 'vitest';

import { unanchorTourPoints, type PullRequestTour, type PullRequestTourStop } from '@shared/pullRequestTour';

import {
  loadTourWalk,
  saveTourWalk,
  tourInlineNotes,
  tourStepScope,
  tourWalkReducer,
  tourWalkStorageKey,
  unreviewedTourSteps,
  type TourWalk
} from './pullRequestTourWalk';

function stop(overrides: Partial<PullRequestTourStop>): PullRequestTourStop {
  return { title: 'Step', summary: '', kind: 'behavior', risk: null, change: null, attention: null, points: [], files: [], flow: null, ...overrides };
}

const tour: PullRequestTour = {
  version: 3,
  headSha: 'abc',
  sourceFingerprint: 'fp',
  generatedAt: '2026-11-01T10:00:00.000Z',
  overview: { risk: null, summary: '', highlights: [], partial: false },
  stops: [
    stop({
      points: [
        { label: 'Saves first', body: 'Saves first', path: 'src/b.ts', side: 'new', start: 10, end: 14 },
        { label: 'Old guard removed', body: 'Old guard removed', path: 'src/a.ts', side: 'old', start: 3, end: null },
        { label: 'Text only', body: 'Text only', path: 'src/a.ts', side: 'new', start: null, end: null }
      ],
      files: [{ path: 'src/a.ts', note: '' }, { path: 'src/c.ts', note: 'owned' }]
    }),
    stop({ points: [{ label: 'Styles', body: 'Styles', path: 'src/d.css', side: 'new', start: 2, end: 2 }] })
  ]
};

const locator = { profileId: 'p', owner: 'o', repository: 'r', number: 5 };

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('tourWalkReducer', () => {
  const start: TourWalk = { step: 0, reviewed: [], point: null };

  it('moves between steps and clears the selected point', () => {
    const selected = tourWalkReducer(start, { type: 'point', point: 1 });
    expect(selected.point).toBe(1);
    expect(tourWalkReducer(selected, { type: 'go', step: 1 })).toEqual({ step: 1, reviewed: [], point: null });
  });

  it('opens a step at a requested point', () => {
    expect(tourWalkReducer(start, { type: 'go', step: 1, point: 0 })).toEqual({ step: 1, reviewed: [], point: 0 });
  });

  it('keeps the same object when nothing changes', () => {
    expect(tourWalkReducer(start, { type: 'go', step: 0 })).toBe(start);
    expect(tourWalkReducer(start, { type: 'point', point: null })).toBe(start);
  });

  it('marks a step reviewed and moves on, staying on the last step', () => {
    const next = tourWalkReducer(start, { type: 'review-and-next', step: 0, count: 2 });
    expect(next).toEqual({ step: 1, reviewed: [0], point: null });
    const last = tourWalkReducer(next, { type: 'review-and-next', step: 1, count: 2 });
    expect(last).toEqual({ step: 1, reviewed: [0, 1], point: null });
  });

  it('toggles reviewed without moving', () => {
    const reviewed = tourWalkReducer(start, { type: 'toggle-reviewed', step: 1 });
    expect(reviewed).toEqual({ step: 0, reviewed: [1], point: null });
    expect(tourWalkReducer(reviewed, { type: 'toggle-reviewed', step: 1 }).reviewed).toEqual([]);
  });

  it('lists the steps still to review', () => {
    expect(unreviewedTourSteps({ reviewed: [0, 2] }, 4)).toEqual([1, 3]);
  });
});

describe('walk persistence', () => {
  it('keys the walk by pull request and tour generation', () => {
    const key = tourWalkStorageKey(locator, tour);
    expect(tourWalkStorageKey(locator, { ...tour, generatedAt: 'later' })).not.toBe(key);
    expect(tourWalkStorageKey(locator, { ...tour, headSha: 'def' })).not.toBe(key);
    expect(tourWalkStorageKey({ ...locator, number: 6 }, tour)).not.toBe(key);
  });

  it('restores step, reviewed steps and point', () => {
    const storage = new MemoryStorage();
    saveTourWalk(storage, 'k', { step: 1, reviewed: [0], point: 2 });
    expect(loadTourWalk(storage, 'k', 2)).toEqual({ step: 1, reviewed: [0], point: 2 });
  });

  it('drops values that no longer fit the tour', () => {
    const storage = new MemoryStorage();
    storage.setItem('k', JSON.stringify({ step: 7, reviewed: [0, 0, 9, 'x'], point: -1 }));
    expect(loadTourWalk(storage, 'k', 2)).toEqual({ step: 0, reviewed: [0], point: null });
    storage.setItem('broken', '{');
    expect(loadTourWalk(storage, 'broken', 2)).toEqual({ step: 0, reviewed: [], point: null });
    expect(loadTourWalk(storage, 'missing', 2)).toEqual({ step: 0, reviewed: [], point: null });
  });
});

describe('mapping steps to scopes and notes', () => {
  it('scopes a step to its point files, then the files it owns', () => {
    expect(tourStepScope(tour, 0, tour.stops[0]!)).toEqual({
      key: 'tour:2026-11-01T10:00:00.000Z:0',
      paths: ['src/b.ts', 'src/a.ts', 'src/c.ts']
    });
  });

  it('labels every anchored point step.point in Code, old side included', () => {
    expect(tourInlineNotes(tour, { tab: 'code' }).map(({ marker, path, line, side }) => ({ marker, path, line, side }))).toEqual([
      { marker: '1.1', path: 'src/b.ts', line: 14, side: 'right' },
      { marker: '1.2', path: 'src/a.ts', line: 3, side: 'left' },
      { marker: '2.1', path: 'src/d.css', line: 2, side: 'right' }
    ]);
  });

  it('shows only the current step in the Tour, numbered by point', () => {
    expect(tourInlineNotes(tour, { tab: 'tour', step: 0 }).map(({ marker, point }) => ({ marker, point }))).toEqual([
      { marker: '1', point: 0 },
      { marker: '2', point: 1 }
    ]);
  });

  it('has no marks for a stale tour', () => {
    expect(tourInlineNotes(unanchorTourPoints(tour), { tab: 'code' })).toEqual([]);
  });
});
