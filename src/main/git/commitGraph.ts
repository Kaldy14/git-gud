import { buildCommitGraphRows, COMMIT_GRAPH_LIMIT_STEP, DEFAULT_COMMIT_GRAPH_LIMIT, type GraphCommitInput, type CommitGraphWorktrees } from '@shared/graph';
import type {
  CommitGraphAvatarCandidate,
  CommitGraphPage,
  GitFileChange,
  GitRefsSummary,
  GitStashEntry,
  GitStatusCode,
  GitStatusSummary,
  GitWorktree,
  GraphFile,
  GraphMachine,
  GraphFileStatus,
  GraphRefChip,
  RepoTab
} from '@shared/types';

import { listEnabledGraphMachines } from '../machines';
import { createProfileCommandEnv, listProfiles } from '../profiles';
import { GitCommandError, gitExecutor } from './exec';
import {
  findGitHubRepository,
  getCachedGitHubCommitAuthorAvatars,
  loadGitHubCommitAuthorAvatars
} from './githubAvatars';
import { parseGitLog, type GitLogCommit } from './parsers/log';
import { loadRefs, loadRemotes, loadStashes, loadStatus, loadWorktrees } from './repositoryOverview';
import { gravatarUrlForEmail } from './gravatar';

const MAX_COMMIT_GRAPH_LIMIT = 12000;
const MAX_LINKED_WORKTREE_STATUS_CONCURRENCY = 6;

export async function loadCommitGraph(
  tab: Pick<RepoTab, 'path' | 'assignedProfileId'>,
  requestedLimit = DEFAULT_COMMIT_GRAPH_LIMIT,
  loadRemoteAvatars = true
): Promise<CommitGraphPage> {
  const limit = normalizeLimit(requestedLimit);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const logLimit = limit < MAX_COMMIT_GRAPH_LIMIT ? limit + 1 : limit;
  const machines = listEnabledGraphMachines();
  const statusPromise = loadStatus(tab.path, env, [], { aheadBehind: false });
  const worktreesPromise = loadWorktrees(tab.path, env);
  const [logCommits, refs, status, stashes, worktrees, remotes, machineRefs] = await Promise.all([
    loadLogCommits(tab.path, logLimit, env, machines),
    // Graph chips and WIP nodes need ref tips and file state, not the sidebar's
    // ahead/behind counts for every old branch and linked worktree.
    loadRefs(tab.path, env, { includeTracking: false }),
    statusPromise,
    loadStashes(tab.path, env),
    worktreesPromise,
    loadRemoteAvatars ? loadRemotes(tab.path, env) : Promise.resolve([]),
    Promise.all([statusPromise, worktreesPromise]).then(([status, worktrees]) =>
      loadMachineRefs(tab.path, env, machines, limit, [status.branch.oid, ...worktrees.map((worktree) => worktree.head)]))
  ]);
  const hasMore = limit < MAX_COMMIT_GRAPH_LIMIT && logCommits.length > limit;
  const commits = logCommits.slice(0, limit);
  const refMap = createRefMap(refs);
  for (const chip of machineRefs.chips) addRef(refMap, chip.sha, chip.chip);
  const profile = tab.assignedProfileId
    ? listProfiles().find((candidate) => candidate.id === tab.assignedProfileId)
    : undefined;
  const githubRepository = loadRemoteAvatars
    ? findGitHubRepository(remotes, profile?.githubHost)
    : undefined;
  const githubAvatarUrls = githubRepository
    ? getCachedGitHubCommitAuthorAvatars(
        githubRepository,
        commits.map((commit) => commit.authorEmail),
        env
      )
    : new Map<string, string>();
  const currentWorktree = worktrees.find((worktree) => worktree.current) ?? {
    path: tab.path, head: status.branch.oid, branch: status.branch.head,
    detached: status.branch.isDetached, bare: false, current: true
  };
  const currentWip = worktreeWipInput(currentWorktree, status);
  const wipInputs = currentWip ? [currentWip] : [];
  const wipInputsByBase = createInputsByBase(wipInputs);
  const stashInputsByBase = createStashInputsByBase(stashes);
  const attachedStashBases = new Set<string>();
  const loadedCommitShas = new Set(commits.map((commit) => commit.sha));
  const inputs: GraphCommitInput[] = [];

  for (const commit of commits) {
    const attachedWipInputs = wipInputsByBase.get(commit.sha);
    const stashInputs = stashInputsByBase.get(commit.sha);

    if (attachedWipInputs) {
      inputs.push(...attachedWipInputs);
    }

    if (stashInputs) {
      inputs.push(...stashInputs);
      attachedStashBases.add(commit.sha);
    }

    const input = logCommitToGraphInput(commit, refMap.get(commit.sha), githubAvatarUrls);
    const unpushedOn = machineRefs.unpushed.get(commit.sha);
    inputs.push(unpushedOn ? { ...input, unpushedOn } : input);
  }

  inputs.push(...wipInputs.filter((input) => !loadedCommitShas.has(input.parentShas[0] ?? '')));

  for (const [baseSha, stashInputs] of stashInputsByBase.entries()) {
    if (!attachedStashBases.has(baseSha)) {
      inputs.push(...stashInputs);
    }
  }

  return {
    repoPath: tab.path,
    loadedAt: new Date().toISOString(),
    rows: buildCommitGraphRows(inputs),
    limit,
    loadedCommitCount: commits.length,
    hasMore,
    nextLimit: Math.min(limit + COMMIT_GRAPH_LIMIT_STEP, MAX_COMMIT_GRAPH_LIMIT)
  };
}

export async function loadCommitGraphAvatarUrls(
  tab: Pick<RepoTab, 'path' | 'assignedProfileId'>,
  candidates: readonly CommitGraphAvatarCandidate[]
): Promise<Record<string, string>> {
  if (candidates.length === 0) return {};

  const env = createProfileCommandEnv(tab.assignedProfileId);
  const profile = tab.assignedProfileId
    ? listProfiles().find((candidate) => candidate.id === tab.assignedProfileId)
    : undefined;
  const repository = findGitHubRepository(await loadRemotes(tab.path, env), profile?.githubHost);

  if (!repository) return {};

  const avatars = await loadGitHubCommitAuthorAvatars(repository, candidates.slice(0, MAX_COMMIT_GRAPH_LIMIT), env);
  return Object.fromEntries(avatars);
}

// Linked worktrees can live on slow or unavailable volumes. Their status is
// optional enrichment and must never delay the local commit-history response.
export async function loadCommitGraphWorktrees(
  tab: Pick<RepoTab, 'path' | 'assignedProfileId'>
): Promise<CommitGraphWorktrees> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const worktrees = await loadWorktrees(tab.path, env);
  const loaded = await mapWithConcurrency(
    worktrees.filter((worktree) => !worktree.bare && !worktree.current),
    MAX_LINKED_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => worktreeWipInput(worktree, await loadLinkedWorktreeStatus(worktree.path, env))
  );

  return {
    repoPath: tab.path,
    inputs: loaded.filter((input): input is GraphCommitInput => Boolean(input))
  };
}

function worktreeWipInput(worktree: GitWorktree, status: GitStatusSummary | undefined): GraphCommitInput | undefined {
  if (!status?.isDirty) return undefined;

  return {
    sha: worktree.current ? 'wip' : `wip:${worktree.path}`,
    parentShas: status.branch.oid ? [status.branch.oid] : worktree.head ? [worktree.head] : [],
    subject: '// WIP',
    authorName: 'Worktree',
    authoredAt: new Date().toISOString(),
    dateLabel: 'now',
    kind: 'wip',
    colorOverride: '#bc271b',
    refs: [{ label: 'WIP', kind: 'wip' }],
    worktree: {
      path: worktree.path,
      branch: worktree.branch ?? status.branch.head,
      current: worktree.current
    },
    files: status.files.filter((file) => file.status !== 'ignored').map(statusFileToGraphFile)
  };
}

async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  mapper: (value: Value) => Promise<Result>
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  const workerCount = Math.min(concurrency, values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function createInputsByBase(inputs: GraphCommitInput[]): Map<string, GraphCommitInput[]> {
  const inputsByBase = new Map<string, GraphCommitInput[]>();

  for (const input of inputs) {
    const baseSha = input.parentShas[0] ?? '';
    const inputsForBase = inputsByBase.get(baseSha) ?? [];
    inputsForBase.push(input);
    inputsByBase.set(baseSha, inputsForBase);
  }

  return inputsByBase;
}

async function loadLinkedWorktreeStatus(
  worktreePath: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitStatusSummary | undefined> {
  try {
    return await loadStatus(worktreePath, env, [], { aheadBehind: false });
  } catch {
    return undefined;
  }
}

function createStashInputsByBase(stashes: GitStashEntry[]): Map<string, GraphCommitInput[]> {
  const inputsByBase = new Map<string, GraphCommitInput[]>();

  for (const stash of stashes) {
    const baseSha = stash.parentShas[0] ?? '';
    const inputs = inputsByBase.get(baseSha) ?? [];
    inputs.push({
      sha: stash.sha,
      parentShas: baseSha ? [baseSha] : [],
      subject: stash.subject || stash.selector,
      authorName: 'Stash',
      authoredAt: stash.date,
      kind: 'stash',
      colorOverride: '#e1673e',
      refs: [{ label: stash.selector, kind: 'stash' }]
    });
    inputsByBase.set(baseSha, inputs);
  }

  return inputsByBase;
}

type MachineRefs = {
  chips: { sha: string; chip: GraphRefChip }[];
  /** Commits only reachable from other machines' local branches. */
  unpushed: Map<string, GraphMachine[]>;
};

// Mirrored branch tips live in refs/machines/<id>/heads/*, fetched by machines.ts.
async function loadMachineRefs(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined,
  machines: readonly GraphMachine[],
  limit: number,
  localHeads: readonly (string | undefined)[]
): Promise<MachineRefs> {
  const result: MachineRefs = { chips: [], unpushed: new Map() };
  if (machines.length === 0) return result;
  // Unborn worktrees report an all-zero HEAD, which rev-list rejects.
  const localRevisions = [...new Set(localHeads.flatMap((head) => head && !/^0+$/.test(head) ? [head] : []))];

  await Promise.all(machines.map(async (machine) => {
    const prefix = `refs/machines/${machine.id}`;
    const [refs, unpushed] = await Promise.all([
      gitExecutor.run(['for-each-ref', '--format=%(objectname)%00%(refname)', `${prefix}/heads/`], { cwd: repoPath, env }),
      gitExecutor.run(
        ['rev-list', `--max-count=${limit}`, `--glob=${prefix}/heads`, '--not', '--branches', '--remotes', '--tags', ...localRevisions],
        { cwd: repoPath, env, allowedExitCodes: [128] }
      )
    ]);

    for (const line of refs.stdout.split('\n')) {
      const [sha, refName] = line.split('\0');
      if (!sha || !refName) continue;
      result.chips.push({ sha, chip: { label: refName.slice(prefix.length + '/heads/'.length), kind: 'machine', machine } });
    }

    for (const sha of unpushed.exitCode === 0 ? unpushed.stdout.split('\n') : []) {
      if (sha) result.unpushed.set(sha, [...result.unpushed.get(sha) ?? [], machine]);
    }
  }));

  return result;
}

async function loadLogCommits(
  repoPath: string,
  limit: number,
  env: NodeJS.ProcessEnv | undefined,
  machines: readonly GraphMachine[] = []
): Promise<GitLogCommit[]> {
  try {
    const head = await gitExecutor.run(['rev-parse', '--verify', '-q', 'HEAD'], {
      cwd: repoPath,
      env,
      allowedExitCodes: [1]
    });
    const revisions = [
      '--branches', '--remotes', '--tags',
      // Machine HEADs keep a detached remote checkout's base commit in the graph.
      ...machines.map((machine) => `--glob=refs/machines/${machine.id}`),
      ...(head.exitCode === 0 ? ['HEAD'] : [])
    ];
    const result = await gitExecutor.run(
      [
        'log',
        `--max-count=${limit}`,
        ...revisions,
        '--date-order',
        '-z',
        '--date=iso-strict',
        '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%D%x00%s%x00%b'
      ],
      { cwd: repoPath, env }
    );

    return parseGitLog(result.stdout);
  } catch (error) {
    if (isEmptyRepositoryLogError(error)) {
      return [];
    }

    throw error;
  }
}

function logCommitToGraphInput(
  commit: GitLogCommit,
  refs: GraphRefChip[] | undefined,
  githubAvatarUrls: ReadonlyMap<string, string>
): GraphCommitInput {
  const gravatarUrl = gravatarUrlForEmail(commit.authorEmail, 64);
  const githubAvatarUrl = commit.authorEmail
    ? githubAvatarUrls.get(commit.authorEmail.trim().toLowerCase())
    : undefined;

  return {
    sha: commit.sha,
    parentShas: commit.parentShas,
    subject: commit.subject,
    body: commit.body,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authorAvatarUrl: githubAvatarUrl ?? gravatarUrl,
    authorAvatarFallbackUrl: githubAvatarUrl ? gravatarUrl : undefined,
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt,
    refs
  };
}

function createRefMap(refs: GitRefsSummary): Map<string, GraphRefChip[]> {
  const refMap = new Map<string, GraphRefChip[]>();

  for (const branch of refs.localBranches) {
    addRef(refMap, branch.sha, { label: branch.name, kind: 'branch', ...(branch.current ? { current: true } : {}) });
  }

  for (const branch of refs.remoteBranches) {
    addRef(refMap, branch.sha, { label: branch.name, kind: 'remote' });
  }

  for (const tag of refs.tags) {
    addRef(refMap, tag.sha, { label: tag.name, kind: 'tag' });
  }

  for (const chips of refMap.values()) {
    chips.sort((a, b) => Number(b.current ?? false) - Number(a.current ?? false));
  }

  return refMap;
}

function addRef(refMap: Map<string, GraphRefChip[]>, sha: string, chip: GraphRefChip): void {
  const chips = refMap.get(sha) ?? [];

  if (!chips.some((candidate) =>
    candidate.kind === chip.kind && candidate.label === chip.label && candidate.machine?.id === chip.machine?.id)) {
    chips.push(chip);
  }

  refMap.set(sha, chips);
}

function statusFileToGraphFile(file: GitFileChange): GraphFile {
  return {
    path: file.path,
    status: statusToGraphStatus(file.status)
  };
}

function statusToGraphStatus(status: GitStatusCode): GraphFileStatus {
  if (status === 'added' || status === 'untracked' || status === 'copied') {
    return 'added';
  }

  if (status === 'deleted') {
    return 'deleted';
  }

  return 'modified';
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_COMMIT_GRAPH_LIMIT;
  }

  return Math.min(MAX_COMMIT_GRAPH_LIMIT, Math.max(1, Math.floor(limit)));
}

function isEmptyRepositoryLogError(error: unknown): boolean {
  return (
    error instanceof GitCommandError &&
    /does not have any commits|bad revision|ambiguous argument 'HEAD'|unknown revision/.test(
      `${error.message}\n${error.stderr}`
    )
  );
}
