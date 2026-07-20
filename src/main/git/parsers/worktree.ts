import type { GitWorktree } from '@shared/types';

export function parseWorktreeList(output: string, currentRepoPath: string): GitWorktree[] {
  const records: GitWorktree[] = [];
  const nullDelimited = output.includes('\0');
  let current: Partial<GitWorktree> | undefined;

  for (const rawToken of output.split(nullDelimited ? '\0' : '\n')) {
    const token = rawToken.endsWith('\r') ? rawToken.slice(0, -1) : rawToken;

    if (!token) {
      if (current?.path) {
        records.push(finalizeWorktree(current, currentRepoPath));
        current = undefined;
      }

      continue;
    }

    if (token.startsWith('worktree ')) {
      if (current?.path) {
        records.push(finalizeWorktree(current, currentRepoPath));
      }

      current = {
        path: parseWorktreePath(token.slice('worktree '.length), nullDelimited),
        detached: false,
        bare: false,
        current: false
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (token.startsWith('HEAD ')) {
      current.head = token.slice('HEAD '.length);
      continue;
    }

    if (token.startsWith('branch ')) {
      current.branch = token.slice('branch '.length).replace(/^refs\/heads\//, '');
      continue;
    }

    if (token === 'detached') {
      current.detached = true;
      continue;
    }

    if (token === 'bare') {
      current.bare = true;
    }
  }

  if (current?.path) {
    records.push(finalizeWorktree(current, currentRepoPath));
  }

  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function parseWorktreePath(path: string, nullDelimited: boolean): string {
  if (nullDelimited || !path.startsWith('"') || !path.endsWith('"')) {
    return path;
  }

  const bytes: number[] = [];

  for (let index = 1; index < path.length - 1; index += 1) {
    const character = String.fromCodePoint(path.codePointAt(index) ?? 0);

    if (character !== '\\') {
      bytes.push(...Buffer.from(character));
      index += character.length - 1;
      continue;
    }

    const escaped = path[index + 1];
    const escapeValue = escaped ? ESCAPED_BYTES[escaped] : undefined;

    if (escapeValue !== undefined) {
      bytes.push(escapeValue);
      index += 1;
      continue;
    }

    const octal = path.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];

    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    if (escaped) {
      bytes.push(...Buffer.from(escaped));
      index += 1;
    }
  }

  return Buffer.from(bytes).toString('utf8');
}

const ESCAPED_BYTES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  '\\': 0x5c
};

function finalizeWorktree(worktree: Partial<GitWorktree>, currentRepoPath: string): GitWorktree {
  return {
    path: worktree.path ?? currentRepoPath,
    head: worktree.head,
    branch: worktree.branch,
    detached: Boolean(worktree.detached),
    bare: Boolean(worktree.bare),
    current: worktree.path === currentRepoPath
  };
}
