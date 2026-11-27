import { describe, expect, it } from 'vitest';

import type { PullRequestTourStop } from '@shared/pullRequestTour';
import type { GitReviewChunk, GitReviewPlan } from '@shared/types';

import { tourFileStats, tourPointPosition, tourSegmentWeight, tourStepLines } from './tourVisuals';

// Two hunks in one file: lines 10–13 (3 changed rows) and 100–102 (1 changed row).
const sharedPatch = ['@@ -10,3 +10,4 @@', ' a', '-b', '+c', '+d', ' e', '@@ -99,2 +100,3 @@', ' x', '+y', ' z'].join('\n');

function chunk(path: string, patch: string, additions: number, deletions: number): GitReviewChunk {
  return {
    id: path, path, patch, header: '', startLine: 1, additions, deletions, role: 'anchor', relationship: '',
    reviewSection: 'implementation', category: 'source', changeType: 'modified', contentKind: 'code', source: 'commit'
  };
}

const plan: Pick<GitReviewPlan, 'units'> = {
  units: [{
    id: 'u', title: '', reason: '', explanation: '', confidence: 'exact',
    chunks: [chunk('shared.css', sharedPatch, 3, 1), chunk('docs.md', '@@ -1 +1 @@\n-old\n+new', 1, 1)]
  }]
};

const stop = (points: Array<{ path: string; start: number | null }>, files: string[] = []): PullRequestTourStop => ({
  title: 't', summary: '', kind: 'behavior', risk: null, change: null, attention: null, flow: null,
  points: points.map((point) => ({ label: '', body: '', side: 'new', end: point.start, ...point })),
  files: files.map((path) => ({ path, note: '' }))
});

describe('tour visuals', () => {
  const stats = tourFileStats(plan);

  it('places a point along its file’s changed region', () => {
    expect(stats.get('shared.css')!.spans.new).toEqual({ min: 10, max: 102 });
    expect(tourPointPosition({ side: 'new', start: 10 }, stats.get('shared.css'))).toBe(0);
    expect(tourPointPosition({ side: 'new', start: 102 }, stats.get('shared.css'))).toBe(1);
    expect(tourPointPosition({ side: 'new', start: null }, stats.get('shared.css'))).toBeNull();
  });

  it('splits a file shared by two steps by the hunk each step points into, and counts the rest for its owner', () => {
    const tour = { stops: [stop([{ path: 'shared.css', start: 11 }]), stop([{ path: 'shared.css', start: 101 }], ['docs.md'])] };
    expect(tourStepLines(tour, stats)).toEqual([3, 1 + 2]);
    // A step whose points land in no hunk still gets the file it owns.
    expect(tourStepLines({ stops: [stop([], ['shared.css']), stop([{ path: 'docs.md', start: 1 }])] }, stats)).toEqual([4, 2]);
  });

  it('widens segments on a log scale between 1 and 4', () => {
    expect(tourSegmentWeight(0)).toBe(1);
    expect(tourSegmentWeight(62)).toBe(3);
    expect(tourSegmentWeight(100_000)).toBe(4);
  });
});
