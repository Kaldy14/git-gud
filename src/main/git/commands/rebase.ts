import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  GitConflictState,
  GitInteractiveRebaseAction,
  GitInteractiveRebaseCommit,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitInteractiveRebaseTodoItem,
  GitOperationResult,
  GitRebaseInput,
  RepoTab
} from '@shared/types';

import { createProfileCommandEnv } from '../../profiles';
import { loadConflictState } from '../conflicts';
import { type GitCommandResult, gitExecutor } from '../exec';
import { loadStatus } from '../repositoryOverview';

type RebaseTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

type ConflictAwareMutationResult = {
  result: GitCommandResult;
  conflictState: GitConflictState;
};

type RebaseEditorState = {
  tempDir: string;
};

type RebaseEditorFiles = RebaseEditorState & {
  sequenceEditorPath: string;
  messageEditorPath: string;
  todoPath: string;
  rewordMessagesPath: string;
  rewordIndexPath: string;
};

type ValidatedTodoItem = GitInteractiveRebaseTodoItem & {
  subject: string;
  message: string;
};

const unitSeparator = '\x1f';
const recordSeparator = '\x1e';
const rebaseStatePathName = 'git-gud-rebase-state.json';

export async function rebaseOnto(tab: RebaseTab, input: GitRebaseInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const target = normalizeRequiredName(input.target, 'Rebase target');
  const { conflictState } = await runMutationAllowingConflicts(tab, ['rebase', target], env);
  return createOperationResult(tab, env, `Rebase onto ${target.slice(0, 8)}`, conflictState);
}

export async function prepareInteractiveRebasePlan(tab: RebaseTab, base: string): Promise<GitInteractiveRebasePlan> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const normalizedBase = normalizeRequiredName(base, 'Interactive rebase base');
  const status = await loadStatus(tab.path, env);

  if (status.branch.isDetached) {
    throw new Error('Interactive rebase requires a checked-out branch.');
  }

  await assertBaseIsAncestor(tab.path, normalizedBase, env);

  const [baseSha, headSha, commits] = await Promise.all([
    revParse(tab.path, normalizedBase, env),
    revParse(tab.path, 'HEAD', env),
    loadInteractiveRebaseCommits(tab.path, normalizedBase, env)
  ]);

  if (commits.length === 0) {
    throw new Error('There are no commits after this base to replay.');
  }

  return {
    repoPath: tab.path,
    base: baseSha,
    baseShortSha: baseSha.slice(0, 8),
    branchName: status.branch.head,
    headSha,
    commits,
    loadedAt: new Date().toISOString()
  };
}

export async function runInteractiveRebase(tab: RebaseTab, input: GitInteractiveRebaseInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const plan = await prepareInteractiveRebasePlan(tab, input.base);
  const todo = validateInteractiveRebaseTodo(input.commits, plan);
  const editorFiles = await createRebaseEditorFiles(todo);

  await writeRebaseEditorState(tab.path, editorFiles, env);

  try {
    const rebaseEnv = createRebaseEditorEnv(env, editorFiles);
    const { conflictState } = await runMutationAllowingConflicts(tab, ['rebase', '-i', plan.base], rebaseEnv);

    if (!conflictState.isActive) {
      await clearRebaseEditorState(tab.path, env);
    }

    return createOperationResult(tab, env, `Interactive rebase from ${plan.baseShortSha}`, conflictState);
  } catch (error) {
    await clearRebaseEditorState(tab.path, env);
    throw error;
  }
}

export async function createRebaseContinuationEnv(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<NodeJS.ProcessEnv | undefined> {
  const editorState = await readRebaseEditorState(repoPath, env);

  if (!editorState) {
    return {
      ...env,
      GIT_EDITOR: 'true'
    };
  }

  const editorFiles = rebaseEditorFilesFromState(editorState);
  return createRebaseEditorEnv(env, editorFiles);
}

export async function clearRebaseEditorState(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  const state = await readRebaseEditorState(repoPath, env);
  const statePath = await rebaseStatePath(repoPath, env);

  await unlinkIfExists(statePath);

  if (state) {
    await rm(state.tempDir, { recursive: true, force: true });
  }
}

async function loadInteractiveRebaseCommits(
  repoPath: string,
  base: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitInteractiveRebaseCommit[]> {
  const result = await gitExecutor.run(
    ['log', '--reverse', `--format=%H%x1f%s%x1f%B%x1e`, `${base}..HEAD`],
    { cwd: repoPath, env }
  );
  const commits: GitInteractiveRebaseCommit[] = [];

  for (const rawRecord of result.stdout.split(recordSeparator)) {
    const record = rawRecord.replace(/^\n+/, '');

    if (!record.trim()) {
      continue;
    }

    const firstSeparator = record.indexOf(unitSeparator);
    const secondSeparator = record.indexOf(unitSeparator, firstSeparator + 1);

    if (firstSeparator === -1 || secondSeparator === -1) {
      continue;
    }

    const sha = record.slice(0, firstSeparator).trim();
    const subject = record.slice(firstSeparator + 1, secondSeparator).trim() || '(no subject)';
    const message = record.slice(secondSeparator + 1).trimEnd() || subject;

    commits.push({
      sha,
      shortSha: sha.slice(0, 8),
      subject,
      message
    });
  }

  return commits;
}

function validateInteractiveRebaseTodo(
  inputItems: GitInteractiveRebaseTodoItem[],
  plan: GitInteractiveRebasePlan
): ValidatedTodoItem[] {
  if (inputItems.length !== plan.commits.length) {
    throw new Error('Interactive rebase todo must include every replayed commit exactly once.');
  }

  const commitsBySha = new Map(plan.commits.map((commit) => [commit.sha, commit]));
  const seenShas = new Set<string>();
  const validated: ValidatedTodoItem[] = [];

  for (const item of inputItems) {
    const commit = commitsBySha.get(item.sha);

    if (!commit) {
      throw new Error(`Commit ${item.sha.slice(0, 8)} is not part of this rebase plan.`);
    }

    if (seenShas.has(item.sha)) {
      throw new Error(`Commit ${item.sha.slice(0, 8)} appears more than once in the rebase todo.`);
    }

    seenShas.add(item.sha);
    validated.push({
      sha: item.sha,
      action: validateInteractiveRebaseAction(item.action),
      subject: commit.subject,
      message: item.action === 'reword' ? normalizeRewordMessage(item.message, commit.message) : commit.message
    });
  }

  const firstReplayedCommit = validated.find((item) => item.action !== 'drop');

  if (firstReplayedCommit && (firstReplayedCommit.action === 'squash' || firstReplayedCommit.action === 'fixup')) {
    throw new Error('The first replayed commit cannot be squash or fixup.');
  }

  return validated;
}

function validateInteractiveRebaseAction(action: GitInteractiveRebaseAction): GitInteractiveRebaseAction {
  if (action === 'pick' || action === 'reword' || action === 'squash' || action === 'fixup' || action === 'drop') {
    return action;
  }

  throw new Error('Interactive rebase action is invalid.');
}

async function createRebaseEditorFiles(todo: ValidatedTodoItem[]): Promise<RebaseEditorFiles> {
  const tempDir = join(tmpdir(), `git-gud-rebase-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const editorFiles = rebaseEditorFilesFromState({ tempDir });
  const todoContents = todo.map((item) => `${item.action} ${item.sha} ${formatTodoSubject(item.subject)}`).join('\n');
  const rewordMessages = todo.filter((item) => item.action === 'reword').map((item) => `${item.message.trim()}\n`);

  await Promise.all([
    writeFile(editorFiles.sequenceEditorPath, sequenceEditorScript(), { mode: 0o700 }),
    writeFile(editorFiles.messageEditorPath, messageEditorScript(), { mode: 0o700 }),
    writeFile(editorFiles.todoPath, `${todoContents}\n`),
    writeFile(editorFiles.rewordMessagesPath, JSON.stringify(rewordMessages)),
    writeFile(editorFiles.rewordIndexPath, '0')
  ]);

  return editorFiles;
}

function rebaseEditorFilesFromState(state: RebaseEditorState): RebaseEditorFiles {
  return {
    tempDir: state.tempDir,
    sequenceEditorPath: join(state.tempDir, 'sequence-editor.cjs'),
    messageEditorPath: join(state.tempDir, 'message-editor.cjs'),
    todoPath: join(state.tempDir, 'git-rebase-todo'),
    rewordMessagesPath: join(state.tempDir, 'reword-messages.json'),
    rewordIndexPath: join(state.tempDir, 'reword-index')
  };
}

function createRebaseEditorEnv(
  env: NodeJS.ProcessEnv | undefined,
  editorFiles: RebaseEditorFiles
): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_SEQUENCE_EDITOR: createNodeScriptCommand(editorFiles.sequenceEditorPath),
    GIT_EDITOR: createNodeScriptCommand(editorFiles.messageEditorPath),
    GIT_GUD_SEQUENCE_TODO: editorFiles.todoPath,
    GIT_GUD_REWORD_MESSAGES: editorFiles.rewordMessagesPath,
    GIT_GUD_REWORD_INDEX: editorFiles.rewordIndexPath
  };
}

async function runMutationAllowingConflicts(
  tab: RebaseTab,
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

async function writeRebaseEditorState(
  repoPath: string,
  state: RebaseEditorState,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  await writeFile(await rebaseStatePath(repoPath, env), JSON.stringify(state));
}

async function readRebaseEditorState(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<RebaseEditorState | undefined> {
  try {
    const rawState = await readFile(await rebaseStatePath(repoPath, env), 'utf8');
    const parsedState = JSON.parse(rawState) as Partial<RebaseEditorState>;

    if (typeof parsedState.tempDir === 'string' && parsedState.tempDir.length > 0) {
      return {
        tempDir: parsedState.tempDir
      };
    }

    return undefined;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function rebaseStatePath(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<string> {
  const result = await gitExecutor.run(['rev-parse', '--git-path', rebaseStatePathName], { cwd: repoPath, env });
  return resolve(repoPath, result.stdout.trim());
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function assertBaseIsAncestor(repoPath: string, base: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  const result = await gitExecutor.run(['merge-base', '--is-ancestor', base, 'HEAD'], {
    cwd: repoPath,
    env,
    allowedExitCodes: [1]
  });

  if (result.exitCode !== 0) {
    throw new Error('Interactive rebase base must be an ancestor of HEAD.');
  }
}

async function revParse(repoPath: string, rev: string, env: NodeJS.ProcessEnv | undefined): Promise<string> {
  const result = await gitExecutor.run(['rev-parse', '--verify', rev], { cwd: repoPath, env });
  const sha = result.stdout.trim();

  if (!sha) {
    throw new Error(`${rev} did not resolve to a commit.`);
  }

  return sha;
}

async function createOperationResult(
  tab: RebaseTab,
  env: NodeJS.ProcessEnv | undefined,
  label: string,
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

function normalizeRewordMessage(message: string | undefined, fallback: string): string {
  const normalized = message?.trim() || fallback.trim();

  if (!normalized) {
    throw new Error('Reworded commit message cannot be empty.');
  }

  return normalized;
}

function formatTodoSubject(subject: string): string {
  return subject.replace(/\s+/g, ' ').trim() || '(no subject)';
}

function createNodeScriptCommand(scriptPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(scriptPath)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sequenceEditorScript(): string {
  return `const { copyFileSync } = require('node:fs');

const todoPath = process.argv[2];
const sourcePath = process.env.GIT_GUD_SEQUENCE_TODO;

if (!todoPath || !sourcePath) {
  console.error('git-gud sequence editor is missing the todo path.');
  process.exit(2);
}

copyFileSync(sourcePath, todoPath);
`;
}

function messageEditorScript(): string {
  return `const { readFileSync, writeFileSync } = require('node:fs');

const messagePath = process.argv[2];
const messagesPath = process.env.GIT_GUD_REWORD_MESSAGES;
const indexPath = process.env.GIT_GUD_REWORD_INDEX;

if (!messagePath || !messagesPath || !indexPath) {
  process.exit(0);
}

const currentMessage = readFileSync(messagePath, 'utf8');

if (!/^#\\s+reword\\s+[0-9a-f]+/m.test(currentMessage)) {
  process.exit(0);
}

const messages = JSON.parse(readFileSync(messagesPath, 'utf8'));
const currentIndex = Number.parseInt(readFileSync(indexPath, 'utf8'), 10) || 0;
const nextMessage = messages[currentIndex];

if (typeof nextMessage === 'string' && nextMessage.trim()) {
  writeFileSync(messagePath, nextMessage.endsWith('\\n') ? nextMessage : nextMessage + '\\n');
  writeFileSync(indexPath, String(currentIndex + 1));
}
`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
