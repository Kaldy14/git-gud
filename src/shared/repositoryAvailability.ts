export const REPOSITORY_UNAVAILABLE_ERROR_PREFIX = 'Repository folder is unavailable:';

export function repositoryUnavailableErrorMessage(repoPath: string): string {
  return `${REPOSITORY_UNAVAILABLE_ERROR_PREFIX} ${repoPath}`;
}

export function isRepositoryUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.includes(REPOSITORY_UNAVAILABLE_ERROR_PREFIX);
}
