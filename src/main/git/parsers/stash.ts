import type { GitStashEntry } from '@shared/types';

const STASH_FIELD_COUNT = 5;

export function parseStashList(output: string): GitStashEntry[] {
  const tokens = output
    .split('\0')
    .map((token) => token.replace(/^\n+|\n+$/g, ''))
    .filter((token) => token.length > 0);
  const stashes: GitStashEntry[] = [];

  for (let index = 0; index + STASH_FIELD_COUNT - 1 < tokens.length; index += STASH_FIELD_COUNT) {
    const [sha, parents, selector, date, subject] = tokens.slice(index, index + STASH_FIELD_COUNT);

    stashes.push({
      sha,
      parentShas: parents ? parents.split(' ').filter(Boolean) : [],
      selector,
      date: date || undefined,
      subject
    });
  }

  return stashes;
}
