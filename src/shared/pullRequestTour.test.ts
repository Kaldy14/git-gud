import { describe, expect, it } from 'vitest';

import { normalizePullRequestTour, tourStepPaths, unanchorTourPoints, type PullRequestTour } from './pullRequestTour';
import type { GitReviewChunk, GitReviewPlan } from './types';

const clientPatch = [
  '--- a/src/client.ts',
  '+++ b/src/client.ts',
  '@@ -10,4 +10,6 @@ export function open() {',
  ' const a = 1;',
  '-const timeout = 0;',
  '+const timeout = options.timeout;',
  '+const retries = 3;',
  ' connect(a);',
  '+log(timeout);',
  ' return a;',
  '@@ -40,2 +42,3 @@ export function close() {',
  ' flush();',
  '+wait();',
  ' end();'
].join('\n');

function chunk(path: string, patch: string): GitReviewChunk {
  return {
    id: path, path, patch, header: '', startLine: 10, additions: 0, deletions: 0, role: 'anchor', relationship: '',
    reviewSection: 'implementation', category: 'source', changeType: 'modified', contentKind: 'code', source: 'commit'
  };
}

const plan: Pick<GitReviewPlan, 'units'> = {
  units: [{
    id: 'u1', title: '', reason: '', explanation: '', confidence: 'exact',
    chunks: [
      chunk('src/client.ts', clientPatch),
      chunk('src/server.ts', '@@ -1 +1 @@\n-old\n+new'),
      chunk('docs/readme.md', '@@ -1 +1 @@\n-old\n+new')
    ]
  }]
};

const point = (path: string, start?: number, end?: number, side = 'new') =>
  ({ body: `About ${path}`, path, side, start, end });
const step = (title: string, extra: Record<string, unknown> = {}) =>
  ({ title, summary: '', points: [], files: [], ...extra });

describe('normalizePullRequestTour', () => {
  it('trims a point to the hunk holding its start, on either side', () => {
    const { stops } = normalizePullRequestTour({
      stops: [step('Timeouts reach the connection', {
        points: [point('src/client.ts', 11, 45), point('src/client.ts', 11, undefined, 'old'), point('src/client.ts', 43)]
      })]
    }, plan);
    expect(stops[0]!.points.map(({ side, start, end }) => ({ side, start, end }))).toEqual([
      { side: 'new', start: 11, end: 15 },
      { side: 'old', start: 11, end: 11 },
      { side: 'new', start: 43, end: 43 }
    ]);
  });

  it('keeps an unplaceable point on a changed file as text only and drops one on an unknown file', () => {
    const { stops } = normalizePullRequestTour({
      stops: [step('Servers answer', {
        points: [point('src/server.ts', 90), point('src/server.ts'), point('src/missing.ts', 1), { path: 'src/server.ts', start: 1 }]
      })]
    }, plan);
    expect(stops[0]!.points).toEqual([
      { body: 'About src/server.ts', path: 'src/server.ts', side: 'new', start: null, end: null },
      { body: 'About src/server.ts', path: 'src/server.ts', side: 'new', start: null, end: null }
    ]);
  });

  it('gives every changed file one owning step and lets points show a file in several steps', () => {
    const { stops } = normalizePullRequestTour({
      stops: [
        step('Clients time out', { points: [point('src/client.ts', 11)], files: [{ path: 'src/server.ts', note: 'first' }] }),
        step('Servers wait', {
          points: [point('src/client.ts', 43)],
          files: [{ path: 'src/server.ts', note: 'again' }, { path: 'src/unknown.ts', note: '' }]
        })
      ]
    }, plan);
    expect(stops[0]!.files).toEqual([{ path: 'src/server.ts', note: 'first' }]);
    // The docs file was never placed, so it joins the last step.
    expect(stops[1]!.files).toEqual([{ path: 'docs/readme.md', note: '' }]);
    expect(tourStepPaths(stops[0]!)).toEqual(['src/client.ts', 'src/server.ts']);
    expect(tourStepPaths(stops[1]!)).toEqual(['src/client.ts', 'docs/readme.md']);
  });

  it('takes the highest valid risk for the overview and never defaults one', () => {
    const tour = normalizePullRequestTour({
      overview: { risk: 'low', summary: ' One sentence. ', highlights: ['a', '', 'b', 'c', 'd', 'e'] },
      stops: [step('A', { risk: 'medium', kind: 'mechanical' }), step('B', { risk: 'severe' })]
    }, plan);
    expect(tour.overview).toEqual({ risk: 'medium', summary: 'One sentence.', highlights: ['a', 'b', 'c', 'd'], partial: false });
    expect(tour.stops.map((stop) => [stop.kind, stop.risk])).toEqual([['mechanical', 'medium'], ['behavior', null]]);
    expect(normalizePullRequestTour({ overview: { risk: 'unknown' }, stops: [step('A')] }, plan).overview.risk).toBeNull();
  });

  it('builds a single step holding every file when the response has none', () => {
    expect(normalizePullRequestTour({ stops: 'nope' }, plan).stops).toEqual([{
      title: 'The change', summary: '', kind: 'behavior', risk: null, attention: null, points: [], questions: [],
      files: ['src/client.ts', 'src/server.ts', 'docs/readme.md'].map((path) => ({ path, note: '' }))
    }]);
  });
});

describe('unanchorTourPoints', () => {
  it('turns every point into text', () => {
    const tour: PullRequestTour = {
      version: 2, headSha: 'a', sourceFingerprint: 'f', generatedAt: '',
      overview: { risk: null, summary: '', highlights: [], partial: false },
      stops: [{ ...step('A'), kind: 'behavior', risk: null, attention: null, questions: [],
        points: [{ body: 'b', path: 'src/client.ts', side: 'new', start: 11, end: 12 }] }]
    };
    expect(unanchorTourPoints(tour).stops[0]!.points[0]).toMatchObject({ start: null, end: null });
  });
});
