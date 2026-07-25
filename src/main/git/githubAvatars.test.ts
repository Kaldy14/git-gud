import { describe, expect, it, vi } from 'vitest';

import { findGitHubRepository, loadGitHubCommitAuthorAvatars } from './githubAvatars';

describe('findGitHubRepository', () => {
  it('prefers the origin GitHub remote and supports HTTPS and SCP-style URLs', () => {
    expect(
      findGitHubRepository([
        { name: 'upstream', fetchUrl: 'https://github.com/upstream/project.git' },
        { name: 'origin', fetchUrl: 'git@github.com:owner/project.git' }
      ])
    ).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'project'
    });
  });

  it('recognizes a configured GitHub Enterprise host', () => {
    expect(
      findGitHubRepository(
        [{ name: 'origin', fetchUrl: 'ssh://git@github.example.com/acme/widgets.git' }],
        'https://github.example.com/'
      )
    ).toEqual({
      host: 'github.example.com',
      owner: 'acme',
      name: 'widgets'
    });
  });

  it('ignores local and non-GitHub remotes', () => {
    expect(findGitHubRepository([{ name: 'origin', fetchUrl: '/tmp/project.git' }])).toBeUndefined();
    expect(
      findGitHubRepository([{ name: 'origin', fetchUrl: 'https://gitlab.com/acme/widgets.git' }])
    ).toBeUndefined();
  });
});

describe('loadGitHubCommitAuthorAvatars', () => {
  it('resolves one representative commit per author and prioritizes remote branch tips', async () => {
    const runGraphql = vi.fn(async ({ query }: { query: string }) => {
      expect(query.indexOf('2222222222222222222222222222222222222222')).toBeLessThan(
        query.indexOf('1111111111111111111111111111111111111111')
      );
      expect(query.match(/author@example\.com/g)).toBeNull();

      return {
        data: {
          repository: {
            avatar0: {
              author: {
                user: {
                  avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4&s=64'
                }
              }
            },
            avatar1: {
              author: {
                user: {
                  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4&s=64'
                }
              }
            }
          }
        }
      };
    });
    const avatars = await loadGitHubCommitAuthorAvatars(
      { host: 'github.test-priority.example', owner: 'acme', name: 'widgets' },
      [
        {
          sha: '1111111111111111111111111111111111111111',
          email: ' Author@example.com ',
          hasRemoteRef: false
        },
        {
          sha: '2222222222222222222222222222222222222222',
          email: 'remote@example.com',
          hasRemoteRef: true
        },
        {
          sha: '3333333333333333333333333333333333333333',
          email: 'author@example.com',
          hasRemoteRef: false
        }
      ],
      undefined,
      runGraphql
    );

    expect(runGraphql).toHaveBeenCalledTimes(1);
    expect(avatars).toEqual(
      new Map([
        ['remote@example.com', 'https://avatars.githubusercontent.com/u/2?v=4&s=64'],
        ['author@example.com', 'https://avatars.githubusercontent.com/u/1?v=4&s=64']
      ])
    );
  });

  it('omits unlinked authors and treats GitHub failures as a graceful fallback', async () => {
    const repository = {
      host: 'github.test-fallback.example',
      owner: 'acme',
      name: 'widgets'
    };
    const candidates = [
      {
        sha: '4444444444444444444444444444444444444444',
        email: 'unlinked@example.com',
        hasRemoteRef: true
      }
    ];
    const noUser = await loadGitHubCommitAuthorAvatars(
      repository,
      candidates,
      undefined,
      async () => ({
        data: {
          repository: {
            avatar0: {
              author: {
                user: null
              }
            }
          }
        }
      })
    );
    const failed = await loadGitHubCommitAuthorAvatars(
      { ...repository, host: 'github.test-error.example' },
      candidates,
      undefined,
      async () => {
        throw new Error('offline');
      }
    );

    expect(noUser).toEqual(new Map());
    expect(failed).toEqual(new Map());
  });
});
