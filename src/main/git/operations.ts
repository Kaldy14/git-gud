import { randomUUID } from 'node:crypto';

import type {
  GitCheckoutTarget,
  GitConflictActionInput,
  GitConflictState,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitMergeInput,
  GitOperationResult,
  GitPullInput,
  GitPushInput,
  GitRenameBranchInput,
  GitResetInput,
  GitStashPushInput,
  GitStashRefInput,
  GitTagCreateInput,
  GitTagDeleteInput,
  GitUndoEntry,
  GitUndoOperation,
  RepoTab
} from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { GIT_COMMANDS, gitCommandLabel, type GitCommandId } from './commands/registry';
import {
  assertNoIgnoredUntrackedRebaseContinuationCollisions,
  clearRebaseEditorState,
  createRebaseContinuationEnv,
  rebaseOnto
} from './commands/rebase';
import { GitCommandError, type GitCommandResult, gitExecutor } from './exec';
import { loadConflictState } from './conflicts';
import { loadRemotes, loadStatus } from './repositoryOverview';
import { consumeUndoEntry, loadUndoEntry, recordUndoEntry } from './undo';

type OperationTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

type ConflictAwareMutationResult = {
  result: GitCommandResult;
  conflictState: GitConflictState;
};

const ZERO_SHA = '0000000000000000000000000000000000000000';

export async function fetchRepository(tab: OperationTab): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  await gitExecutor.run(['fetch', '--prune', '--all'], { cwd: tab.path, kind: 'mutation', env, cancellable: true });
  return createOperationResult(tab, env, 'fetch', gitCommandLabel('fetch'));
}

export async function pullRepository(tab: OperationTab, input: GitPullInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);

  return gitExecutor.transaction(tab.path, async () => {
    await gitExecutor.run(['fetch'], { cwd: tab.path, kind: 'mutation', env });
    const upstreamCommit = await resolvePullUpstream(tab.path, env);

    if (input.mode === 'rebase') {
      await assertNoIgnoredTreeCollisions(tab.path, upstreamCommit, env, 'Pull with rebase');
      const result = await rebaseOnto(tab, { target: upstreamCommit });
      return createOperationResult(tab, env, 'pull', 'Pull with rebase', undefined, result.conflictState);
    }

    const headCommit = await revParseOptional(tab.path, 'HEAD^{commit}', env);

    if (headCommit && headCommit !== upstreamCommit) {
      await assertCommitIsAncestor(
        tab.path,
        headCommit,
        upstreamCommit,
        env,
        'Pull fast-forward is blocked because the current branch has diverged from its upstream.'
      );
    }

    await assertNoIgnoredTreeCollisions(tab.path, upstreamCommit, env, 'Pull fast-forward');

    if (headCommit !== upstreamCommit) {
      await gitExecutor.run(['merge', '--ff-only', upstreamCommit], { cwd: tab.path, kind: 'mutation', env });
    }

    return createOperationResult(tab, env, 'pull', 'Pull fast-forward');
  });
}

export async function pushRepository(tab: OperationTab, input: GitPushInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadStatus(tab.path, env);
  const args = ['push'];

  if (input.forceWithLease) {
    args.push('--force-with-lease');
  }

  if (!status.branch.isDetached && !status.branch.upstream) {
    const remotes = await loadRemotes(tab.path, env);
    const remote = remotes.find((candidate) => candidate.name === 'origin') ?? remotes[0];

    if (remote) {
      args.push('-u', remote.name, status.branch.head);
    }
  }

  await gitExecutor.run(args, { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab, env, 'push', input.forceWithLease ? 'Push with lease' : 'Push');
}

export async function createBranch(tab: OperationTab, input: GitCreateBranchInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const branchName = normalizeRequiredName(input.name, 'Branch name');
  const startPoint = input.startPoint?.trim() || 'HEAD';
  await assertValidBranchName(tab.path, branchName, env);
  const startCommit = await revParse(tab.path, `${startPoint}^{commit}`, env);
  const [headBefore, branchBefore] = await Promise.all([
    revParseOptional(tab.path, 'HEAD', env),
    currentBranchName(tab.path, env)
  ]);
  const createArgs = input.checkout
    ? ['checkout', '--no-overwrite-ignore', '-b', branchName, startCommit]
    : ['branch', branchName, startCommit];
  await gitExecutor.run(createArgs, { cwd: tab.path, kind: 'mutation', env });

  const [targetSha, headAfter, branchAfter] = await Promise.all([
    revParseOptional(tab.path, `refs/heads/${branchName}`, env),
    revParseOptional(tab.path, 'HEAD', env),
    currentBranchName(tab.path, env)
  ]);
  const undoEntry = targetSha
    ? recordUndo(
        tab,
        'branch-create',
        `Undo create branch ${branchName}`,
        {
          refName: branchName,
          targetSha,
          headBefore,
          headAfter,
          branchBefore,
          branchAfter
        }
      )
    : undefined;

  return createOperationResult(
    tab,
    env,
    'branch-create',
    input.checkout ? `Create and checkout ${branchName}` : `Create branch ${branchName}`,
    undoEntry
  );
}

export async function renameBranch(tab: OperationTab, input: GitRenameBranchInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const oldName = normalizeRequiredName(input.oldName, 'Old branch name');
  const newName = normalizeRequiredName(input.newName, 'New branch name');
  await assertValidBranchName(tab.path, newName, env);

  const targetSha = await revParse(tab.path, `refs/heads/${oldName}`, env);
  await gitExecutor.run(['branch', '-m', oldName, newName], { cwd: tab.path, kind: 'mutation', env });
  const undoEntry = recordUndo(tab, 'branch-rename', `Undo rename branch ${newName}`, {
    refName: oldName,
    refNameAfter: newName,
    targetSha
  });

  return createOperationResult(tab, env, 'branch-rename', `Rename branch ${oldName} to ${newName}`, undoEntry);
}

export async function deleteBranch(tab: OperationTab, input: GitDeleteBranchInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const branchName = normalizeRequiredName(input.name, 'Branch name');
  const targetSha = await revParse(tab.path, `refs/heads/${branchName}`, env);
  const upstream = await branchUpstream(tab.path, branchName, env);
  await gitExecutor.run(['branch', input.force ? '-D' : '-d', branchName], { cwd: tab.path, kind: 'mutation', env });
  const undoEntry = recordUndo(tab, 'branch-delete', `Undo delete branch ${branchName}`, {
    refName: branchName,
    ...(upstream ? { upstream } : {}),
    targetSha
  });

  return createOperationResult(tab, env, 'branch-delete', `Delete branch ${branchName}`, undoEntry);
}

export async function checkoutRef(tab: OperationTab, target: GitCheckoutTarget): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const [headBefore, branchBefore] = await Promise.all([
    revParseOptional(tab.path, 'HEAD', env),
    currentBranchName(tab.path, env)
  ]);
  const args = checkoutArgs(target);
  await gitExecutor.run(args, { cwd: tab.path, kind: 'mutation', env });
  const [headAfter, branchAfter] = await Promise.all([
    revParseOptional(tab.path, 'HEAD', env),
    currentBranchName(tab.path, env)
  ]);
  const shouldRecordUndo = Boolean(headBefore && headAfter && (headBefore !== headAfter || branchBefore !== branchAfter));
  const undoEntry = shouldRecordUndo
    ? recordUndo(tab, 'checkout', 'Undo checkout', {
        headBefore,
        headAfter,
        branchBefore,
        branchAfter
      })
    : undefined;

  return createOperationResult(tab, env, 'checkout', `Checkout ${checkoutTargetLabel(target)}`, undoEntry);
}

export async function mergeRef(tab: OperationTab, input: GitMergeInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const ref = normalizeRequiredName(input.ref, 'Merge ref');
  await assertNoIgnoredMergeCollisions(tab.path, ref, env, `Merge ${ref}`);
  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  const { conflictState } = await runMutationAllowingConflicts(tab, ['merge', '--no-edit', ref], env);
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const undoEntry =
    !conflictState.isActive && headBefore && headAfter && headBefore !== headAfter
      ? recordUndo(tab, 'merge', `Undo merge ${ref}`, {
          headBefore,
          headAfter,
          affectedRefs: ['HEAD'],
          warning: 'Undo moves the current branch back before this merge and is disabled after the merge is published.'
        })
      : undefined;

  return createOperationResult(tab, env, 'merge', `Merge ${ref}`, undoEntry, conflictState);
}

export async function createTag(tab: OperationTab, input: GitTagCreateInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const tagName = normalizeRequiredName(input.name, 'Tag name');
  const target = input.targetSha?.trim() || 'HEAD';
  await assertValidTagName(tab.path, tagName, env);
  const targetSha = await revParse(tab.path, target, env);
  const tagRef = `refs/tags/${tagName}`;

  await gitExecutor.run(['update-ref', tagRef, targetSha, ZERO_SHA], { cwd: tab.path, kind: 'mutation', env });
  const createdTarget = await revParse(tab.path, tagRef, env);

  if (createdTarget !== targetSha) {
    throw new Error(`Tag ${tagName} was not created at the requested target.`);
  }

  const undoEntry = recordUndo(tab, 'tag-create', `Undo create tag ${tagName}`, {
    refName: tagName,
    targetSha,
    affectedRefs: [tagRef]
  });

  return createOperationResult(tab, env, 'tag-create', `Create tag ${tagName}`, undoEntry);
}

export async function deleteTag(tab: OperationTab, input: GitTagDeleteInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const tagName = normalizeRequiredName(input.name, 'Tag name');
  await assertValidTagName(tab.path, tagName, env);
  const tagRef = `refs/tags/${tagName}`;
  const targetSha = await revParse(tab.path, tagRef, env);

  await gitExecutor.run(['update-ref', '-d', tagRef, targetSha], { cwd: tab.path, kind: 'mutation', env });

  if (await revParseOptional(tab.path, tagRef, env)) {
    throw new Error(`Tag ${tagName} was not deleted.`);
  }

  const undoEntry = recordUndo(tab, 'tag-delete', `Undo delete tag ${tagName}`, {
    refName: tagName,
    targetSha,
    affectedRefs: [tagRef]
  });

  return createOperationResult(tab, env, 'tag-delete', `Delete tag ${tagName}`, undoEntry);
}

export async function stashPush(tab: OperationTab, input: GitStashPushInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const args = ['stash', 'push'];

  if (input.includeUntracked) {
    args.push('--include-untracked');
  }

  if (input.message?.trim()) {
    args.push('-m', input.message.trim());
  }

  await gitExecutor.run(args, { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab, env, 'stash-push', 'Stash changes');
}

export async function stashApply(tab: OperationTab, input: GitStashRefInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selector = normalizeRequiredName(input.selector, 'Stash selector');
  await assertStashSelectorMatches(tab.path, selector, input.expectedSha, env);
  await assertNoIgnoredPathCollisions(tab.path, await stashWritePaths(tab.path, selector, env), env, `Apply ${selector}`);
  const { conflictState } = await runMutationAllowingConflicts(tab, ['stash', 'apply', selector], env);
  return createOperationResult(tab, env, 'stash-apply', `Apply ${selector}`, undefined, conflictState);
}

export async function stashPop(tab: OperationTab, input: GitStashRefInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selector = normalizeRequiredName(input.selector, 'Stash selector');
  await assertStashSelectorMatches(tab.path, selector, input.expectedSha, env);
  await assertNoIgnoredPathCollisions(tab.path, await stashWritePaths(tab.path, selector, env), env, `Pop ${selector}`);
  const { conflictState } = await runMutationAllowingConflicts(tab, ['stash', 'pop', selector], env);
  return createOperationResult(tab, env, 'stash-pop', `Pop ${selector}`, undefined, conflictState);
}

export async function stashDrop(tab: OperationTab, input: GitStashRefInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selector = normalizeRequiredName(input.selector, 'Stash selector');
  await assertStashSelectorMatches(tab.path, selector, input.expectedSha, env);
  await gitExecutor.run(['stash', 'drop', selector], { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab, env, 'stash-drop', `Drop ${selector}`);
}

export async function cherryPickCommit(tab: OperationTab, sha: string): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const targetSha = normalizeRequiredName(sha, 'Commit SHA');
  await assertNoIgnoredPathCollisions(
    tab.path,
    await commitWritePaths(tab.path, targetSha, 'apply', env),
    env,
    `Cherry-pick ${targetSha.slice(0, 8)}`
  );
  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  const { conflictState } = await runMutationAllowingConflicts(tab, ['cherry-pick', targetSha], env);
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const undoEntry =
    !conflictState.isActive && headBefore && headAfter && headBefore !== headAfter
      ? recordUndo(tab, 'commit', `Undo cherry-pick ${targetSha.slice(0, 8)}`, {
          headBefore,
          headAfter
        })
      : undefined;

  return createOperationResult(tab, env, 'cherry-pick', `Cherry-pick ${targetSha.slice(0, 8)}`, undoEntry, conflictState);
}

export async function revertCommit(tab: OperationTab, sha: string): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const targetSha = normalizeRequiredName(sha, 'Commit SHA');
  await assertNoIgnoredPathCollisions(
    tab.path,
    await commitWritePaths(tab.path, targetSha, 'revert', env),
    env,
    `Revert ${targetSha.slice(0, 8)}`
  );
  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  const { conflictState } = await runMutationAllowingConflicts(tab, ['revert', '--no-edit', targetSha], env);
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const undoEntry =
    !conflictState.isActive && headBefore && headAfter && headBefore !== headAfter
      ? recordUndo(tab, 'commit', `Undo revert ${targetSha.slice(0, 8)}`, {
          headBefore,
          headAfter
        })
      : undefined;

  return createOperationResult(tab, env, 'revert', `Revert ${targetSha.slice(0, 8)}`, undoEntry, conflictState);
}

export async function resetToCommit(tab: OperationTab, input: GitResetInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const target = normalizeRequiredName(input.target, 'Reset target');

  if (input.mode === 'hard') {
    await assertCleanWorktreeAndIndex(
      tab.path,
      env,
      'Hard reset is blocked while the repository has index or working-tree changes. Stash or commit them first.'
    );
    await assertNoIgnoredTreeCollisions(tab.path, target, env, `Hard reset to ${target.slice(0, 8)}`);
  }

  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  await gitExecutor.run(['reset', `--${input.mode}`, target], { cwd: tab.path, kind: 'mutation', env });
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const undoEntry =
    headBefore && headAfter && headBefore !== headAfter
      ? recordUndo(tab, 'reset', `Undo reset ${input.mode} to ${target.slice(0, 8)}`, {
          headBefore,
          headAfter,
          resetMode: input.mode,
          affectedRefs: ['HEAD'],
          warning:
            input.mode === 'hard'
              ? 'Undo uses a hard reset and is only available while the index and working tree remain clean.'
              : 'Undo moves HEAD and restores the previous reset mode.'
        })
      : undefined;

  return createOperationResult(tab, env, 'reset', `Reset ${input.mode} to ${target.slice(0, 8)}`, undoEntry);
}

export async function resolveConflict(tab: OperationTab, input: GitConflictActionInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const conflictState = await loadConflictState(tab.path, env);

  if (!conflictState.operation) {
    throw new Error('No merge, rebase, cherry-pick, or revert operation is in progress.');
  }

  if (input.action === 'skip' && !conflictState.canSkip) {
    throw new Error(`${conflictState.operation} cannot be skipped.`);
  }

  if (conflictState.operation === 'rebase' && input.action !== 'abort') {
    await assertNoIgnoredUntrackedRebaseContinuationCollisions(tab.path, env);
  }

  const args = conflictActionArgs(conflictState.operation, input.action);
  const commandEnv =
    conflictState.operation === 'rebase' && input.action !== 'abort'
      ? await createRebaseContinuationEnv(tab.path, env)
      : conflictState.operation === 'merge' && input.action === 'continue'
        ? { ...env, GIT_EDITOR: 'true' }
        : env;

  await gitExecutor.run(args, { cwd: tab.path, kind: 'mutation', env: commandEnv });

  const resolvedConflictState = await loadConflictState(tab.path, commandEnv);

  if (conflictState.operation === 'rebase' && input.action === 'abort') {
    // Git already restored the branch; stale auxiliary editor state must not turn a successful abort into a failure.
    await clearRebaseEditorState(tab.path, env).catch(() => undefined);
  } else if (conflictState.operation === 'rebase' && !resolvedConflictState.isActive) {
    await clearRebaseEditorState(tab.path, env);
  }

  return createOperationResult(
    tab,
    env,
    'conflict-resolve',
    `${capitalize(input.action)} ${conflictState.operation}`,
    undefined,
    resolvedConflictState
  );
}

export async function undoOperation(tab: OperationTab, undoId: string): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const undoEntry = await loadUndoEntry(tab.path, undoId, env);

  if (!undoEntry) {
    throw new Error('Undo entry was not found.');
  }

  if (undoEntry.staleReason) {
    throw new Error(undoEntry.staleReason);
  }

  await runUndoCommand(tab.path, undoEntry, env);
  consumeUndoEntry(tab.path, undoId);
  return createOperationResult(tab, env, 'undo', undoEntry.label);
}

export function createUndoEntryForCommit(
  tab: OperationTab,
  operation: Extract<GitUndoOperation, 'commit' | 'amend'>,
  label: string,
  headBefore: string | undefined,
  headAfter: string | undefined
): GitUndoEntry | undefined {
  if (!headBefore || !headAfter || headBefore === headAfter) {
    return undefined;
  }

  return recordUndo(tab, operation, label, {
    headBefore,
    headAfter
  });
}

export async function getCurrentHead(repoPath: string, env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  return revParseOptional(repoPath, 'HEAD', env);
}

async function runUndoCommand(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  switch (entry.operation) {
    case 'commit':
    case 'amend':
      await runUndoCommit(repoPath, entry, env);
      return;
    case 'branch-create':
      await runUndoBranchCreate(repoPath, entry, env);
      return;
    case 'branch-delete':
      await runUndoBranchDelete(repoPath, entry, env);
      return;
    case 'branch-rename':
      await runUndoBranchRename(repoPath, entry, env);
      return;
    case 'checkout':
      await runUndoCheckout(repoPath, entry, env);
      return;
    case 'merge':
      await runUndoMerge(repoPath, entry, env);
      return;
    case 'reset':
      await runUndoReset(repoPath, entry, env);
      return;
    case 'tag-create':
      await runUndoTagCreate(repoPath, entry, env);
      return;
    case 'tag-delete':
      await runUndoTagDelete(repoPath, entry, env);
  }
}

async function runUndoCommit(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the previous HEAD.');
  }

  await gitExecutor.run(['reset', '--soft', entry.headBefore], { cwd: repoPath, kind: 'mutation', env });
}

async function runUndoBranchCreate(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.refName) {
    throw new Error('Undo metadata is missing the branch name.');
  }

  const currentBranch = await currentBranchName(repoPath, env);

  if (currentBranch === entry.refName) {
    await checkoutPreviousHead(repoPath, entry, env);
  }

  await gitExecutor.run(['branch', '-D', entry.refName], { cwd: repoPath, kind: 'mutation', env });
}

async function runUndoBranchDelete(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.refName || !entry.targetSha) {
    throw new Error('Undo metadata is missing the deleted branch.');
  }

  await gitExecutor.run(['branch', entry.refName, entry.targetSha], { cwd: repoPath, kind: 'mutation', env });

  if (entry.upstream) {
    await gitExecutor.run(['branch', '--set-upstream-to', entry.upstream, entry.refName], {
      cwd: repoPath,
      kind: 'mutation',
      env
    });
  }
}

async function runUndoBranchRename(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.refName || !entry.refNameAfter) {
    throw new Error('Undo metadata is missing the renamed branch.');
  }

  await gitExecutor.run(['branch', '-m', entry.refNameAfter, entry.refName], { cwd: repoPath, kind: 'mutation', env });
}

async function runUndoCheckout(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  await checkoutPreviousHead(repoPath, entry, env);
}

async function runUndoMerge(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the pre-merge HEAD.');
  }

  await assertNoIgnoredTreeCollisions(repoPath, entry.headBefore, env, 'Undo merge');
  await gitExecutor.run(['reset', '--merge', entry.headBefore], { cwd: repoPath, kind: 'mutation', env });
}

async function runUndoReset(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the pre-reset HEAD.');
  }

  if (entry.resetMode === 'hard') {
    await assertCleanWorktreeAndIndex(
      repoPath,
      env,
      'Undo hard reset is blocked because the index or working tree changed after the reset.'
    );
    await assertNoIgnoredTreeCollisions(repoPath, entry.headBefore, env, 'Undo hard reset');
  }

  await gitExecutor.run(['reset', `--${entry.resetMode ?? 'mixed'}`, entry.headBefore], {
    cwd: repoPath,
    kind: 'mutation',
    env
  });
}

async function runUndoTagCreate(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.refName || !entry.targetSha) {
    throw new Error('Undo metadata is missing the tag name.');
  }

  await gitExecutor.run(['update-ref', '-d', `refs/tags/${entry.refName}`, entry.targetSha], {
    cwd: repoPath,
    kind: 'mutation',
    env
  });
}

async function runUndoTagDelete(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.refName || !entry.targetSha) {
    throw new Error('Undo metadata is missing the deleted tag.');
  }

  await gitExecutor.run(['update-ref', `refs/tags/${entry.refName}`, entry.targetSha, ZERO_SHA], {
    cwd: repoPath,
    kind: 'mutation',
    env
  });
}

async function checkoutPreviousHead(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the previous checkout target.');
  }

  const previousBranchHead = entry.branchBefore
    ? await revParseOptional(repoPath, `refs/heads/${entry.branchBefore}`, env)
    : undefined;
  const target = entry.branchBefore && previousBranchHead === entry.headBefore ? entry.branchBefore : entry.headBefore;

  await gitExecutor.run(['checkout', '--no-overwrite-ignore', target], { cwd: repoPath, kind: 'mutation', env });
}

async function runMutationAllowingConflicts(
  tab: OperationTab,
  args: string[],
  env: NodeJS.ProcessEnv | undefined
): Promise<ConflictAwareMutationResult> {
  const result = await gitExecutor.run(args, {
    cwd: tab.path,
    kind: 'mutation',
    env,
    allowedExitCodes: [1]
  });
  const conflictState = await loadConflictState(tab.path, env);

  if (result.exitCode !== 0 && !conflictState.isActive) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed with exit code ${result.exitCode}`);
  }

  return {
    result,
    conflictState
  };
}

function checkoutArgs(target: GitCheckoutTarget): string[] {
  if (target.kind === 'local') {
    return ['checkout', '--no-overwrite-ignore', normalizeRequiredName(target.name, 'Branch name')];
  }

  if (target.kind === 'remote') {
    const remoteName = normalizeRequiredName(target.name, 'Remote branch name');
    const localName = target.localName?.trim();

    if (localName) {
      return ['checkout', '--no-overwrite-ignore', '-b', localName, '--track', remoteName];
    }

    return ['checkout', '--no-overwrite-ignore', '--track', remoteName];
  }

  return ['checkout', '--no-overwrite-ignore', normalizeRequiredName(target.sha, 'Commit SHA')];
}

function checkoutTargetLabel(target: GitCheckoutTarget): string {
  if (target.kind === 'local') {
    return target.name;
  }

  if (target.kind === 'remote') {
    return target.localName ? `${target.localName} tracking ${target.name}` : target.name;
  }

  return target.sha.slice(0, 8);
}

function conflictActionArgs(operation: NonNullable<GitConflictState['operation']>, action: GitConflictActionInput['action']): string[] {
  if (operation === 'merge') {
    return ['merge', action === 'abort' ? '--abort' : '--continue'];
  }

  if (operation === 'rebase') {
    return ['rebase', `--${action}`];
  }

  if (operation === 'cherry-pick') {
    return ['cherry-pick', `--${action}`];
  }

  if (operation === 'revert') {
    return ['revert', `--${action}`];
  }

  throw new Error('Unknown conflict operation.');
}

async function currentBranchName(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  const result = await gitExecutor.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: repoPath,
    env,
    allowedExitCodes: [1]
  });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function branchUpstream(repoPath: string, branchName: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  const result = await gitExecutor.run(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branchName}`], {
    cwd: repoPath,
    env
  });
  return result.stdout.trim() || undefined;
}

async function resolvePullUpstream(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<string> {
  const status = await loadStatus(repoPath, env);

  if (status.branch.isDetached) {
    throw new Error('Pull requires a checked-out branch.');
  }

  if (!status.branch.upstream) {
    throw new Error(`Branch ${status.branch.head} has no upstream. Set an upstream before pulling.`);
  }

  return revParse(repoPath, '@{upstream}^{commit}', env);
}

async function assertValidBranchName(repoPath: string, branchName: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  await gitExecutor.run(['check-ref-format', '--branch', branchName], { cwd: repoPath, env });
}

async function assertValidTagName(repoPath: string, tagName: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (tagName.startsWith('-')) {
    throw new Error('Tag name cannot start with a dash.');
  }

  await gitExecutor.run(['check-ref-format', `refs/tags/${tagName}`], { cwd: repoPath, env });
}

async function assertCleanWorktreeAndIndex(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined,
  message: string
): Promise<void> {
  const result = await gitExecutor.run(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
    cwd: repoPath,
    env
  });

  if (result.stdout.length > 0) {
    throw new Error(message);
  }
}

async function assertNoIgnoredTreeCollisions(
  repoPath: string,
  targetRevision: string,
  env: NodeJS.ProcessEnv | undefined,
  operationLabel: string
): Promise<void> {
  const targetCommit = await revParse(repoPath, `${targetRevision}^{commit}`, env);
  const currentCommit = await revParseOptional(repoPath, 'HEAD^{commit}', env);
  const writePaths = currentCommit
    ? await diffWritePaths(repoPath, currentCommit, targetCommit, env)
    : await listTreePaths(repoPath, targetCommit, env);

  await assertNoIgnoredPathCollisions(repoPath, writePaths, env, operationLabel);
}

async function assertNoIgnoredMergeCollisions(
  repoPath: string,
  targetRevision: string,
  env: NodeJS.ProcessEnv | undefined,
  operationLabel: string
): Promise<void> {
  const targetCommit = await revParse(repoPath, `${targetRevision}^{commit}`, env);
  const currentCommit = await revParseOptional(repoPath, 'HEAD^{commit}', env);

  if (!currentCommit) {
    await assertNoIgnoredPathCollisions(repoPath, await listTreePaths(repoPath, targetCommit, env), env, operationLabel);
    return;
  }

  const mergeBase = await findMergeBase(repoPath, currentCommit, targetCommit, env);

  // A normal merge refuses unrelated histories before updating the working tree.
  if (!mergeBase) {
    return;
  }

  await assertNoIgnoredPathCollisions(
    repoPath,
    await diffWritePaths(repoPath, mergeBase, targetCommit, env),
    env,
    operationLabel
  );
}

async function assertNoIgnoredPathCollisions(
  repoPath: string,
  writePaths: string[],
  env: NodeJS.ProcessEnv | undefined,
  operationLabel: string
): Promise<void> {
  if (writePaths.length === 0) {
    return;
  }

  const ignoredResult = await gitExecutor.run(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], {
    cwd: repoPath,
    env
  });
  const ignoredPaths = parseNulPaths(ignoredResult.stdout);
  const collisions = ignoredPaths.filter((ignoredPath) =>
    writePaths.some((writePath) => pathsCollide(ignoredPath, writePath))
  );

  if (collisions.length === 0) {
    return;
  }

  const displayedPaths = collisions.slice(0, 3).map((path) => JSON.stringify(path)).join(', ');
  const remainder = collisions.length > 3 ? ` and ${collisions.length - 3} more` : '';
  throw new Error(
    `${operationLabel} is blocked because it would overwrite ignored ${collisions.length === 1 ? 'path' : 'paths'} ${displayedPaths}${remainder}. Move or remove the colliding path first.`
  );
}

async function diffWritePaths(
  repoPath: string,
  sourceCommit: string,
  targetCommit: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string[]> {
  const result = await gitExecutor.run(
    ['diff', '--name-only', '--no-renames', '--diff-filter=ACMRTUXB', '-z', sourceCommit, targetCommit, '--'],
    { cwd: repoPath, env }
  );
  return parseNulPaths(result.stdout);
}

async function listTreePaths(
  repoPath: string,
  targetCommit: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string[]> {
  const result = await gitExecutor.run(['ls-tree', '-r', '--name-only', '-z', targetCommit], { cwd: repoPath, env });
  return parseNulPaths(result.stdout);
}

async function findMergeBase(
  repoPath: string,
  leftCommit: string,
  rightCommit: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  const result = await gitExecutor.run(['merge-base', leftCommit, rightCommit], {
    cwd: repoPath,
    env,
    allowedExitCodes: [1]
  });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function assertCommitIsAncestor(
  repoPath: string,
  ancestor: string,
  descendant: string,
  env: NodeJS.ProcessEnv | undefined,
  message: string
): Promise<void> {
  const result = await gitExecutor.run(['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: repoPath,
    env,
    allowedExitCodes: [1]
  });

  if (result.exitCode !== 0) {
    throw new Error(message);
  }
}

async function commitWritePaths(
  repoPath: string,
  revision: string,
  direction: 'apply' | 'revert',
  env: NodeJS.ProcessEnv | undefined
): Promise<string[]> {
  const commit = await revParse(repoPath, `${revision}^{commit}`, env);
  const parentsResult = await gitExecutor.run(['rev-list', '--parents', '-n', '1', commit], { cwd: repoPath, env });
  const [, ...parents] = parentsResult.stdout.trim().split(/\s+/);

  // Git requires an explicit mainline to cherry-pick or revert a merge commit; these operations do not provide one.
  if (parents.length > 1) {
    return [];
  }

  const parent = parents[0];

  if (direction === 'apply') {
    return parent ? diffWritePaths(repoPath, parent, commit, env) : listTreePaths(repoPath, commit, env);
  }

  return parent ? diffWritePaths(repoPath, commit, parent, env) : [];
}

async function stashWritePaths(
  repoPath: string,
  selector: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string[]> {
  const result = await gitExecutor.run(
    ['stash', 'show', '--include-untracked', '--name-only', '--no-renames', '--diff-filter=ACMRTUXB', '-z', selector],
    { cwd: repoPath, env }
  );
  return parseNulPaths(result.stdout);
}

async function assertStashSelectorMatches(
  repoPath: string,
  selector: string,
  expectedShaInput: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  const expectedSha = normalizeRequiredName(expectedShaInput, 'Expected stash SHA');

  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(expectedSha)) {
    throw new Error('Expected stash SHA is invalid.');
  }

  const actualSha = await revParse(repoPath, `${selector}^{commit}`, env);

  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error(`${selector} changed since it was loaded. Refresh the repository and try again.`);
  }
}

function parseNulPaths(output: string): string[] {
  return output.split('\0').filter((path) => path.length > 0);
}

function pathsCollide(leftPath: string, rightPath: string): boolean {
  return leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`);
}

async function revParse(repoPath: string, rev: string, env: NodeJS.ProcessEnv | undefined): Promise<string> {
  const result = await gitExecutor.run(['rev-parse', '--verify', rev], { cwd: repoPath, env });
  const sha = result.stdout.trim();

  if (!sha) {
    throw new Error(`${rev} did not resolve to a commit.`);
  }

  return sha;
}

async function revParseOptional(repoPath: string, rev: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  try {
    return await revParse(repoPath, rev, env);
  } catch (error) {
    if (error instanceof GitCommandError) {
      return undefined;
    }

    throw error;
  }
}

function recordUndo(
  tab: OperationTab,
  operation: GitUndoOperation,
  label: string,
  details: Omit<GitUndoEntry, 'id' | 'repoPath' | 'operation' | 'label' | 'createdAt' | 'requiresConfirmation'>
): GitUndoEntry {
  return recordUndoEntry({
    id: randomUUID(),
    repoPath: tab.path,
    operation,
    label,
    createdAt: new Date().toISOString(),
    requiresConfirmation: true,
    ...details
  });
}

async function createOperationResult(
  tab: OperationTab,
  env: NodeJS.ProcessEnv | undefined,
  commandId: GitCommandId,
  label: string,
  undoEntry?: GitUndoEntry,
  conflictState?: GitConflictState
): Promise<GitOperationResult> {
  const resolvedConflictState =
    conflictState ??
    (GIT_COMMANDS[commandId].conflicts === 'none' ? undefined : await loadConflictState(tab.path, env));

  return {
    repoPath: tab.path,
    happenedAt: new Date().toISOString(),
    operation: {
      id: randomUUID(),
      label,
      status: resolvedConflictState?.isActive ? 'conflicted' : 'completed',
      message: resolvedConflictState?.message
    },
    undoEntry,
    ...(resolvedConflictState ? { conflictState: resolvedConflictState } : {}),
    invalidates: [...GIT_COMMANDS[commandId].invalidates]
  };
}

function normalizeRequiredName(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
