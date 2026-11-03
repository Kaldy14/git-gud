import { describe, expect, it } from 'vitest';

import { normalizePullRequestTour, pullRequestTourExcerptPatch } from './pullRequestTour';
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
  ' return a;'
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
    chunks: [chunk('src/client.ts', clientPatch), chunk('docs/readme.md', '@@ -1 +1 @@\n-old\n+new')]
  }]
};

describe('pull-request guide', () => {
  it('slices only the excerpt rows into a renderable one-hunk patch with real line numbers', () => {
    const slice = pullRequestTourExcerptPatch(plan, { path: 'src/client.ts', side: 'new', start: 11, end: 12 });
    expect(slice?.patch).toBe([
      '--- a/src/client.ts',
      '+++ b/src/client.ts',
      '@@ -11,0 +11,2 @@',
      '+const timeout = options.timeout;',
      '+const retries = 3;',
      ''
    ].join('\n'));
    expect(slice).toMatchObject({ additions: 2, deletions: 0 });
  });

  it('keeps deleted rows between excerpted new lines and old-side excerpts', () => {
    expect(pullRequestTourExcerptPatch(plan, { path: 'src/client.ts', side: 'new', start: 10, end: 11 })?.patch)
      .toContain('@@ -10,2 +10,2 @@\n const a = 1;\n-const timeout = 0;\n+const timeout = options.timeout;');
    expect(pullRequestTourExcerptPatch(plan, { path: 'src/client.ts', side: 'old', start: 11, end: 11 })?.patch)
      .toContain('@@ -11,1 +10,0 @@\n-const timeout = 0;');
  });

  it('clamps excerpts to the diff, drops notes outside them, and places every changed file', () => {
    const stops = normalizePullRequestTour({
      stops: [
        {
          title: 'Timeouts reach the connection',
          summary: 'Before, the timeout was ignored.',
          attention: { kind: 'contract', note: 'Callers now must pass a timeout.' },
          excerpts: [
            { path: 'src/client.ts', side: 'new', start: 11, end: 40, caption: 'Timeout' },
            { path: 'src/missing.ts', side: 'new', start: 1, end: 3, caption: '' }
          ],
          files: [{ path: 'src/client.ts', note: 'duplicate of an excerpt' }],
          notes: [
            { path: 'src/client.ts', line: 12, title: 'Retries', body: 'Fixed at three.' },
            { path: 'src/client.ts', line: 99, title: 'Outside', body: '' }
          ],
          questions: ['Why three retries?', 'Second?', 'Third is dropped']
        },
        { title: '', summary: 'Untitled stops are dropped.' }
      ]
    }, plan);

    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      attention: { kind: 'contract' },
      excerpts: [{ path: 'src/client.ts', start: 11, end: 15 }],
      notes: [{ title: 'Retries', line: 12 }],
      questions: ['Why three retries?', 'Second?'],
      // The docs file was never placed, so it joins the last stop.
      files: [{ path: 'docs/readme.md', note: '' }]
    });
  });

  it('builds a single stop when the response has none', () => {
    expect(normalizePullRequestTour({ stops: 'nope' }, plan)).toEqual([{
      title: 'The change', summary: '', attention: null, excerpts: [], notes: [], questions: [],
      files: [{ path: 'src/client.ts', note: '' }, { path: 'docs/readme.md', note: '' }]
    }]);
  });
});
