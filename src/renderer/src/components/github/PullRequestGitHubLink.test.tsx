import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PullRequestGitHubLink } from './PullRequestGitHubLink';
import {
  copyGitGudPullRequestLink,
  copyPullRequestLink
} from './pullRequestLinkClipboard';

describe('PullRequestGitHubLink', () => {
  it('keeps the GitHub button as a normal external link', () => {
    const markup = renderToStaticMarkup(
      <PullRequestGitHubLink url="https://github.com/Kaldy14/git-gud/pull/123" />
    );

    expect(markup).toContain('href="https://github.com/Kaldy14/git-gud/pull/123"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('right-click for link actions');
  });

  it('copies the exact pull request URL', async () => {
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    };

    await copyPullRequestLink(
      'https://github.com/Kaldy14/git-gud/pull/123',
      clipboard
    );

    expect(clipboard.writeText).toHaveBeenCalledOnce();
    expect(clipboard.writeText).toHaveBeenCalledWith(
      'https://github.com/Kaldy14/git-gud/pull/123'
    );
  });

  it('copies a shareable Git Gud pull request URL', async () => {
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    };

    await copyGitGudPullRequestLink(
      'https://github.com/Kaldy14/git-gud/pull/123',
      clipboard
    );

    expect(clipboard.writeText).toHaveBeenCalledWith(
      'git-gud://https://github.com/Kaldy14/git-gud/pull/123'
    );
  });
});
