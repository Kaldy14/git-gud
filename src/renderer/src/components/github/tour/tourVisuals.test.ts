import { describe, expect, it } from 'vitest';

import type { PullRequestTourStop } from '@shared/pullRequestTour';
import type { GitReviewChunk, GitReviewPlan } from '@shared/types';

import { layoutTourFlow, tourFileStats, tourPointPosition, tourSegmentWeight, tourStepLines } from './tourVisuals';

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
    expect(tourStepLines(tour, stats)).toEqual([{ added: 2, removed: 1 }, { added: 1 + 1, removed: 1 }]);
    // A step whose points land in no hunk still gets the file it owns.
    expect(tourStepLines({ stops: [stop([], ['shared.css']), stop([{ path: 'docs.md', start: 1 }])] }, stats)).toEqual([{ added: 3, removed: 1 }, { added: 1, removed: 1 }]);
  });

  it('widens segments on a log scale between 1 and 4', () => {
    expect(tourSegmentWeight({ added: 0, removed: 0 })).toBe(1);
    expect(tourSegmentWeight({ added: 60, removed: 2 })).toBe(3);
    expect(tourSegmentWeight({ added: 100_000, removed: 0 })).toBe(4);
  });

  it('lays a flow out in rows so every edge points down, sharing a row’s width', () => {
    const node = (id: string) => ({ id, label: id, state: 'changed' as const, point: null, path: 'shared.css' });
    const { boxes, lines } = layoutTourFlow({
      nodes: [node('import'), node('store'), node('reports'), node('admin')],
      edges: [{ from: 'import', to: 'store', label: '' }, { from: 'store', to: 'reports', label: '' }, { from: 'store', to: 'admin', label: '' }, { from: 'import', to: 'admin', label: '' }]
    });
    expect(boxes.map((box) => [box.id, box.row])).toEqual([['import', 0], ['store', 1], ['reports', 2], ['admin', 2]]);
    expect(lines.every((line) => line.y2 > line.y1)).toBe(true);
    // import → admin skips the store's row: it takes a lane, and the store is packed left of it.
    const skip = lines.find((line) => line.from === 'import' && line.to === 'admin')!;
    const store = boxes.find((box) => box.id === 'store')!;
    expect(skip.lane).not.toBeNull();
    expect(store.x + store.width).toBeLessThan(skip.lane!);
    expect(lines.filter((line) => line.lane === null)).toHaveLength(3);
  });
});
