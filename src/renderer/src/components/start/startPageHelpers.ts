import type { RecentRepository } from '@shared/types';

export function filterRecentRepositories(
  recentRepos: RecentRepository[],
  search: string
): RecentRepository[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();

  if (!normalizedSearch) {
    return recentRepos;
  }

  return recentRepos.filter((repo) =>
    `${repo.name}\n${repo.path}`.toLocaleLowerCase().includes(normalizedSearch)
  );
}

export function githubCloneUrl(value: string): string | undefined {
  const trimmed = value.trim().replace(/\.git$/u, '');
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/u.exec(trimmed);

  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`;
  }

  if (/^[^/\s]+\/[^/\s]+$/u.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }

  try {
    const url = new URL(trimmed);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (url.hostname.toLocaleLowerCase() !== 'github.com' || pathParts.length !== 2) {
      return undefined;
    }

    return `https://github.com/${pathParts[0]}/${pathParts[1]}.git`;
  } catch {
    return undefined;
  }
}

export function cloneDirectoryNameFromSource(sourceUrl: string | undefined): string {
  if (!sourceUrl) {
    return '';
  }

  const withoutSuffix = sourceUrl.replace(/[\\/]+$/u, '').replace(/\.git$/u, '');
  return withoutSuffix.split(/[/:]/u).filter(Boolean).at(-1) ?? '';
}

/** Says what still blocks Clone, so a disabled button is never a dead end. */
export function cloneMissingInputHint(
  source: 'url' | 'github',
  normalizedUrl: string | undefined,
  rawSource: string,
  parentDirectory: string
): string | undefined {
  if (!normalizedUrl) {
    if (source === 'url') {
      return 'Enter a repository URL.';
    }

    return rawSource.trim() ? 'Use owner/repository or a GitHub.com URL.' : 'Enter a GitHub repository.';
  }

  return parentDirectory.trim() ? undefined : 'Choose a folder to clone into.';
}

/** Says what still blocks Create, so a disabled button is never a dead end. */
export function createMissingInputHint(
  name: string,
  parentDirectory: string,
  defaultBranch: string
): string | undefined {
  if (!name.trim()) {
    return 'Enter a repository name.';
  }

  if (!parentDirectory.trim()) {
    return 'Choose a location.';
  }

  return defaultBranch.trim() ? undefined : 'Enter a default branch.';
}
