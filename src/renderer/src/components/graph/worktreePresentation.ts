import type { GraphWorktree } from '@shared/types';

export type WipWorktreePresentation = {
  identity: string;
  chip?: {
    label: string;
    location: string;
  };
};

export function describeWipWorktree(worktree: GraphWorktree): WipWorktreePresentation {
  const worktreeName = worktree.branch ?? worktreeDisplayName(worktree);

  if (worktree.current) {
    return {
      identity: worktree.branch
        ? `local changes on ${worktree.branch}`
        : 'local changes in the current working directory'
    };
  }

  return {
    identity: `linked worktree ${worktreeName}`,
    chip: {
      label: worktreeName,
      location: 'Linked worktree'
    }
  };
}

function worktreeDisplayName(worktree: GraphWorktree): string {
  return worktree.path.split(/[\\/]/).filter(Boolean).at(-1) ?? worktree.path;
}
