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
import { gitCommandLabel } from './commands/registry';
import { clearRebaseEditorState, createRebaseContinuationEnv } from './commands/rebase';
import { GitCommandError, type GitCommandResult, gitExecutor } from './exec';
import { loadConflictState } from './conflicts';
import { loadRemotes, loadStatus } from './repositoryOverview';
import { consumeUndoEntry, loadUndoEntry, recordUndoEntry } from './undo';

type OperationTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

type ConflictAwareMutationResult = {
  result: GitCommandResult;
  conflictState: GitConflictState;
};

export async function fetchRepository(tab: OperationTab): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  await gitExecutor.run(['fetch', '--prune', '--all'], { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab, env, gitCommandLabel('fetch'));
}

export async function pullRepository(tab: OperationTab, input: GitPullInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const args = input.mode === 'rebase' ? ['pull', '--rebase'] : ['pull', '--ff-only'];
  const { conflictState } = await runMutationAllowingConflicts(tab, args, env);
  return createOperationResult(tab, env, input.mode === 'rebase' ? 'Pull with rebase' : 'Pull fast-forward', undefined, conflictState);
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
  return createOperationResult(tab, env, input.forceWithLease ? 'Push with lease' : 'Push');
}

export async function createBranch(tab: OperationTab, input: GitCreateBranchInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const branchName = normalizeRequiredName(input.name, 'Branch name');
  const startPoint = input.startPoint?.trim() || 'HEAD';
  await assertValidBranchName(tab.path, branchName, env);

  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  const branchBefore = await currentBranchName(tab.path, env);
  await gitExecutor.run(['branch', branchName, startPoint], { cwd: tab.path, kind: 'mutation', env });

  if (input.checkout) {
    await gitExecutor.run(['checkout', branchName], { cwd: tab.path, kind: 'mutation', env });
  }

  const targetSha = await revParseOptional(tab.path, `refs/heads/${branchName}`, env);
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const branchAfter = await currentBranchName(tab.path, env);
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

  return createOperationResult(tab, env, input.checkout ? `Create and checkout ${branchName}` : `Create branch ${branchName}`, undoEntry);
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

  return createOperationResult(tab, env, `Rename branch ${oldName} to ${newName}`, undoEntry);
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

  return createOperationResult(tab, env, `Delete branch ${branchName}`, undoEntry);
}

export async function checkoutRef(tab: OperationTab, target: GitCheckoutTarget): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  const branchBefore = await currentBranchName(tab.path, env);
  const args = checkoutArgs(target);
  await gitExecutor.run(args, { cwd: tab.path, kind: 'mutation', env });
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const branchAfter = await currentBranchName(tab.path, env);
  const shouldRecordUndo = Boolean(headBefore && headAfter && (headBefore !== headAfter || branchBefore !== branchAfter));
  const undoEntry = shouldRecordUndo
    ? recordUndo(tab, 'checkout', 'Undo checkout', {
        headBefore,
        headAfter,
        branchBefore,
        branchAfter
      })
    : undefined;

  return createOperationResult(tab, env, `Checkout ${checkoutTargetLabel(target)}`, undoEntry);
}

export async function mergeRef(tab: OperationTab, input: GitMergeInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const ref = normalizeRequiredName(input.ref, 'Merge ref');
  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  const { conflictState } = await runMutationAllowingConflicts(tab, ['merge', '--no-edit', ref], env);
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const undoEntry =
    !conflictState.isActive && headBefore && headAfter && headBefore !== headAfter
      ? recordUndo(tab, 'merge', `Undo merge ${ref}`, {
          headBefore,
          headAfter
        })
      : undefined;

  return createOperationResult(tab, env, `Merge ${ref}`, undoEntry, conflictState);
}

export async function createTag(tab: OperationTab, input: GitTagCreateInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const tagName = normalizeRequiredName(input.name, 'Tag name');
  const target = input.targetSha?.trim() || 'HEAD';
  const targetSha = await revParse(tab.path, target, env);

  await gitExecutor.run(['tag', tagName, targetSha], { cwd: tab.path, kind: 'mutation', env });
  const undoEntry = recordUndo(tab, 'tag-create', `Undo create tag ${tagName}`, {
    refName: tagName,
    targetSha
  });

  return createOperationResult(tab, env, `Create tag ${tagName}`, undoEntry);
}

export async function deleteTag(tab: OperationTab, input: GitTagDeleteInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const tagName = normalizeRequiredName(input.name, 'Tag name');
  const targetSha = await revParse(tab.path, `refs/tags/${tagName}`, env);

  await gitExecutor.run(['tag', '-d', tagName], { cwd: tab.path, kind: 'mutation', env });
  const undoEntry = recordUndo(tab, 'tag-delete', `Undo delete tag ${tagName}`, {
    refName: tagName,
    targetSha
  });

  return createOperationResult(tab, env, `Delete tag ${tagName}`, undoEntry);
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
  return createOperationResult(tab, env, 'Stash changes');
}

export async function stashApply(tab: OperationTab, input: GitStashRefInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selector = normalizeRequiredName(input.selector, 'Stash selector');
  const { conflictState } = await runMutationAllowingConflicts(tab, ['stash', 'apply', selector], env);
  return createOperationResult(tab, env, `Apply ${selector}`, undefined, conflictState);
}

export async function stashPop(tab: OperationTab, input: GitStashRefInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selector = normalizeRequiredName(input.selector, 'Stash selector');
  const { conflictState } = await runMutationAllowingConflicts(tab, ['stash', 'pop', selector], env);
  return createOperationResult(tab, env, `Pop ${selector}`, undefined, conflictState);
}

export async function stashDrop(tab: OperationTab, input: GitStashRefInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selector = normalizeRequiredName(input.selector, 'Stash selector');
  await gitExecutor.run(['stash', 'drop', selector], { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab, env, `Drop ${selector}`);
}

export async function cherryPickCommit(tab: OperationTab, sha: string): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const targetSha = normalizeRequiredName(sha, 'Commit SHA');
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

  return createOperationResult(tab, env, `Cherry-pick ${targetSha.slice(0, 8)}`, undoEntry, conflictState);
}

export async function revertCommit(tab: OperationTab, sha: string): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const targetSha = normalizeRequiredName(sha, 'Commit SHA');
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

  return createOperationResult(tab, env, `Revert ${targetSha.slice(0, 8)}`, undoEntry, conflictState);
}

export async function resetToCommit(tab: OperationTab, input: GitResetInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const target = normalizeRequiredName(input.target, 'Reset target');
  const headBefore = await revParseOptional(tab.path, 'HEAD', env);
  await gitExecutor.run(['reset', `--${input.mode}`, target], { cwd: tab.path, kind: 'mutation', env });
  const headAfter = await revParseOptional(tab.path, 'HEAD', env);
  const undoEntry =
    headBefore && headAfter && headBefore !== headAfter
      ? recordUndo(tab, 'reset', `Undo reset ${input.mode} to ${target.slice(0, 8)}`, {
          headBefore,
          headAfter,
          resetMode: input.mode
        })
      : undefined;

  return createOperationResult(tab, env, `Reset ${input.mode} to ${target.slice(0, 8)}`, undoEntry);
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

  const args = conflictActionArgs(conflictState.operation, input.action);
  const commandEnv = conflictState.operation === 'rebase' ? await createRebaseContinuationEnv(tab.path, env) : env;

  await gitExecutor.run(args, { cwd: tab.path, kind: 'mutation', env: commandEnv });

  const resolvedConflictState = await loadConflictState(tab.path, commandEnv);

  if (conflictState.operation === 'rebase' && (input.action === 'abort' || !resolvedConflictState.isActive)) {
    await clearRebaseEditorState(tab.path, env);
  }

  return createOperationResult(tab, env, `${capitalize(input.action)} ${conflictState.operation}`, undefined, resolvedConflictState);
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

  await runUndoCommand(undoEntry, env);
  consumeUndoEntry(tab.path, undoId);
  return createOperationResult(tab, env, undoEntry.label);
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

async function runUndoCommand(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  switch (entry.operation) {
    case 'commit':
    case 'amend':
      await runUndoCommit(entry, env);
      return;
    case 'branch-create':
      await runUndoBranchCreate(entry, env);
      return;
    case 'branch-delete':
      await runUndoBranchDelete(entry, env);
      return;
    case 'branch-rename':
      await runUndoBranchRename(entry, env);
      return;
    case 'checkout':
      await runUndoCheckout(entry, env);
      return;
    case 'merge':
      await runUndoMerge(entry, env);
      return;
    case 'reset':
      await runUndoReset(entry, env);
      return;
    case 'tag-create':
      await runUndoTagCreate(entry, env);
      return;
    case 'tag-delete':
      await runUndoTagDelete(entry, env);
  }
}

async function runUndoCommit(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the previous HEAD.');
  }

  await gitExecutor.run(['reset', '--soft', entry.headBefore], { cwd: entry.repoPath, kind: 'mutation', env });
}

async function runUndoBranchCreate(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.refName) {
    throw new Error('Undo metadata is missing the branch name.');
  }

  const currentBranch = await currentBranchName(entry.repoPath, env);

  if (currentBranch === entry.refName) {
    await checkoutPreviousHead(entry, env);
  }

  await gitExecutor.run(['branch', '-D', entry.refName], { cwd: entry.repoPath, kind: 'mutation', env });
}

async function runUndoBranchDelete(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.refName || !entry.targetSha) {
    throw new Error('Undo metadata is missing the deleted branch.');
  }

  await gitExecutor.run(['branch', entry.refName, entry.targetSha], { cwd: entry.repoPath, kind: 'mutation', env });

  if (entry.upstream) {
    await gitExecutor.run(['branch', '--set-upstream-to', entry.upstream, entry.refName], {
      cwd: entry.repoPath,
      kind: 'mutation',
      env
    });
  }
}

async function runUndoBranchRename(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.refName || !entry.refNameAfter) {
    throw new Error('Undo metadata is missing the renamed branch.');
  }

  await gitExecutor.run(['branch', '-m', entry.refNameAfter, entry.refName], { cwd: entry.repoPath, kind: 'mutation', env });
}

async function runUndoCheckout(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  await checkoutPreviousHead(entry, env);
}

async function runUndoMerge(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the pre-merge HEAD.');
  }

  await gitExecutor.run(['reset', '--merge', entry.headBefore], { cwd: entry.repoPath, kind: 'mutation', env });
}

async function runUndoReset(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.headBefore) {
    throw new Error('Undo metadata is missing the pre-reset HEAD.');
  }

  await gitExecutor.run(['reset', `--${entry.resetMode ?? 'mixed'}`, entry.headBefore], {
    cwd: entry.repoPath,
    kind: 'mutation',
    env
  });
}

async function runUndoTagCreate(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.refName) {
    throw new Error('Undo metadata is missing the tag name.');
  }

  await gitExecutor.run(['tag', '-d', entry.refName], { cwd: entry.repoPath, kind: 'mutation', env });
}

async function runUndoTagDelete(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  if (!entry.refName || !entry.targetSha) {
    throw new Error('Undo metadata is missing the deleted tag.');
  }

  await gitExecutor.run(['tag', entry.refName, entry.targetSha], { cwd: entry.repoPath, kind: 'mutation', env });
}

async function checkoutPreviousHead(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  const target = entry.branchBefore ?? entry.headBefore;

  if (!target) {
    throw new Error('Undo metadata is missing the previous checkout target.');
  }

  await gitExecutor.run(['checkout', target], { cwd: entry.repoPath, kind: 'mutation', env });
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
    return ['checkout', normalizeRequiredName(target.name, 'Branch name')];
  }

  if (target.kind === 'remote') {
    const remoteName = normalizeRequiredName(target.name, 'Remote branch name');
    const localName = target.localName?.trim();

    if (localName) {
      return ['checkout', '-b', localName, '--track', remoteName];
    }

    return ['checkout', '--track', remoteName];
  }

  return ['checkout', normalizeRequiredName(target.sha, 'Commit SHA')];
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
  const status = await loadStatus(repoPath, env);
  return status.branch.isDetached ? undefined : status.branch.head;
}

async function branchUpstream(repoPath: string, branchName: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  const result = await gitExecutor.run(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branchName}`], {
    cwd: repoPath,
    env
  });
  return result.stdout.trim() || undefined;
}

async function assertValidBranchName(repoPath: string, branchName: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  await gitExecutor.run(['check-ref-format', '--branch', branchName], { cwd: repoPath, env });
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
  label: string,
  undoEntry?: GitUndoEntry,
  conflictState?: GitConflictState
): Promise<GitOperationResult> {
  const resolvedConflictState = conflictState ?? (await loadConflictState(tab.path, env));

  return {
    repoPath: tab.path,
    happenedAt: new Date().toISOString(),
    operation: {
      id: randomUUID(),
      label,
      status: resolvedConflictState.isActive ? 'conflicted' : 'completed',
      message: resolvedConflictState.message
    },
    undoEntry,
    conflictState: resolvedConflictState
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
