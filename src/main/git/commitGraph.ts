import { buildCommitGraphRows, COMMIT_GRAPH_LIMIT_STEP, DEFAULT_COMMIT_GRAPH_LIMIT, type GraphCommitInput } from '@shared/graph';
import type {
  CommitGraphPage,
  GitFileChange,
  GitRefsSummary,
  GitStashEntry,
  GitStatusCode,
  GraphFile,
  GraphFileStatus,
  GraphRefChip,
  RepoTab
} from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { GitCommandError, gitExecutor } from './exec';
import { parseGitLog, type GitLogCommit } from './parsers/log';
import { loadRefs, loadStashes, loadStatus } from './repositoryOverview';
import { gravatarUrlForEmail } from './gravatar';

const MAX_COMMIT_GRAPH_LIMIT = 12000;

export async function loadCommitGraph(
  tab: Pick<RepoTab, 'path' | 'assignedProfileId'>,
  requestedLimit = DEFAULT_COMMIT_GRAPH_LIMIT
): Promise<CommitGraphPage> {
  const limit = normalizeLimit(requestedLimit);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const logLimit = limit < MAX_COMMIT_GRAPH_LIMIT ? limit + 1 : limit;
  const [logCommits, refs, status, stashes] = await Promise.all([
    loadLogCommits(tab.path, logLimit, env),
    loadRefs(tab.path, env),
    loadStatus(tab.path, env),
    loadStashes(tab.path, env)
  ]);
  const hasMore = limit < MAX_COMMIT_GRAPH_LIMIT && logCommits.length > limit;
  const commits = logCommits.slice(0, limit);
  const refMap = createRefMap(refs);
  const stashInputsByBase = createStashInputsByBase(stashes);
  const attachedStashBases = new Set<string>();
  const inputs: GraphCommitInput[] = [];

  if (status.isDirty) {
    inputs.push({
      sha: 'wip',
      parentShas: status.branch.oid ? [status.branch.oid] : [],
      subject: '// WIP',
      authorName: 'Worktree',
      authoredAt: new Date().toISOString(),
      dateLabel: 'now',
      kind: 'wip',
      colorOverride: '#8b95a5',
      refs: [{ label: 'WIP', kind: 'wip' }],
      files: status.files.filter((file) => file.status !== 'ignored').map(statusFileToGraphFile)
    });
  }

  for (const commit of commits) {
    const stashInputs = stashInputsByBase.get(commit.sha);

    if (stashInputs) {
      inputs.push(...stashInputs);
      attachedStashBases.add(commit.sha);
    }

    inputs.push(logCommitToGraphInput(commit, refMap.get(commit.sha)));
  }

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
      colorOverride: '#d726e7',
      refs: [{ label: stash.selector, kind: 'stash' }]
    });
    inputsByBase.set(baseSha, inputs);
  }

  return inputsByBase;
}

async function loadLogCommits(
  repoPath: string,
  limit: number,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitLogCommit[]> {
  try {
    const head = await gitExecutor.run(['rev-parse', '--verify', '-q', 'HEAD'], {
      cwd: repoPath,
      env,
      allowedExitCodes: [1]
    });
    const revisions = head.exitCode === 0 ? ['--branches', '--remotes', '--tags', 'HEAD'] : ['--branches', '--remotes', '--tags'];
    const result = await gitExecutor.run(
      [
        'log',
        `--max-count=${limit}`,
        ...revisions,
        '--topo-order',
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

function logCommitToGraphInput(commit: GitLogCommit, refs: GraphRefChip[] | undefined): GraphCommitInput {
  return {
    sha: commit.sha,
    parentShas: commit.parentShas,
    subject: commit.subject,
    body: commit.body,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authorAvatarUrl: gravatarUrlForEmail(commit.authorEmail, 64),
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

  if (!chips.some((candidate) => candidate.kind === chip.kind && candidate.label === chip.label)) {
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
