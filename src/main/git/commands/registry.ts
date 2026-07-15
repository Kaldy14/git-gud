import type { GitQueryInvalidation } from '@shared/types';

export type GitCommandId =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'branch-create'
  | 'branch-rename'
  | 'branch-delete'
  | 'checkout'
  | 'merge'
  | 'tag-create'
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

export type GitCommandMutationScope = 'remote' | 'refs' | 'working-tree' | 'history' | 'conflict';
export type GitCommandUndoStrategy = 'none' | 'recorded' | 'conditional';
export type GitCommandConflictStrategy = 'none' | 'detect-after-run' | 'continue-skip-abort';

export type GitCommandDescriptor = {
  id: GitCommandId;
  defaultLabel: string;
  mutationScope: GitCommandMutationScope;
  undo: GitCommandUndoStrategy;
  conflicts: GitCommandConflictStrategy;
  invalidates: readonly GitQueryInvalidation[];
};

const allMutableRepositoryQueries = ['overview', 'graph', 'wip-detail', 'file-diff', 'review-plan'] as const;

export const GIT_COMMANDS = {
  fetch: command('fetch', 'Fetch', 'remote', 'none', 'none', ['overview', 'graph']),
  pull: command('pull', 'Pull', 'remote', 'none', 'detect-after-run', allMutableRepositoryQueries),
  push: command('push', 'Push', 'remote', 'none', 'none', ['overview']),
  'branch-create': command('branch-create', 'Create branch', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'branch-rename': command('branch-rename', 'Rename branch', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'branch-delete': command('branch-delete', 'Delete branch', 'refs', 'recorded', 'none', ['overview', 'graph']),
  checkout: command('checkout', 'Checkout', 'working-tree', 'conditional', 'none', allMutableRepositoryQueries),
  merge: command('merge', 'Merge', 'history', 'conditional', 'detect-after-run', allMutableRepositoryQueries),
  'tag-create': command('tag-create', 'Create tag', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'tag-delete': command('tag-delete', 'Delete tag', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'stash-push': command('stash-push', 'Stash changes', 'working-tree', 'none', 'none', allMutableRepositoryQueries),
  'stash-apply': command('stash-apply', 'Apply stash', 'working-tree', 'none', 'detect-after-run', allMutableRepositoryQueries),
  'stash-pop': command('stash-pop', 'Pop stash', 'working-tree', 'none', 'detect-after-run', allMutableRepositoryQueries),
  'stash-drop': command('stash-drop', 'Drop stash', 'refs', 'none', 'none', ['overview', 'graph']),
  'cherry-pick': command('cherry-pick', 'Cherry-pick', 'history', 'conditional', 'detect-after-run', allMutableRepositoryQueries),
  revert: command('revert', 'Revert', 'history', 'conditional', 'detect-after-run', allMutableRepositoryQueries),
  reset: command('reset', 'Reset', 'history', 'conditional', 'none', allMutableRepositoryQueries),
  rebase: command('rebase', 'Rebase', 'history', 'none', 'detect-after-run', allMutableRepositoryQueries),
  'interactive-rebase': command('interactive-rebase', 'Interactive rebase', 'history', 'none', 'detect-after-run', allMutableRepositoryQueries),
  'conflict-resolve': command('conflict-resolve', 'Resolve conflict', 'conflict', 'none', 'continue-skip-abort', allMutableRepositoryQueries),
  undo: command('undo', 'Undo', 'history', 'none', 'none', allMutableRepositoryQueries)
} satisfies Record<GitCommandId, GitCommandDescriptor>;

export function gitCommandLabel(id: GitCommandId): string {
  return GIT_COMMANDS[id].defaultLabel;
}

function command(
  id: GitCommandId,
  defaultLabel: string,
  mutationScope: GitCommandMutationScope,
  undo: GitCommandUndoStrategy,
  conflicts: GitCommandConflictStrategy,
  invalidates: readonly GitQueryInvalidation[]
): GitCommandDescriptor {
  return {
    id,
    defaultLabel,
    mutationScope,
    undo,
    conflicts,
    invalidates
  };
}
