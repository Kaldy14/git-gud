import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

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
  nonce: string;
};

type RebaseEditorFiles = RebaseEditorState & {
  markerPath: string;
  sequenceEditorPath: string;
  messageEditorPath: string;
  todoPath: string;
  rewordMessagesPath: string;
};

type ValidatedTodoItem = GitInteractiveRebaseTodoItem & {
  subject: string;
  message: string;
};

const unitSeparator = '\x1f';
const recordSeparator = '\x1e';
const rebaseStatePathName = 'git-gud-rebase-state.json';
const rebaseDonePathName = 'rebase-merge/done';
const rebaseTodoPathName = 'rebase-merge/git-rebase-todo';
const rebaseEditorMarkerName = '.git-gud-rebase-editor';
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const rebaseTempDirNamePattern = new RegExp(`^git-gud-rebase-${uuidPattern}$`);
const noncePattern = new RegExp(`^${uuidPattern}$`);
const untrustedRebaseStateMessage = 'Stored interactive rebase editor state is untrusted.';

export async function rebaseOnto(tab: RebaseTab, input: GitRebaseInput): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const target = normalizeRequiredName(input.target, 'Rebase target');
  const targetCommit = await revParse(tab.path, `${target}^{commit}`, env);
  await assertNoIgnoredUntrackedTreeTransitionCollisions(tab.path, 'HEAD', targetCommit, env, 'the target tree');
  await assertNoIgnoredUntrackedReplayCollisionsForRange(tab.path, `${targetCommit}..HEAD`, env);
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
  await assertInteractiveRebaseRangeIsLinear(tab.path, normalizedBase, env);

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
  await assertNoIgnoredUntrackedTreeTransitionCollisions(tab.path, 'HEAD', plan.base, env, 'the rebase base tree');
  await assertNoIgnoredUntrackedReplayCollisionsForCommits(
    tab.path,
    todo.filter((item) => item.action !== 'drop').map((item) => item.sha),
    env
  );
  const [editorFiles, donePath] = await Promise.all([
    createRebaseEditorFiles(todo),
    gitPath(tab.path, rebaseDonePathName, env)
  ]);

  await writeRebaseEditorState(tab.path, editorFiles, env);

  try {
    const rebaseEnv = createRebaseEditorEnv(env, editorFiles, donePath);
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
  const donePath = await gitPath(repoPath, rebaseDonePathName, env);
  return createRebaseEditorEnv(env, editorFiles, donePath);
}

export async function assertNoIgnoredUntrackedRebaseContinuationCollisions(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  const todoPath = await gitPath(repoPath, rebaseTodoPathName, env);
  let todoContents: string;

  try {
    todoContents = await readFile(todoPath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error(
        'The remaining rebase commits cannot be inspected safely. Abort the rebase or protect ignored files before continuing in Terminal.',
        { cause: error }
      );
    }

    throw error;
  }

  await assertNoIgnoredUntrackedReplayCollisionsForCommits(repoPath, parseRemainingRebaseCommitShas(todoContents), env);
}

export async function clearRebaseEditorState(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  const statePath = await rebaseStatePath(repoPath, env);
  let state: RebaseEditorState | undefined;

  try {
    state = await readRebaseEditorState(repoPath, env);
  } catch (error) {
    await unlinkIfExists(statePath);
    throw error;
  }

  await unlinkIfExists(statePath);

  if (state) {
    await validateRebaseEditorState(state);
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

async function assertNoIgnoredUntrackedReplayCollisionsForRange(
  repoPath: string,
  range: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  const result = await gitExecutor.run(
    ['log', '--format=', '--name-only', '-z', '--diff-filter=ACMRTUXB', '--no-renames', '--no-merges', range, '--'],
    { cwd: repoPath, env }
  );
  await assertNoIgnoredUntrackedReplayCollisions(repoPath, parseNullSeparatedPaths(result.stdout), env);
}

async function assertNoIgnoredUntrackedTreeTransitionCollisions(
  repoPath: string,
  currentRevision: string,
  targetRevision: string,
  env: NodeJS.ProcessEnv | undefined,
  writeSource: string
): Promise<void> {
  const result = await gitExecutor.run(
    ['diff', '--name-only', '-z', '--diff-filter=ACMRTUXB', '--no-renames', currentRevision, targetRevision, '--'],
    { cwd: repoPath, env }
  );
  await assertNoIgnoredUntrackedReplayCollisions(repoPath, parseNullSeparatedPaths(result.stdout), env, writeSource);
}

async function assertNoIgnoredUntrackedReplayCollisionsForCommits(
  repoPath: string,
  commitShas: string[],
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  const writePaths = new Set<string>();
  const commitBatchSize = 256;

  for (let offset = 0; offset < commitShas.length; offset += commitBatchSize) {
    const commitBatch = commitShas.slice(offset, offset + commitBatchSize);
    const result = await gitExecutor.run(
      ['show', '--format=', '--name-only', '-z', '--diff-filter=ACMRTUXB', '--no-renames', ...commitBatch, '--'],
      { cwd: repoPath, env }
    );

    for (const path of parseNullSeparatedPaths(result.stdout)) {
      writePaths.add(path);
    }
  }

  await assertNoIgnoredUntrackedReplayCollisions(repoPath, [...writePaths], env);
}

async function assertNoIgnoredUntrackedReplayCollisions(
  repoPath: string,
  writePaths: string[],
  env: NodeJS.ProcessEnv | undefined,
  writeSource = 'replayed commits'
): Promise<void> {
  if (writePaths.length === 0) {
    return;
  }

  const ignoredResult = await gitExecutor.run(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--'], {
    cwd: repoPath,
    env
  });
  const ignoredPaths = parseNullSeparatedPaths(ignoredResult.stdout);
  const writePathSet = new Set(writePaths);
  const ignoredPathSet = new Set(ignoredPaths);
  const collisions = new Map<string, string>();

  for (const ignoredPath of ignoredPaths) {
    const writePath = writePathSet.has(ignoredPath) ? ignoredPath : findAncestorPath(ignoredPath, writePathSet);

    if (writePath) {
      collisions.set(ignoredPath, writePath);
    }
  }

  for (const writePath of writePaths) {
    const ignoredAncestor = findAncestorPath(writePath, ignoredPathSet);

    if (ignoredAncestor) {
      collisions.set(ignoredAncestor, writePath);
    }
  }

  if (collisions.size === 0) {
    return;
  }

  const examples = [...collisions]
    .slice(0, 3)
    .map(([ignoredPath, writePath]) =>
      ignoredPath === writePath ? JSON.stringify(ignoredPath) : `${JSON.stringify(ignoredPath)} blocks ${JSON.stringify(writePath)}`
    )
    .join(', ');
  const remainingCount = collisions.size - 3;
  const remainingLabel = remainingCount > 0 ? ` and ${remainingCount} more` : '';

  throw new Error(
    `Rebase is blocked because ${writeSource} would overwrite ignored ${collisions.size === 1 ? 'path' : 'paths'} ${examples}${remainingLabel}. Move or remove the colliding path first.`
  );
}

function parseNullSeparatedPaths(output: string): string[] {
  return output.split('\0').filter((path) => path.length > 0);
}

function parseRemainingRebaseCommitShas(todoContents: string): string[] {
  const replayActions = new Set(['pick', 'p', 'reword', 'r', 'edit', 'e', 'squash', 's', 'fixup', 'f']);
  const nonWritingActions = new Set(['drop', 'd', 'break', 'b', 'label', 'l', 'update-ref', 'u', 'noop']);
  const commitShas = new Set<string>();

  for (const rawLine of todoContents.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const parts = line.split(/\s+/);
    const action = parts[0];

    if (nonWritingActions.has(action)) {
      continue;
    }

    if (!replayActions.has(action)) {
      throw new Error(
        `The remaining rebase action ${JSON.stringify(action)} cannot be inspected safely. Abort the rebase or continue in Terminal after protecting ignored files.`
      );
    }

    const commitSha = parts.slice(1).find((part) => /^[0-9a-f]{4,64}$/i.test(part));

    if (!commitSha) {
      throw new Error(`The remaining ${action} rebase action does not identify a commit safely.`);
    }

    commitShas.add(commitSha);
  }

  return [...commitShas];
}

function findAncestorPath(path: string, candidates: Set<string>): string | undefined {
  let separatorIndex = path.lastIndexOf('/');

  while (separatorIndex > 0) {
    const ancestor = path.slice(0, separatorIndex);

    if (candidates.has(ancestor)) {
      return ancestor;
    }

    separatorIndex = ancestor.lastIndexOf('/');
  }

  return undefined;
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
  const nonce = randomUUID();
  await mkdir(tempDir, { mode: 0o700 });
  const editorFiles = rebaseEditorFilesFromState({ tempDir, nonce });
  const todoContents = todo.map((item) => `${item.action} ${item.sha} ${formatTodoSubject(item.subject)}`).join('\n');
  const rewordMessages = Object.fromEntries(
    todo.filter((item) => item.action === 'reword').map((item) => [item.sha, `${item.message.trim()}\n`])
  );

  await Promise.all([
    writeFile(editorFiles.markerPath, nonce, { flag: 'wx', mode: 0o600 }),
    writeFile(editorFiles.sequenceEditorPath, sequenceEditorScript(), { mode: 0o700 }),
    writeFile(editorFiles.messageEditorPath, messageEditorScript(), { mode: 0o700 }),
    writeFile(editorFiles.todoPath, `${todoContents}\n`),
    writeFile(editorFiles.rewordMessagesPath, JSON.stringify(rewordMessages))
  ]);

  return editorFiles;
}

function rebaseEditorFilesFromState(state: RebaseEditorState): RebaseEditorFiles {
  return {
    ...state,
    markerPath: join(state.tempDir, rebaseEditorMarkerName),
    sequenceEditorPath: join(state.tempDir, 'sequence-editor.cjs'),
    messageEditorPath: join(state.tempDir, 'message-editor.cjs'),
    todoPath: join(state.tempDir, 'git-rebase-todo'),
    rewordMessagesPath: join(state.tempDir, 'reword-messages.json')
  };
}

function createRebaseEditorEnv(
  env: NodeJS.ProcessEnv | undefined,
  editorFiles: RebaseEditorFiles,
  donePath: string
): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_SEQUENCE_EDITOR: createNodeScriptCommand(editorFiles.sequenceEditorPath),
    GIT_EDITOR: createNodeScriptCommand(editorFiles.messageEditorPath),
    GIT_GUD_SEQUENCE_TODO: editorFiles.todoPath,
    GIT_GUD_REWORD_MESSAGES: editorFiles.rewordMessagesPath,
    GIT_GUD_REBASE_DONE: donePath
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

    if (typeof parsedState.tempDir !== 'string' || typeof parsedState.nonce !== 'string') {
      throw new Error(untrustedRebaseStateMessage);
    }

    const state = {
      tempDir: parsedState.tempDir,
      nonce: parsedState.nonce
    };

    await validateRebaseEditorState(state);
    return state;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return undefined;
    }

    if (error instanceof SyntaxError) {
      throw new Error(untrustedRebaseStateMessage, { cause: error });
    }

    throw error;
  }
}

async function validateRebaseEditorState(state: RebaseEditorState): Promise<void> {
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedTempDir = resolve(state.tempDir);

  if (
    state.tempDir !== resolvedTempDir ||
    dirname(resolvedTempDir) !== resolvedTempRoot ||
    !rebaseTempDirNamePattern.test(basename(resolvedTempDir)) ||
    !noncePattern.test(state.nonce)
  ) {
    throw new Error(untrustedRebaseStateMessage);
  }

  const directoryStats = await lstatTrustedPath(resolvedTempDir);

  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error(untrustedRebaseStateMessage);
  }

  const [canonicalTempRoot, canonicalTempDir] = await Promise.all([realpath(resolvedTempRoot), realpath(resolvedTempDir)]);

  if (dirname(canonicalTempDir) !== canonicalTempRoot) {
    throw new Error(untrustedRebaseStateMessage);
  }

  const editorFiles = rebaseEditorFilesFromState(state);
  const artifactPaths = [
    editorFiles.markerPath,
    editorFiles.sequenceEditorPath,
    editorFiles.messageEditorPath,
    editorFiles.todoPath,
    editorFiles.rewordMessagesPath
  ];

  for (const artifactPath of artifactPaths) {
    await assertTrustedRegularFile(artifactPath, canonicalTempDir);
  }

  const [marker, sequenceEditor, messageEditor] = await Promise.all([
    readFile(editorFiles.markerPath, 'utf8'),
    readFile(editorFiles.sequenceEditorPath, 'utf8'),
    readFile(editorFiles.messageEditorPath, 'utf8')
  ]);

  if (marker !== state.nonce || sequenceEditor !== sequenceEditorScript() || messageEditor !== messageEditorScript()) {
    throw new Error(untrustedRebaseStateMessage);
  }
}

async function assertTrustedRegularFile(path: string, canonicalTempDir: string): Promise<void> {
  const stats = await lstatTrustedPath(path);

  if (stats.isSymbolicLink() || !stats.isFile() || dirname(await realpath(path)) !== canonicalTempDir) {
    throw new Error(untrustedRebaseStateMessage);
  }
}

async function lstatTrustedPath(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    throw new Error(untrustedRebaseStateMessage, { cause: error });
  }
}

async function rebaseStatePath(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<string> {
  return gitPath(repoPath, rebaseStatePathName, env);
}

async function gitPath(repoPath: string, pathName: string, env: NodeJS.ProcessEnv | undefined): Promise<string> {
  const result = await gitExecutor.run(['rev-parse', '--git-path', pathName], { cwd: repoPath, env });
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

async function assertInteractiveRebaseRangeIsLinear(
  repoPath: string,
  base: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  const result = await gitExecutor.run(['rev-list', '--max-count=1', '--min-parents=2', `${base}..HEAD`], {
    cwd: repoPath,
    env
  });

  if (result.stdout.trim()) {
    throw new Error(
      'Interactive rebase does not support ranges containing merge commits. Choose a base after the latest merge.'
    );
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
    conflictState: resolvedConflictState,
    invalidates: ['overview', 'graph', 'commit-detail', 'wip-detail', 'file-diff']
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
const donePath = process.env.GIT_GUD_REBASE_DONE;

if (!messagePath || !messagesPath || !donePath) {
  process.exit(0);
}

const doneLines = readFileSync(donePath, 'utf8').trimEnd().split('\\n');
const currentCommand = doneLines.at(-1)?.match(/^(?:reword|r)\\s+([0-9a-f]+)/);

if (!currentCommand) {
  process.exit(0);
}

const messages = JSON.parse(readFileSync(messagesPath, 'utf8'));
const originalSha = currentCommand[1];
const matchingSha = Object.keys(messages).find((sha) => sha.startsWith(originalSha) || originalSha.startsWith(sha));
const nextMessage = matchingSha ? messages[matchingSha] : undefined;

if (typeof nextMessage === 'string' && nextMessage.trim()) {
  writeFileSync(messagePath, nextMessage.endsWith('\\n') ? nextMessage : nextMessage + '\\n');
}
`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
