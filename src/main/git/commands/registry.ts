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

export type GitCommandInvalidation = 'overview' | 'graph' | 'commit-detail' | 'wip-detail' | 'file-diff';
export type GitCommandMutationScope = 'remote' | 'refs' | 'working-tree' | 'history' | 'conflict';
export type GitCommandUndoStrategy = 'none' | 'recorded' | 'conditional';
export type GitCommandConflictStrategy = 'none' | 'detect-after-run' | 'continue-skip-abort';

export type GitCommandDescriptor = {
  id: GitCommandId;
  defaultLabel: string;
  mutationScope: GitCommandMutationScope;
  undo: GitCommandUndoStrategy;
  conflicts: GitCommandConflictStrategy;
  invalidates: readonly GitCommandInvalidation[];
};

const allRepositoryQueries = ['overview', 'graph', 'commit-detail', 'wip-detail', 'file-diff'] as const;

export const GIT_COMMANDS = {
  fetch: command('fetch', 'Fetch', 'remote', 'none', 'none', ['overview', 'graph']),
  pull: command('pull', 'Pull', 'remote', 'none', 'detect-after-run', allRepositoryQueries),
  push: command('push', 'Push', 'remote', 'none', 'none', ['overview']),
  'branch-create': command('branch-create', 'Create branch', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'branch-rename': command('branch-rename', 'Rename branch', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'branch-delete': command('branch-delete', 'Delete branch', 'refs', 'recorded', 'none', ['overview', 'graph']),
  checkout: command('checkout', 'Checkout', 'working-tree', 'conditional', 'none', allRepositoryQueries),
  merge: command('merge', 'Merge', 'history', 'conditional', 'detect-after-run', allRepositoryQueries),
  'tag-create': command('tag-create', 'Create tag', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'tag-delete': command('tag-delete', 'Delete tag', 'refs', 'recorded', 'none', ['overview', 'graph']),
  'stash-push': command('stash-push', 'Stash changes', 'working-tree', 'none', 'none', allRepositoryQueries),
  'stash-apply': command('stash-apply', 'Apply stash', 'working-tree', 'none', 'detect-after-run', allRepositoryQueries),
  'stash-pop': command('stash-pop', 'Pop stash', 'working-tree', 'none', 'detect-after-run', allRepositoryQueries),
  'stash-drop': command('stash-drop', 'Drop stash', 'refs', 'none', 'none', ['overview', 'graph']),
  'cherry-pick': command('cherry-pick', 'Cherry-pick', 'history', 'conditional', 'detect-after-run', allRepositoryQueries),
  revert: command('revert', 'Revert', 'history', 'conditional', 'detect-after-run', allRepositoryQueries),
  reset: command('reset', 'Reset', 'history', 'conditional', 'none', allRepositoryQueries),
  rebase: command('rebase', 'Rebase', 'history', 'none', 'detect-after-run', allRepositoryQueries),
  'interactive-rebase': command('interactive-rebase', 'Interactive rebase', 'history', 'none', 'detect-after-run', allRepositoryQueries),
  'conflict-resolve': command('conflict-resolve', 'Resolve conflict', 'conflict', 'none', 'continue-skip-abort', allRepositoryQueries),
  undo: command('undo', 'Undo', 'history', 'none', 'none', allRepositoryQueries)
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
  invalidates: readonly GitCommandInvalidation[]
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
