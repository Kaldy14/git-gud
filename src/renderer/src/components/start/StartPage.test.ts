import { describe, expect, it } from 'vitest';

import {
  cloneDirectoryNameFromSource,
  filterRecentRepositories,
  githubCloneUrl
} from './startPageHelpers';

describe('repository start page helpers', () => {
  it('filters recent repositories by name or path without changing their order', () => {
    const repositories = [
      {
        name: 'git-gud',
        path: '/Users/richie/Projects/git-gud',
        lastOpenedAt: '2026-07-25T10:00:00.000Z'
      },
      {
        name: 'website',
        path: '/Users/richie/Clients/acme',
        lastOpenedAt: '2026-07-24T10:00:00.000Z'
      }
    ];

    expect(filterRecentRepositories(repositories, 'GUD')).toEqual([repositories[0]]);
    expect(filterRecentRepositories(repositories, 'clients')).toEqual([repositories[1]]);
    expect(filterRecentRepositories(repositories, '  ')).toEqual(repositories);
  });

  it('normalizes supported GitHub repository inputs to HTTPS clone URLs', () => {
    expect(githubCloneUrl('openai/openai-node')).toBe('https://github.com/openai/openai-node.git');
    expect(githubCloneUrl('https://github.com/openai/openai-node.git')).toBe(
      'https://github.com/openai/openai-node.git'
    );
    expect(githubCloneUrl('git@github.com:openai/openai-node.git')).toBe(
      'https://github.com/openai/openai-node.git'
    );
    expect(githubCloneUrl('https://gitlab.com/openai/openai-node')).toBeUndefined();
    expect(githubCloneUrl('not-a-repository')).toBeUndefined();
  });

  it('infers a clone folder name from common Git sources', () => {
    expect(cloneDirectoryNameFromSource('https://github.com/openai/openai-node.git')).toBe(
      'openai-node'
    );
    expect(cloneDirectoryNameFromSource('/tmp/local-source')).toBe('local-source');
    expect(cloneDirectoryNameFromSource(undefined)).toBe('');
  });
});
