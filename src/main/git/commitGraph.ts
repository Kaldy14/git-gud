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
import { parseForEachRef } from './parsers/refs';
import { parseStashList } from './parsers/stash';
import { parseStatusPorcelainV2 } from './parsers/status';
import { gravatarUrlForEmail } from './gravatar';

const MAX_COMMIT_GRAPH_LIMIT = 12000;

export async function loadCommitGraph(
  tab: Pick<RepoTab, 'path' | 'assignedProfileId'>,
  requestedLimit = DEFAULT_COMMIT_GRAPH_LIMIT
): Promise<CommitGraphPage> {
  const limit = normalizeLimit(requestedLimit);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const [logCommits, refs, status, stashes] = await Promise.all([
    loadLogCommits(tab.path, limit + 1, env),
    loadRefs(tab.path, env),
    loadStatus(tab.path, env),
    loadStashes(tab.path, env)
  ]);
  const hasMore = logCommits.length > limit;
  const commits = logCommits.slice(0, limit);
  const refMap = createRefMap(refs);
  const groupedStashInputsByBase = createGroupedStashInputsByBase(stashes);
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
    const stashInput = groupedStashInputsByBase.get(commit.sha);

    if (stashInput) {
      inputs.push(stashInput);
      attachedStashBases.add(commit.sha);
    }

    inputs.push(logCommitToGraphInput(commit, refMap.get(commit.sha)));
  }

  for (const [baseSha, stashInput] of groupedStashInputsByBase.entries()) {
    if (!attachedStashBases.has(baseSha)) {
      inputs.push(stashInput);
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

function createGroupedStashInputsByBase(stashes: GitStashEntry[]): Map<string, GraphCommitInput> {
  const stashesByBase = new Map<string, GitStashEntry[]>();

  for (const stash of stashes) {
    const baseSha = stash.parentShas[0] ?? '';
    const group = stashesByBase.get(baseSha) ?? [];
    group.push(stash);
    stashesByBase.set(baseSha, group);
  }

  const inputsByBase = new Map<string, GraphCommitInput>();

  for (const [baseSha, group] of stashesByBase.entries()) {
    const primaryStash = group[0];

    if (!primaryStash) {
      continue;
    }

    inputsByBase.set(baseSha, {
      sha: primaryStash.sha,
      parentShas: baseSha ? [baseSha] : [],
      subject: formatStashSubject(primaryStash, group.length),
      authorName: 'Stash',
      authoredAt: primaryStash.date,
      kind: 'stash',
      colorOverride: '#d726e7',
      refs: group.map((stash) => ({ label: stash.selector, kind: 'stash' }))
    });
  }

  return inputsByBase;
}

function formatStashSubject(primaryStash: GitStashEntry, groupSize: number): string {
  const subject = primaryStash.subject || primaryStash.selector;
  const extraCount = groupSize - 1;

  return extraCount > 0 ? `${subject} (+${extraCount} stashes)` : subject;
}

async function loadStatus(repoPath: string, env: NodeJS.ProcessEnv | undefined) {
  const result = await gitExecutor.run(['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'], {
    cwd: repoPath,
    env
  });
  return parseStatusPorcelainV2(result.stdout);
}

async function loadRefs(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<GitRefsSummary> {
  const result = await gitExecutor.run(
    [
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(creatordate:iso-strict)',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ],
    { cwd: repoPath, env }
  );

  return parseForEachRef(result.stdout);
}

async function loadStashes(repoPath: string, env: NodeJS.ProcessEnv | undefined) {
  const result = await gitExecutor.run(['stash', 'list', '--format=%H%x00%P%x00%gd%x00%aI%x00%s%x00'], {
    cwd: repoPath,
    env
  });
  return parseStashList(result.stdout);
}

async function loadLogCommits(
  repoPath: string,
  limit: number,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitLogCommit[]> {
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
