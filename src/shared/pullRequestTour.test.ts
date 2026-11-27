import { describe, expect, it } from 'vitest';

import { clipText, normalizePullRequestTour, pointHeadline, tourStepPaths, unanchorTourPoints, type PullRequestTour } from './pullRequestTour';
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
    const textOnly = { label: 'About src/server.ts', body: 'About src/server.ts', path: 'src/server.ts', side: 'new', start: null, end: null };
    expect(stops[0]!.points).toEqual([textOnly, textOnly]);
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
    expect(tour.overview).toEqual({ risk: 'medium', summary: 'One sentence.', highlights: ['a', 'b', 'c'], partial: false });
    expect(tour.stops.map((stop) => [stop.kind, stop.risk])).toEqual([['mechanical', 'medium'], ['behavior', null]]);
    expect(normalizePullRequestTour({ overview: { risk: 'unknown' }, stops: [step('A')] }, plan).overview.risk).toBeNull();
  });

  it('builds a single step holding every file when the response has none', () => {
    expect(normalizePullRequestTour({ stops: 'nope' }, plan).stops).toEqual([{
      title: 'The change', summary: '', kind: 'behavior', risk: null, change: null, attention: null, points: [], flow: null,
      files: ['src/client.ts', 'src/server.ts', 'docs/readme.md'].map((path) => ({ path, note: '' }))
    }]);
  });

  it('keeps a before/now pair only when both sides are written, and labels every point', () => {
    const { stops } = normalizePullRequestTour({
      stops: [
        step('A', { change: { before: 'Old', after: 'New' }, points: [{ ...point('src/client.ts', 11), label: ' Timeouts reach the socket ' }] }),
        step('B', { change: { before: 'Old', after: ' ' }, points: [{ ...point('src/server.ts', 1), body: 'The server answers first, so clients stop waiting.' }] })
      ]
    }, plan);
    expect(stops.map((stop) => stop.change)).toEqual([{ before: 'Old', after: 'New' }, null]);
    expect(stops.map((stop) => stop.points[0]!.label)).toEqual(['Timeouts reach the socket', 'The server answers first']);
  });

  it('keeps a flow only where it names code, without cycles or loose context', () => {
    const flow = (nodes: unknown[], edges: unknown[]) => normalizePullRequestTour({
      stops: [step('A', { points: [point('src/client.ts', 11)], files: [{ path: 'src/server.ts' }], flow: { nodes, edges } })]
    }, plan).stops[0]!.flow;
    const nodes = [
      { id: 'client', label: 'Client', state: 'changed', point: 0 },
      { id: 'server', label: 'Server', state: 'added', path: 'src/server.ts' },
      { id: 'db', label: 'Database', state: 'context' },
      { id: 'cache', label: 'Cache', state: 'context' },
      { id: 'queue', label: 'Queue', state: 'context' },
      { id: 'ghost', label: 'Ghost', state: 'changed', path: 'src/missing.ts' },
      { id: 'elsewhere', label: 'Docs', state: 'changed', path: 'docs/readme.md' }, // changed, but not in this step
      { id: 'far', label: 'Far', state: 'changed', point: 7 }
    ];
    const result = flow(nodes, [
      { from: 'client', to: 'server', label: 'request' },
      { from: 'server', to: 'db' },
      { from: 'db', to: 'client' }, // closes a cycle
      { from: 'db', to: 'cache' }, // context to context only
      { from: 'server', to: 'ghost' },
      { from: 'server', to: 'elsewhere' },
      { from: 'server', to: 'server' }
    ]);
    expect(result).toEqual({
      nodes: [
        { id: 'client', label: 'Client', state: 'changed', point: 0, path: 'src/client.ts' },
        { id: 'server', label: 'Server', state: 'added', point: null, path: 'src/server.ts' },
        { id: 'db', label: 'Database', state: 'context', point: null, path: null }
      ],
      edges: [{ from: 'client', to: 'server', label: 'request' }, { from: 'server', to: 'db', label: '' }]
    });
    // One node that names code is not enough to draw.
    expect(flow(nodes.slice(0, 3).map((node, index) => index === 1 ? { ...node, state: 'context' } : node),
      [{ from: 'client', to: 'server' }, { from: 'server', to: 'db' }])).toBeNull();
    expect(normalizePullRequestTour({ stops: [step('A', { kind: 'mechanical', flow: { nodes, edges: [] } })] }, plan).stops[0]!.flow).toBeNull();
  });

  it('keeps a flow box on the point the model meant when an earlier point is dropped', () => {
    const { stops } = normalizePullRequestTour({
      stops: [step('A', {
        points: [point('src/missing.ts', 1), point('src/client.ts', 11), point('src/server.ts', 1)],
        flow: {
          nodes: [{ id: 'a', label: 'A', state: 'changed', point: 1 }, { id: 'b', label: 'B', state: 'changed', point: 2 }, { id: 'c', label: 'C', state: 'context' }],
          edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
        }
      })]
    }, plan);
    expect(stops[0]!.flow!.nodes.map((node) => [node.id, node.point, node.path])).toEqual([
      ['a', 0, 'src/client.ts'], ['b', 1, 'src/server.ts'], ['c', null, null]
    ]);
  });
});

describe('clipText and pointHeadline', () => {
  it('cuts long text at a sentence end or a word, never mid-word', () => {
    expect(clipText('First sentence here. Second sentence that runs long.', 30)).toBe('First sentence here.');
    expect(clipText('one two three four five six', 15)).toBe('one two three…');
    expect(clipText('  short  ', 15)).toBe('short');
    expect(clipText('Calls `parse(a, b)` twice', 16)).toBe('Calls `parse(a`…');
  });

  it('takes the first clause, at most seven words', () => {
    expect(pointHeadline('`isImportable` checks only names, so archive state no longer matters.')).toBe('`isImportable` checks only names');
    expect(pointHeadline('A very long clause that keeps going past the seven word budget')).toBe('A very long clause that keeps going…');
    expect(pointHeadline('`parse(a, b)` now rejects empty input')).toBe('`parse(a`');
  });
});

describe('unanchorTourPoints', () => {
  it('turns every point into text', () => {
    const tour: PullRequestTour = {
      version: 3, headSha: 'a', sourceFingerprint: 'f', generatedAt: '',
      overview: { risk: null, summary: '', highlights: [], partial: false },
      stops: [{ ...step('A'), kind: 'behavior', risk: null, change: null, attention: null, flow: null,
        points: [{ label: 'b', body: 'b', path: 'src/client.ts', side: 'new', start: 11, end: 12 }] }]
    };
    expect(unanchorTourPoints(tour).stops[0]!.points[0]).toMatchObject({ start: null, end: null });
  });
});
