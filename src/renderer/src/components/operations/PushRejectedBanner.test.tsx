import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PushRejectedBanner } from './PushRejectedBanner';

const prompt = {
  repoPath: '/repo',
  branchName: 'feature/rewrite',
  remoteBranchName: 'origin/feature/rewrite',
  isCurrentBranch: true,
  expectedLocalSha: 'a'.repeat(40),
  target: {
    remote: 'origin',
    branch: 'feature/rewrite',
    expectedSha: 'b'.repeat(40),
    setUpstream: false
  }
};

describe('PushRejectedBanner', () => {
  it('offers pull, guarded force push, and cancellation for the current branch', () => {
    const markup = renderToStaticMarkup(
      <PushRejectedBanner
        prompt={prompt}
        isBusy={false}
        onPull={vi.fn()}
        onForcePush={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(markup).toContain('feature/rewrite');
    expect(markup).toContain('origin/feature/rewrite');
    expect(markup).toContain('Pull');
    expect(markup).toContain('Force Push');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('aria-live="assertive"');
  });

  it('makes the branch switch explicit before pulling a non-current branch', () => {
    const markup = renderToStaticMarkup(
      <PushRejectedBanner
        prompt={{ ...prompt, isCurrentBranch: false }}
        isBusy={false}
        onPull={vi.fn()}
        onForcePush={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(markup).toContain('Checkout &amp; Pull');
  });
});
