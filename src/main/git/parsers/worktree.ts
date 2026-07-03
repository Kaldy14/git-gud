import type { GitWorktree } from '@shared/types';

export function parseWorktreeList(output: string, currentRepoPath: string): GitWorktree[] {
  const records: GitWorktree[] = [];
  let current: Partial<GitWorktree> | undefined;

  for (const token of output.split('\0')) {
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
        path: token.slice('worktree '.length),
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

  return records.sort((a, b) => Number(b.current) - Number(a.current) || a.path.localeCompare(b.path));
}

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
