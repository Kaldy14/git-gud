import { describe, expect, it } from 'vitest';

import {
  createPullRequestDeepLink,
  createPullRequestDeepLinkFromGitHubUrl,
  parsePullRequestDeepLink
} from './pullRequestDeepLink';

describe('Git Gud pull request deep links', () => {
  it('creates a portable link by prefixing the GitHub pull request URL', () => {
    expect(
      createPullRequestDeepLink({
        host: 'GitHub.com',
        owner: 'Kaldy14',
        repository: 'git-gud',
        number: 123
      })
    ).toBe('git-gud://https://github.com/Kaldy14/git-gud/pull/123');
  });

  it('parses prefixed GitHub Enterprise pull request links', () => {
    expect(
      parsePullRequestDeepLink(
        'git-gud://https://github.example.com/acme/widgets/pull/42'
      )
    ).toEqual({
      host: 'github.example.com',
      owner: 'acme',
      repository: 'widgets',
      number: 42
    });
  });

  it('keeps previously shared pull request links working', () => {
    expect(
      parsePullRequestDeepLink(
        'git-gud://pull-request/github.example.com/acme/widgets/42'
      )
    ).toEqual({
      host: 'github.example.com',
      owner: 'acme',
      repository: 'widgets',
      number: 42
    });
  });

  it('converts a normal GitHub pull request URL', () => {
    expect(
      createPullRequestDeepLinkFromGitHubUrl(
        'https://github.com/VosoBrands/hive/pull/699'
      )
    ).toBe('git-gud://https://github.com/VosoBrands/hive/pull/699');
  });

  it.each([
    'https://github.com/acme/widgets/pull/42',
    'git-gud://http://github.com/acme/widgets/pull/42',
    'git-gud://https://github.com/acme/widgets/pull/0',
    'git-gud://https://github.com/acme/widgets/pull/42/extra',
    'git-gud://https://github.com/acme/widgets/pull/42?profile=local',
    'git-gud://settings/github.com/acme/widgets/42',
    'git-gud://pull-request/github.com/acme/widgets/0',
    'git-gud://pull-request/github.com/acme/widgets/not-a-number',
    'git-gud://pull-request/github.com/acme/widgets/42/extra',
    'git-gud://pull-request/github.com/acme/widgets/42?profile=local'
  ])('rejects unsupported input %s', (value) => {
    expect(parsePullRequestDeepLink(value)).toBeUndefined();
  });
});
