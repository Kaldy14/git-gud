import type { GitQueryInvalidation } from '@shared/types';

export type GitCommandId =
  | 'fetch'
  | 'remote-add'
  | 'remote-edit'
  | 'remote-remove'
  | 'pull'
  | 'push'
  | 'branch-create'
  | 'branch-rename'
  | 'branch-set-upstream'
  | 'branch-delete'
  | 'checkout'
  | 'merge'
  | 'tag-create'
  | 'tag-push'
  | 'tag-delete'
  | 'stash-push'
  | 'stash-apply'
  | 'stash-pop'
  | 'stash-drop'
  | 'cherry-pick'
  | 'revert'
  | 'reset'
  | 'rebase'
  | 'interactive-rebase'
  | 'conflict-resolve'
  | 'undo';

export type GitCommandConflictStrategy = 'none' | 'detect-after-run' | 'continue-skip-abort';

export type GitCommandDescriptor = {
  defaultLabel: string;
  conflicts: GitCommandConflictStrategy;
  invalidates: readonly GitQueryInvalidation[];
};

const allMutableRepositoryQueries = ['overview', 'graph', 'wip-detail', 'file-diff', 'review-plan'] as const;

export const GIT_COMMANDS = {
  fetch: command('Fetch', 'none', ['overview', 'graph']),
  'remote-add': command('Add remote', 'none', ['overview', 'graph']),
  'remote-edit': command('Edit remote', 'none', ['overview', 'graph']),
  'remote-remove': command('Remove remote', 'none', ['overview', 'graph']),
  pull: command('Pull', 'detect-after-run', allMutableRepositoryQueries),
  push: command('Push', 'none', ['overview']),
  'branch-create': command('Create branch', 'none', ['overview', 'graph']),
  'branch-rename': command('Rename branch', 'none', ['overview', 'graph']),
  'branch-set-upstream': command('Set upstream', 'none', ['overview']),
  'branch-delete': command('Delete branch', 'none', ['overview', 'graph']),
  checkout: command('Checkout', 'none', allMutableRepositoryQueries),
  merge: command('Merge', 'detect-after-run', allMutableRepositoryQueries),
  'tag-create': command('Create tag', 'none', ['overview', 'graph']),
  'tag-push': command('Push tag', 'none', ['overview']),
  'tag-delete': command('Delete tag', 'none', ['overview', 'graph']),
  'stash-push': command('Stash changes', 'none', allMutableRepositoryQueries),
  'stash-apply': command('Apply stash', 'detect-after-run', allMutableRepositoryQueries),
  'stash-pop': command('Pop stash', 'detect-after-run', allMutableRepositoryQueries),
  'stash-drop': command('Drop stash', 'none', ['overview', 'graph']),
  'cherry-pick': command('Cherry-pick', 'detect-after-run', allMutableRepositoryQueries),
  revert: command('Revert', 'detect-after-run', allMutableRepositoryQueries),
  reset: command('Reset', 'none', allMutableRepositoryQueries),
  rebase: command('Rebase', 'detect-after-run', allMutableRepositoryQueries),
  'interactive-rebase': command('Interactive rebase', 'detect-after-run', allMutableRepositoryQueries),
  'conflict-resolve': command('Resolve conflict', 'continue-skip-abort', allMutableRepositoryQueries),
  undo: command('Undo', 'none', allMutableRepositoryQueries)
} satisfies Record<GitCommandId, GitCommandDescriptor>;

export function gitCommandLabel(id: GitCommandId): string {
  return GIT_COMMANDS[id].defaultLabel;
}

function command(
  defaultLabel: string,
  conflicts: GitCommandConflictStrategy,
  invalidates: readonly GitQueryInvalidation[]
): GitCommandDescriptor {
  return {
    defaultLabel,
    conflicts,
    invalidates
  };
}
