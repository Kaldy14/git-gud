import { branchNameFromRemoteRef } from '@renderer/lib/gitRefs';
import type {
  GitBranchRef,
  GitHubPullRequestSummary,
  GitRemote,
  GitRemoteBranchRef
} from '@shared/types';

export type PullRequestsByBranch = {
  local: ReadonlyMap<string, GitHubPullRequestSummary>;
  remote: ReadonlyMap<string, GitHubPullRequestSummary>;
};

type PullRequestBranchSources = {
  localBranches: readonly GitBranchRef[];
  remoteBranches: readonly GitRemoteBranchRef[];
  remotes: readonly GitRemote[];
};

export function indexPullRequestsByBranch(
  pullRequests: readonly GitHubPullRequestSummary[],
  sources: PullRequestBranchSources
): PullRequestsByBranch {
  const remoteRepositoryKeys = new Map(
    sources.remotes.flatMap((remote) => {
      const repositoryKey = [remote.fetchUrl, remote.pushUrl]
        .map(parseRepositoryKey)
        .find((value): value is string => Boolean(value));
      return repositoryKey ? [[remote.name, repositoryKey] as const] : [];
    })
  );
  const repositoryKeys = new Set(remoteRepositoryKeys.values());
  const local = new Map<string, GitHubPullRequestSummary>();
  const remote = new Map<string, GitHubPullRequestSummary>();
  const ambiguousLocal = new Set<string>();
  const ambiguousRemote = new Set<string>();

  for (const pullRequest of pullRequests) {
    const baseRepositoryKey = pullRequestRepositoryKey(
      pullRequest,
      pullRequest.owner,
      pullRequest.repository
    );
    const headRepositoryKey =
      pullRequest.headRepositoryOwner && pullRequest.headRepository
        ? pullRequestRepositoryKey(
            pullRequest,
            pullRequest.headRepositoryOwner,
            pullRequest.headRepository
          )
        : undefined;

    if (
      !pullRequest.headSha ||
      !baseRepositoryKey ||
      !repositoryKeys.has(baseRepositoryKey) ||
      !headRepositoryKey ||
      !repositoryKeys.has(headRepositoryKey)
    ) {
      continue;
    }

    for (const branch of sources.localBranches) {
      if (
        branch.name === pullRequest.headRefName &&
        branch.sha === pullRequest.headSha &&
        upstreamMatchesRepository(
          branch.upstream,
          headRepositoryKey,
          remoteRepositoryKeys
        )
      ) {
        addUnambiguous(local, ambiguousLocal, branch.name, pullRequest);
      }
    }

    for (const branch of sources.remoteBranches) {
      if (
        branchNameFromRemoteRef(branch.name) === pullRequest.headRefName &&
        branch.sha === pullRequest.headSha &&
        remoteRepositoryKeys.get(branch.remote) === headRepositoryKey
      ) {
        addUnambiguous(remote, ambiguousRemote, branch.name, pullRequest);
      }
    }
  }

  return { local, remote };
}

export function repositoryMatchesPullRequest(
  pullRequest: GitHubPullRequestSummary,
  remotes: readonly GitRemote[]
): boolean {
  const pullRequestKey = pullRequestRepositoryKey(
    pullRequest,
    pullRequest.owner,
    pullRequest.repository
  );

  if (!pullRequestKey) {
    return false;
  }

  return remotesContainRepositoryKey(pullRequestKey, remotes);
}

export function repositoryMatchesGitHubRepository(
  repository: {
    host: string;
    owner: string;
    name: string;
  },
  remotes: readonly GitRemote[]
): boolean {
  return remotesContainRepositoryKey(
    repositoryKey(repository.host, repository.owner, repository.name),
    remotes
  );
}

function remotesContainRepositoryKey(
  repositoryKeyToMatch: string,
  remotes: readonly GitRemote[]
): boolean {
  return remotes.some((remote) =>
    [remote.fetchUrl, remote.pushUrl]
      .map(parseRepositoryKey)
      .includes(repositoryKeyToMatch)
  );
}

function upstreamMatchesRepository(
  upstream: string | undefined,
  headRepositoryKey: string,
  remoteRepositoryKeys: ReadonlyMap<string, string>
): boolean {
  if (!upstream) {
    return true;
  }

  const remoteName = [...remoteRepositoryKeys.keys()]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => upstream.startsWith(`${candidate}/`));
  return remoteName
    ? remoteRepositoryKeys.get(remoteName) === headRepositoryKey
    : false;
}

function addUnambiguous(
  matches: Map<string, GitHubPullRequestSummary>,
  ambiguous: Set<string>,
  branchName: string,
  pullRequest: GitHubPullRequestSummary
): void {
  if (matches.has(branchName)) {
    matches.delete(branchName);
    ambiguous.add(branchName);
    return;
  }

  if (!ambiguous.has(branchName)) {
    matches.set(branchName, pullRequest);
  }
}

function pullRequestRepositoryKey(
  pullRequest: GitHubPullRequestSummary,
  owner: string,
  repository: string
): string | undefined {
  try {
    const url = new URL(pullRequest.url);
    return repositoryKey(url.hostname, owner, repository);
  } catch {
    return undefined;
  }
}

function parseRepositoryKey(remoteUrl: string | undefined): string | undefined {
  const value = remoteUrl?.trim();

  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return repositoryKeyFromPath(url.hostname, url.pathname);
  } catch {
    const scpMatch = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(value);
    return scpMatch
      ? repositoryKeyFromPath(scpMatch[1], scpMatch[2])
      : undefined;
  }
}

function repositoryKeyFromPath(
  host: string,
  repositoryPath: string
): string | undefined {
  const parts = repositoryPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/');

  return parts.length === 2
    ? repositoryKey(host, parts[0], parts[1])
    : undefined;
}

function repositoryKey(
  host: string,
  owner: string,
  repository: string
): string {
  return `${host}/${owner}/${repository}`.toLowerCase();
}
