import { execFile } from 'node:child_process';

import type { GitRemote } from '@shared/types';

import { findGhExecutable } from '../profiles';

const MAX_GITHUB_AVATAR_LOOKUPS_PER_REQUEST = 100;
const MAX_GITHUB_AVATAR_CACHE_ENTRIES = 4_096;
const GITHUB_AVATAR_MISS_TTL_MS = 5 * 60_000;
const GITHUB_AVATAR_FAILURE_TTL_MS = 60_000;
const GITHUB_AVATAR_REQUEST_TIMEOUT_MS = 10_000;

type GitHubRepositoryLocator = {
  host: string;
  owner: string;
  name: string;
};

export type GitHubAvatarCandidate = {
  sha: string;
  email?: string;
  hasRemoteRef: boolean;
};

type GitHubGraphqlRequest = GitHubRepositoryLocator & {
  query: string;
  env?: NodeJS.ProcessEnv;
};

type GitHubGraphqlRunner = (request: GitHubGraphqlRequest) => Promise<unknown>;

type AvatarCacheEntry = {
  url?: string;
  expiresAt?: number;
};

type AvatarBatchEntry = {
  alias: string;
  cacheKey: string;
  email: string;
  sha: string;
};

const avatarCache = new Map<string, AvatarCacheEntry>();
const failedRepositoryRequests = new Map<string, number>();

export function findGitHubRepository(
  remotes: readonly GitRemote[],
  configuredHost?: string
): GitHubRepositoryLocator | undefined {
  const allowedHosts = new Set(['github.com']);
  const normalizedConfiguredHost = normalizeHost(configuredHost);

  if (normalizedConfiguredHost) {
    allowedHosts.add(normalizedConfiguredHost);
  }

  const orderedRemotes = [...remotes].sort((left, right) => {
    return Number(right.name === 'origin') - Number(left.name === 'origin');
  });

  for (const remote of orderedRemotes) {
    for (const url of [remote.fetchUrl, remote.pushUrl]) {
      const repository = url ? parseGitHubRemoteUrl(url, allowedHosts) : undefined;

      if (repository) {
        return repository;
      }
    }
  }

  return undefined;
}

export async function loadGitHubCommitAuthorAvatars(
  repository: GitHubRepositoryLocator,
  candidates: readonly GitHubAvatarCandidate[],
  env?: NodeJS.ProcessEnv,
  runGraphql: GitHubGraphqlRunner = runGitHubGraphql
): Promise<Map<string, string>> {
  const avatarUrls = new Map<string, string>();
  const prioritizedCandidates = [
    ...candidates.filter((candidate) => candidate.hasRemoteRef),
    ...candidates.filter((candidate) => !candidate.hasRemoteRef)
  ];
  const seenEmails = new Set<string>();
  const batchEntries: AvatarBatchEntry[] = [];

  for (const candidate of prioritizedCandidates) {
    const email = normalizeEmail(candidate.email);

    if (!email || seenEmails.has(email) || !isGitObjectId(candidate.sha)) {
      continue;
    }

    seenEmails.add(email);
    const cacheKey = avatarCacheKey(repository, email, env);
    const cached = readAvatarCache(cacheKey);

    if (cached) {
      if (cached.url) {
        avatarUrls.set(email, cached.url);
      }
      continue;
    }

    if (batchEntries.length < MAX_GITHUB_AVATAR_LOOKUPS_PER_REQUEST) {
      batchEntries.push({
        alias: `avatar${batchEntries.length}`,
        cacheKey,
        email,
        sha: candidate.sha
      });
    }
  }

  if (batchEntries.length === 0) {
    return avatarUrls;
  }

  const requestKey = repositoryRequestKey(repository, env);
  const retryAt = failedRepositoryRequests.get(requestKey);

  if (retryAt !== undefined && retryAt > Date.now()) {
    return avatarUrls;
  }

  try {
    const response = await runGraphql({
      ...repository,
      query: buildAvatarQuery(batchEntries),
      env
    });
    const repositoryData = readRepositoryData(response);

    if (!repositoryData) {
      failedRepositoryRequests.set(requestKey, Date.now() + GITHUB_AVATAR_FAILURE_TTL_MS);
      return avatarUrls;
    }

    failedRepositoryRequests.delete(requestKey);

    for (const entry of batchEntries) {
      const avatarUrl = readAvatarUrl(repositoryData[entry.alias]);

      writeAvatarCache(entry.cacheKey, avatarUrl
        ? { url: avatarUrl }
        : { expiresAt: Date.now() + GITHUB_AVATAR_MISS_TTL_MS });

      if (avatarUrl) {
        avatarUrls.set(entry.email, avatarUrl);
      }
    }
  } catch {
    failedRepositoryRequests.set(requestKey, Date.now() + GITHUB_AVATAR_FAILURE_TTL_MS);
  }

  return avatarUrls;
}

function parseGitHubRemoteUrl(
  remoteUrl: string,
  allowedHosts: ReadonlySet<string>
): GitHubRepositoryLocator | undefined {
  const trimmed = remoteUrl.trim();
  let host: string;
  let pathname: string;

  if (trimmed.includes('://')) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname.toLowerCase();
      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  } else {
    const scpMatch = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);

    if (!scpMatch) {
      return undefined;
    }

    host = scpMatch[1].toLowerCase();
    pathname = scpMatch[2];
  }

  if (!allowedHosts.has(host)) {
    return undefined;
  }

  const parts = pathname
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);

  if (parts.length !== 2) {
    return undefined;
  }

  try {
    return {
      host,
      owner: decodeURIComponent(parts[0]),
      name: decodeURIComponent(parts[1])
    };
  } catch {
    return undefined;
  }
}

function normalizeHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.includes('://')) {
    return trimmed.replace(/\/+$/, '');
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email || undefined;
}

function isGitObjectId(value: string): boolean {
  return /^[\da-f]{40}(?:[\da-f]{24})?$/i.test(value);
}

function buildAvatarQuery(entries: readonly AvatarBatchEntry[]): string {
  const objects = entries
    .map(
      ({ alias, sha }) => `
    ${alias}: object(oid: "${sha}") {
      ... on Commit {
        author {
          user {
            avatarUrl(size: 64)
          }
        }
      }
    }`
    )
    .join('');

  return `
query GitGudCommitAvatars($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {${objects}
  }
}`.trim();
}

function readRepositoryData(response: unknown): Record<string, unknown> | undefined {
  if (!isRecord(response) || !isRecord(response.data) || !isRecord(response.data.repository)) {
    return undefined;
  }

  return response.data.repository;
}

function readAvatarUrl(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.author.user)) {
    return undefined;
  }

  const avatarUrl = value.author.user.avatarUrl;
  return typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl : undefined;
}

function avatarCacheKey(
  repository: GitHubRepositoryLocator,
  email: string,
  env: NodeJS.ProcessEnv | undefined
): string {
  return `${repositoryRequestKey(repository, env)}\0${email}`;
}

function repositoryRequestKey(
  repository: GitHubRepositoryLocator,
  env: NodeJS.ProcessEnv | undefined
): string {
  return `${repository.host}\0${repository.owner}/${repository.name}\0${env?.GH_CONFIG_DIR ?? 'default'}`;
}

function readAvatarCache(key: string): AvatarCacheEntry | undefined {
  const entry = avatarCache.get(key);

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    avatarCache.delete(key);
    return undefined;
  }

  avatarCache.delete(key);
  avatarCache.set(key, entry);
  return entry;
}

function writeAvatarCache(key: string, entry: AvatarCacheEntry): void {
  avatarCache.delete(key);
  avatarCache.set(key, entry);

  if (avatarCache.size > MAX_GITHUB_AVATAR_CACHE_ENTRIES) {
    const oldestKey = avatarCache.keys().next().value;

    if (oldestKey !== undefined) {
      avatarCache.delete(oldestKey);
    }
  }
}

async function runGitHubGraphql(request: GitHubGraphqlRequest): Promise<unknown> {
  const executable = await findGhExecutable();

  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        'api',
        'graphql',
        '--hostname',
        request.host,
        '-f',
        `query=${request.query}`,
        '-F',
        `owner=${request.owner}`,
        '-F',
        `name=${request.name}`
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...request.env
        },
        maxBuffer: 2 * 1024 * 1024,
        timeout: GITHUB_AVATAR_REQUEST_TIMEOUT_MS,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch {
          reject(new Error('GitHub CLI returned an invalid avatar response.'));
        }
      }
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
