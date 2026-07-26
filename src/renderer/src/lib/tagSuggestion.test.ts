import { describe, expect, it } from 'vitest';

import type { GitTagRef } from '@shared/types';

import { suggestNextTagName } from './tagSuggestion';

describe('tag suggestion', () => {
  it.each([
    [['v1.4.3', 'v1.4.2', 'v1.4.1'], 'v1.4.4'],
    [['1.4.3', '1.4.2', '1.4.1'], '1.4.4'],
    [['v2026.7.3', 'v2026.7.2', 'v2026.7.1'], 'v2026.7.4'],
    [['release-2026-03', 'release-2026-02', 'release-2026-01'], 'release-2026-04'],
    [['build-0012', 'build-0011', 'build-0010'], 'build-0013'],
    [['v3.6.0', 'v3.4.0', 'v3.2.0'], 'v3.7.0'],
    [['v2026.7.7', 'v2026.7.5', 'v2026.7.2'], 'v2026.7.8'],
    [['deploy-42', 'deploy-39'], 'deploy-43']
  ])('increments the uniquely varying numeric part in %j', (names, expected) => {
    expect(suggestNextTagName(tags(names))).toBe(expected);
  });

  it('uses the repository natural tag ordering instead of incomparable Git creator dates', () => {
    expect(
      suggestNextTagName([
        tag('v2.1.8', '2026-07-01T08:00:00.000Z'),
        tag('v2.1.10', '2020-07-03T08:00:00.000Z'),
        tag('v2.1.9', '2026-07-02T08:00:00.000Z')
      ])
    ).toBe('v2.1.11');
  });

  it('can ignore an interleaved tag from a different naming family', () => {
    expect(
      suggestNextTagName([
        tag('v1.2.3', '2026-07-04T08:00:00.000Z'),
        tag('v1.2.2-beta.1', '2026-07-03T08:00:00.000Z'),
        tag('v1.2.2', '2026-07-02T08:00:00.000Z'),
        tag('v1.2.1', '2026-07-01T08:00:00.000Z')
      ])
    ).toBe('v1.2.4');
  });

  it('uses a stable locale when choosing between non-ASCII tag families', () => {
    expect(suggestNextTagName(tags(['ä-3', 'z-2', 'ä-2', 'z-3', 'ä-1', 'z-1']))).toBe('z-4');
  });

  it.each([
    ['only one matching tag', ['v1.0.2']],
    ['equally strong patch and minor families', ['v1.2.3', 'v1.2.2', 'v1.1.3']],
    ['multiple changing numeric parts without a stable family', ['v3.0.0', 'v2.1.0', 'v1.2.0']],
    ['tags without numbers', ['stable', 'preview', 'latest']]
  ])('does not guess from %s', (_reason, names) => {
    expect(suggestNextTagName(tags(names))).toBeUndefined();
  });
});

function tags(names: string[]): GitTagRef[] {
  return names.map((name) => tag(name));
}

function tag(name: string, date?: string): GitTagRef {
  return {
    name,
    fullName: `refs/tags/${name}`,
    sha: name.padEnd(40, '0').slice(0, 40),
    date
  };
}
