import { buildCommitGraphRows, COMMIT_GRAPH_LIMIT_STEP, DEFAULT_COMMIT_GRAPH_LIMIT, type GraphCommitInput } from '@shared/graph';
import type {
  CommitGraphPage,
  GitFileChange,
  GitRefsSummary,
  GitStatusCode,
  GraphFile,
  GraphFileStatus,
  GraphRefChip,
  RepoTab
} from '@shared/types';

import { GitCommandError, gitExecutor } from './exec';
import { parseGitLog, type GitLogCommit } from './parsers/log';
import { parseForEachRef } from './parsers/refs';
import { parseStashList } from './parsers/stash';
import { parseStatusPorcelainV2 } from './parsers/status';

const MAX_COMMIT_GRAPH_LIMIT = 12000;

export async function loadCommitGraph(
  tab: Pick<RepoTab, 'path'>,
  requestedLimit = DEFAULT_COMMIT_GRAPH_LIMIT
): Promise<CommitGraphPage> {
  const limit = normalizeLimit(requestedLimit);
  const [logCommits, refs, status, stashes] = await Promise.all([
    loadLogCommits(tab.path, limit + 1),
    loadRefs(tab.path),
    loadStatus(tab.path),
    loadStashes(tab.path)
  ]);
  const hasMore = logCommits.length > limit;
  const commits = logCommits.slice(0, limit);
  const refMap = createRefMap(refs);
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

  for (const stash of stashes) {
    inputs.push({
      sha: stash.sha,
      parentShas: stash.parentShas[0] ? [stash.parentShas[0]] : [],
      subject: stash.subject,
      authorName: 'Stash',
      authoredAt: stash.date,
      kind: 'stash',
      colorOverride: '#f0a13f',
      refs: [{ label: stash.selector, kind: 'stash' }]
    });
  }

  for (const commit of commits) {
    inputs.push(logCommitToGraphInput(commit, refMap.get(commit.sha)));
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

async function loadStatus(repoPath: string) {
  const result = await gitExecutor.run(['status', '--porcelain=v2', '--branch', '-z'], { cwd: repoPath });
  return parseStatusPorcelainV2(result.stdout);
}

async function loadRefs(repoPath: string): Promise<GitRefsSummary> {
  const result = await gitExecutor.run(
    [
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(creatordate:iso-strict)',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ],
    { cwd: repoPath }
  );

  return parseForEachRef(result.stdout);
}

async function loadStashes(repoPath: string) {
  const result = await gitExecutor.run(['stash', 'list', '--format=%H%x00%P%x00%gd%x00%aI%x00%s%x00'], {
    cwd: repoPath
  });
  return parseStashList(result.stdout);
}

async function loadLogCommits(repoPath: string, limit: number): Promise<GitLogCommit[]> {
  try {
    const result = await gitExecutor.run(
      [
        'log',
        `--max-count=${limit}`,
        '--branches',
        '--remotes',
        '--tags',
        'HEAD',
        '--topo-order',
        '-z',
        '--date=iso-strict',
        '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%D%x00%s'
      ],
      { cwd: repoPath }
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
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt,
    refs
  };
}

function createRefMap(refs: GitRefsSummary): Map<string, GraphRefChip[]> {
  const refMap = new Map<string, GraphRefChip[]>();

  for (const branch of refs.localBranches) {
    addRef(refMap, branch.sha, { label: branch.name, kind: 'branch' });
  }

  for (const branch of refs.remoteBranches) {
    addRef(refMap, branch.sha, { label: branch.name, kind: 'remote' });
  }

  for (const tag of refs.tags) {
    addRef(refMap, tag.sha, { label: tag.name, kind: 'tag' });
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
