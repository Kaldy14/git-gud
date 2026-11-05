import { describe, expect, it } from 'vitest';

import type { GitRepositoryOverview } from '@shared/types';

import {
  SAVED_IN_STASHES_NOTE,
  createLocalResetPlan,
  isPullBlockedByLocalChanges,
  parsePullBlockedFiles,
  resolvePullFailure,
  resolveStashedOperationFailure,
  stashAndPullDialogItems,
  withSavedInStashesNote,
  type PullRecovery
} from './pullRecovery';

const overwrittenByMerge = [
  'error: Your local changes to the following files would be overwritten by merge:',
  '\tapps/dispatch-v2/src/server/phase3/runtime-projection-store.ts',
  '\tapps/dispatch-v2/src/server/phase3/runtime.ts',
  'Please commit your changes or stash them before you merge.',
  'Aborting'
].join('\n');

const context: PullRecovery = {
  repoPath: '/repos/robot',
  repoName: 'robot',
  branchName: 'main',
  upstream: 'origin/main',
  mode: 'ff-only'
};

function overview(input: { head?: string; isDirty?: boolean; ahead?: number; isDetached?: boolean } = {}): GitRepositoryOverview {
  return {
    status: {
      branch: { head: input.head ?? 'main', ahead: 0, behind: 0, isDetached: input.isDetached ?? false },
      isDirty: input.isDirty ?? false
    },
    refs: { localBranches: [{ name: 'main', ahead: input.ahead ?? 0 }] }
  } as unknown as GitRepositoryOverview;
}

describe('isPullBlockedByLocalChanges', () => {
  it.each([
    overwrittenByMerge,
    'error: The following untracked working tree files would be overwritten by merge:\n\tnew.ts\nPlease move or remove them before you merge.',
    'error: Your local changes to the following files would be overwritten by checkout:\n\ta.ts',
    'error: cannot rebase: You have unstaged changes.',
    'error: cannot pull with rebase: Your index contains uncommitted changes.'
  ])('recognizes %s', (message) => {
    expect(isPullBlockedByLocalChanges(message)).toBe(true);
  });

  it.each([
    'fatal: unable to access remote: Could not resolve host',
    'Pull fast-forward is blocked because the current branch has diverged from its upstream.',
    'Pull is blocked because it would overwrite ignored path dist. Move or remove the colliding path first.',
    'Branch changed before the operation started. Expected main, but dev is checked out.',
    `${overwrittenByMerge}\nYour local changes are saved in Stashes and have not been reapplied.`
  ])('ignores %s', (message) => {
    expect(isPullBlockedByLocalChanges(message)).toBe(false);
  });
});

describe('parsePullBlockedFiles', () => {
  it('reads tracked and untracked lists without the surrounding advice', () => {
    expect(parsePullBlockedFiles(`${overwrittenByMerge}\nerror: The following untracked working tree files would be overwritten by merge:\n\tnew.ts\nAborting`)).toEqual([
      'apps/dispatch-v2/src/server/phase3/runtime-projection-store.ts',
      'apps/dispatch-v2/src/server/phase3/runtime.ts',
      'new.ts'
    ]);
  });
});

describe('resolvePullFailure', () => {
  it('keeps the captured context on a persistent card with a readable summary', () => {
    expect(resolvePullFailure(overwrittenByMerge, context)).toEqual({
      summary: 'main in robot was not updated. Local changes to 2 files would be overwritten.',
      persistent: true,
      recovery: context
    });
  });

  it('names a single blocked file', () => {
    const message = 'error: Your local changes to the following files would be overwritten by merge:\n\ta.ts\nAborting';

    expect(resolvePullFailure(message, context)?.summary).toContain('Local changes to a.ts would');
  });

  it('leaves unrelated failures alone', () => {
    expect(resolvePullFailure('fatal: Authentication failed', context)).toBeUndefined();
  });
});

describe('stashed operation outcomes', () => {
  it('keeps the stash location after a failure past the stash', () => {
    expect(
      resolveStashedOperationFailure('merge failed\nYour local changes are saved in Stashes and have not been reapplied.')
    ).toEqual({ summary: SAVED_IN_STASHES_NOTE, persistent: true });
  });

  it('does not claim a stash when the retry failed first, and offers no recovery', () => {
    const state = resolveStashedOperationFailure('fatal: unable to access remote');

    expect(state.summary).toContain('were not stashed');
    expect(state.persistent).toBe(true);
    expect(state.recovery).toBeUndefined();
  });

  it('adds the stash note once', () => {
    expect(withSavedInStashesNote(undefined)).toBe(SAVED_IN_STASHES_NOTE);
    expect(withSavedInStashesNote('Conflicts in a.ts')).toBe(`Conflicts in a.ts\n${SAVED_IN_STASHES_NOTE}`);
    expect(withSavedInStashesNote('Your local changes are saved in Stashes. Apply them when you are ready.')).toBe(
      'Your local changes are saved in Stashes. Apply them when you are ready.'
    );
  });

  it('explains what the stash saves and that nothing is reapplied', () => {
    const items = stashAndPullDialogItems(context).join(' ');

    expect(items).toContain('staged, unstaged, and untracked');
    expect(items).toContain('Stashes');
    expect(items).toContain('origin/main');
    expect(items).toContain('not reapplied automatically');
  });
});

describe('createLocalResetPlan', () => {
  const names = { repoName: 'robot', localName: 'main', remoteName: 'origin/main' };

  it('stashes first for a dirty current branch and counts local commits', () => {
    const plan = createLocalResetPlan({ ...names, overview: overview({ isDirty: true, ahead: 2 }) });

    expect(plan.stashChanges).toBe(true);
    expect(plan.confirmLabel).toBe('Stash and Reset');
    expect(plan.title).toBe('Reset main to origin/main?');
    expect(plan.description).toContain('robot');
    expect(plan.detailItems.join(' ')).toContain('2 local commits will leave main');
    expect(plan.detailItems.join(' ')).toContain('Stashes');
  });

  it('keeps the clean-only reset for a clean branch', () => {
    const plan = createLocalResetPlan({ ...names, overview: overview({ ahead: 1 }) });

    expect(plan.stashChanges).toBe(false);
    expect(plan.confirmLabel).toBe('Reset Local to Remote');
    expect(plan.detailItems.join(' ')).toContain('1 local commit will leave main');
  });

  it('never stashes for a branch that is not checked out', () => {
    const plan = createLocalResetPlan({ ...names, overview: overview({ head: 'dev', isDirty: true }) });

    expect(plan.stashChanges).toBe(false);
    expect(plan.detailItems.join(' ')).toContain('Commit or stash your changes first');
  });

  it('never stashes on a detached HEAD', () => {
    expect(createLocalResetPlan({ ...names, overview: overview({ isDetached: true, isDirty: true }) }).stashChanges).toBe(false);
  });

  it('trusts the blocked pull when no overview is cached, and the overview when it is', () => {
    expect(createLocalResetPlan({ ...names, assumeDirtyCurrent: true }).stashChanges).toBe(true);
    expect(createLocalResetPlan({ ...names, overview: overview(), assumeDirtyCurrent: true }).stashChanges).toBe(false);
    expect(createLocalResetPlan(names).stashChanges).toBe(false);
  });
});
