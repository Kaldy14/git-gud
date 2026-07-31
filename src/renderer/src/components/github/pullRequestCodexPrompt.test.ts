import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestDetail } from '@shared/types';

import { buildPullRequestCodexPrompt } from './pullRequestCodexPrompt';

describe('pull request Codex handoff prompt', () => {
  it('includes local line, file, and reply drafts without implying they were published', () => {
    const prompt = buildPullRequestCodexPrompt(
      pullRequest(),
      [
        {
          id: 'line-draft',
          kind: 'line',
          body: 'Handle an empty value here.',
          path: 'src/parser.ts',
          line: 24,
          side: 'right',
          startLine: 22,
          startSide: 'right'
        },
        {
          id: 'file-draft',
          kind: 'file',
          body: 'Please add focused tests for the parser.',
          path: 'src/parser.test.ts'
        },
        {
          id: 'reply-draft',
          kind: 'reply',
          body: 'Please address this concern in the implementation.',
          inReplyToId: 91
        }
      ],
      'Keep the change backwards compatible.'
    );

    expect(prompt).toContain('have not been posted to GitHub');
    expect(prompt).toContain('acme/widgets#42 — Parse empty values');
    expect(prompt).toContain('Review summary:\n> Keep the change backwards compatible.');
    expect(prompt).toContain('`src/parser.ts`, lines 22–24 (right side)');
    expect(prompt).toContain('`src/parser.test.ts` (whole file)');
    expect(prompt).toContain('Reply to @octocat on `src/parser.ts`, line 24');
    expect(prompt).toContain('Existing GitHub comment:\n> Could this throw for an empty value?');
    expect(prompt).toContain('Do not post, edit, or resolve any GitHub comments.');
  });
});

function pullRequest(): GitHubPullRequestDetail {
  return {
    profileId: 'profile:acme',
    owner: 'acme',
    repository: 'widgets',
    number: 42,
    id: 'pr-42',
    title: 'Parse empty values',
    url: 'https://github.com/acme/widgets/pull/42',
    author: 'richie',
    updatedAt: '2026-07-28T10:00:00.000Z',
    category: 'needs-your-review',
    isDraft: false,
    reviewDecision: 'review-required',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    reviewers: [],
    comments: 1,
    changedFiles: 1,
    additions: 10,
    deletions: 2,
    headRefName: 'feature/empty-values',
    headSha: '1234567890abcdef',
    baseRefName: 'main',
    checks: {
      state: 'success',
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0
    },
    body: 'Teach the parser about empty values.',
    baseSha: 'abcdef1234567890',
    baseRefSha: 'fedcba0987654321',
    commits: 1,
    commitTimeline: [],
    files: [],
    reviewPlan: {
      repoPath: 'github://github.com/acme/widgets',
      target: {
        kind: 'branch',
        name: 'feature/empty-values',
        sha: '1234567890abcdef'
      },
      targetKey: 'github-pr:profile:acme:acme/widgets#42:1234567890abcdef',
      sourceFingerprint: 'fingerprint',
      loadedAt: '2026-07-28T10:00:00.000Z',
      units: [],
      fileContexts: [],
      reviewedChunkIds: []
    },
    mergeSettings: {
      allowedMethods: ['squash'],
      defaultMethod: 'squash'
    },
    viewerLogin: 'richie',
    reviewComments: [
      {
        id: 91,
        body: 'Could this throw for an empty value?',
        author: 'octocat',
        url: 'https://github.com/acme/widgets/pull/42#discussion_r91',
        path: 'src/parser.ts',
        createdAt: '2026-07-28T09:00:00.000Z',
        updatedAt: '2026-07-28T09:00:00.000Z',
        subjectType: 'line',
        line: 24,
        side: 'right'
      }
    ],
    conversationComments: [],
    reviews: [],
    loadedAt: '2026-07-28T10:00:00.000Z'
  };
}
