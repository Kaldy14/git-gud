export const GIT_GUD_PROTOCOL = 'git-gud';
export const PULL_REQUEST_DEEP_LINK_EVENT = 'app:open-pull-request-deep-link';

export type PullRequestDeepLinkTarget = {
  host: string;
  owner: string;
  repository: string;
  number: number;
};

export function pullRequestDeepLinkTargetKey(target: PullRequestDeepLinkTarget): string {
  return [
    target.host.toLowerCase(),
    target.owner.toLowerCase(),
    target.repository.toLowerCase(),
    target.number
  ].join('/');
}

export function createPullRequestDeepLink(
  target: PullRequestDeepLinkTarget
): string {
  const normalized = normalizePullRequestDeepLinkTarget(target);
  const owner = encodeURIComponent(normalized.owner);
  const repository = encodeURIComponent(normalized.repository);

  return (
    `${GIT_GUD_PROTOCOL}://https://${normalized.host}/` +
    `${owner}/${repository}/pull/${normalized.number}`
  );
}

export function createPullRequestDeepLinkFromGitHubUrl(value: string): string {
  return createPullRequestDeepLink(parseGitHubPullRequestUrl(value));
}

export function parsePullRequestDeepLink(
  value: string
): PullRequestDeepLinkTarget | undefined {
  const protocolPrefix = `${GIT_GUD_PROTOCOL}://`;

  if (
    value.slice(0, protocolPrefix.length).toLowerCase() === protocolPrefix &&
    value.slice(protocolPrefix.length, protocolPrefix.length + 8).toLowerCase() ===
      'https://'
  ) {
    try {
      return parseGitHubPullRequestUrl(value.slice(protocolPrefix.length));
    } catch {
      return undefined;
    }
  }

  return parseLegacyPullRequestDeepLink(value);
}

function parseGitHubPullRequestUrl(value: string): PullRequestDeepLinkTarget {
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    segments.length !== 4 ||
    segments[2] !== 'pull'
  ) {
    throw new Error('A valid GitHub pull request URL is required.');
  }

  return normalizePullRequestDeepLinkTarget({
    host: url.hostname,
    owner: decodeURIComponent(segments[0] ?? ''),
    repository: decodeURIComponent(segments[1] ?? ''),
    number: Number(segments[3])
  });
}

function parseLegacyPullRequestDeepLink(
  value: string
): PullRequestDeepLinkTarget | undefined {
  try {
    const url = new URL(value);

    if (
      url.protocol !== `${GIT_GUD_PROTOCOL}:` ||
      url.hostname !== 'pull-request' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }

    const segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    if (segments.length !== 4) {
      return undefined;
    }

    const [host, owner, repository, rawNumber] = segments;
    const number = Number(rawNumber);

    return normalizePullRequestDeepLinkTarget({
      host: host ?? '',
      owner: owner ?? '',
      repository: repository ?? '',
      number
    });
  } catch {
    return undefined;
  }
}

function normalizePullRequestDeepLinkTarget(
  target: PullRequestDeepLinkTarget
): PullRequestDeepLinkTarget {
  const host = normalizeHost(target.host);
  const owner = normalizePathSegment(target.owner, 'Pull request owner');
  const repository = normalizePathSegment(
    target.repository,
    'Pull request repository'
  );

  if (!Number.isSafeInteger(target.number) || target.number <= 0) {
    throw new Error('Pull request number must be a positive integer.');
  }

  return {
    host,
    owner,
    repository,
    number: target.number
  };
}

function normalizeHost(value: string): string {
  const candidate = value.trim().toLowerCase();

  if (!candidate || candidate.includes('/') || candidate.includes('@')) {
    throw new Error('Pull request host must be a hostname.');
  }

  const url = new URL(`https://${candidate}`);

  if (
    url.hostname !== candidate ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/'
  ) {
    throw new Error('Pull request host must be a hostname.');
  }

  return candidate;
}

function normalizePathSegment(value: string, label: string): string {
  const candidate = value.trim();

  if (
    !candidate ||
    candidate === '.' ||
    candidate === '..' ||
    /[\s/?#\\]/u.test(candidate)
  ) {
    throw new Error(`${label} is invalid.`);
  }

  return candidate;
}
