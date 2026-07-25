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
