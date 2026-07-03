import type { GitStashEntry } from '@shared/types';

const STASH_FIELD_COUNT = 5;

export function parseStashList(output: string): GitStashEntry[] {
  const tokens = output.split('\0').map((token) => token.replace(/^\n+|\n+$/g, ''));

  if (tokens[tokens.length - 1] === '' && tokens.length % STASH_FIELD_COUNT === 1) {
    tokens.pop();
  }

  const stashes: GitStashEntry[] = [];

  for (let index = 0; index + STASH_FIELD_COUNT - 1 < tokens.length; index += STASH_FIELD_COUNT) {
    const fields = tokens.slice(index, index + STASH_FIELD_COUNT);
    const sha = fields[0] ?? '';

    if (!sha) {
      continue;
    }

    const parents = fields[1] ?? '';
    const selector = fields[2] ?? '';
    const date = fields[3] ?? '';
    const subject = fields[4] ?? '';

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
