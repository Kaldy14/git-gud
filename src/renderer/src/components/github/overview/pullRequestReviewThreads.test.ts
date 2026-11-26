import { describe, expect, it } from 'vitest';
import type { GitHubPullRequestReviewComment } from '@shared/types';
import { firstSentence, pullRequestReviewThreads } from './pullRequestReviewThreads';

const comment = (overrides: Partial<GitHubPullRequestReviewComment>): GitHubPullRequestReviewComment => ({
  id: 1,
  body: 'Looks off.',
  author: 'ana',
  url: 'https://github.com/o/r/pull/1#discussion_r1',
  path: 'src/a.ts',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  subjectType: 'line',
  line: 12,
  side: 'right',
  ...overrides
});

describe('pull request review threads', () => {
  it('keeps one thread per root comment, oldest first, with reply counts and states', () => {
    const { threads, resolutionKnown } = pullRequestReviewThreads([
      comment({ id: 2, createdAt: '2026-11-02T10:00:00Z', isResolved: true, isOutdated: false }),
      comment({ id: 1, isResolved: false, isOutdated: true, author: 'coderabbitai[bot]' }),
      comment({ id: 3, inReplyToId: 1 }),
      comment({ id: 4, inReplyToId: 1 })
    ]);
    expect(resolutionKnown).toBe(true);
    expect(threads.map((thread) => [thread.id, thread.replies, thread.isResolved, thread.isOutdated, thread.isBot])).toEqual([
      [1, 2, false, true, true],
      [2, 0, true, false, false]
    ]);
  });

  it('reports unknown resolution when GitHub returned no thread states', () => {
    expect(pullRequestReviewThreads([comment({})]).resolutionKnown).toBe(false);
    expect(pullRequestReviewThreads([]).resolutionKnown).toBe(true);
    // A thread GitHub has no state for (a newer comment than the loaded states) makes the whole set unknown.
    expect(pullRequestReviewThreads([comment({ isResolved: false }), comment({ id: 2 })]).resolutionKnown).toBe(false);
  });

  it('drops the line of a file-level comment', () => {
    const [thread] = pullRequestReviewThreads([comment({ subjectType: 'file', line: undefined, side: undefined })]).threads;
    expect([thread.path, thread.line, thread.side]).toEqual(['src/a.ts', undefined, undefined]);
  });
});

describe('first sentence', () => {
  it.each([
    ['plain prose', 'This leaks the handle. Close it in finally.', 'This leaks the handle.'],
    ['markdown and inline code', '**Nit:** rename `fooBar` to [the helper](https://x.y).', 'Nit: rename fooBar to the helper.'],
    ['bot metadata and badges', '_⚠️ Potential issue_ | _🟠 Major_\n\n**Guard against a null head.** The fetch can return none.', 'Guard against a null head.'],
    ['html comments and collapsed details', '<!-- marker -->\n<details><summary>Prompt</summary>long</details>\nMissing await here', 'Missing await here'],
    ['images and badge links', '[![badge](https://b.svg)](https://x) ![shot](https://i.png) Fails on Windows paths.', 'Fails on Windows paths.'],
    ['a heading on its own', '## Bug\n> quoted context', 'Bug'],
    ['quotes', '> quoted context\n> more', 'quoted context more'],
    ['alerts and escapes', '> [!NOTE]\n> **Unverified · Minor** — Every key now links its object\n>\n> In the base, \\`handle\\_membership\\` never ran\\.', 'Unverified · Minor — Every key now links its object'],
    ['escaped punctuation and entities', 'Exporting `process[\'env\']` leaves `runtime_all` unset \\(a &amp; b\\)\\. More.', "Exporting process['env'] leaves runtime_all unset (a & b)."],
    ['code fences only', '```suggestion\nconst a = 1;\n```', '']
  ])('%s', (_name, body, expected) => {
    expect(firstSentence(body)).toBe(expected);
  });

  it('shortens a long sentence', () => {
    const sentence = firstSentence(`${'word '.repeat(60)}end.`);
    expect(sentence.length).toBeLessThanOrEqual(180);
    expect(sentence.endsWith('…')).toBe(true);
  });
});
