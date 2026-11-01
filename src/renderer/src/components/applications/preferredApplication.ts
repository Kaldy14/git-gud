import { isExternalApplicationId, type ExternalApplication, type ExternalApplicationId } from '@shared/externalApplications';

export const pullRequestApplicationStorageKey = 'git-gud:open-pr-application:v1';
export const repositoryApplicationStorageKey = 'git-gud:open-repository-application:v1';

// Xcode opens projects and packages rather than arbitrary folders, so it is not offered for whole repositories.
const applicationsUnsuitedToRepositories: readonly ExternalApplicationId[] = ['xcode'];

export function repositoryApplications(applications: readonly ExternalApplication[]): ExternalApplication[] {
  return applications.filter((application) => !applicationsUnsuitedToRepositories.includes(application.id));
}

export function selectApplication(
  applications: readonly ExternalApplication[],
  preferredApplicationId: ExternalApplicationId | undefined
): ExternalApplication | undefined {
  return (
    applications.find((application) => application.id === preferredApplicationId) ??
    applications.find((application) => application.id === 'cursor') ??
    applications.find((application) => application.id === 'vscode') ??
    applications[0]
  );
}

export function loadPreferredApplication(
  storage: Storage,
  storageKey = pullRequestApplicationStorageKey
): ExternalApplicationId | undefined {
  const value = storage.getItem(storageKey);
  return value && isExternalApplicationId(value) ? value : undefined;
}

export function savePreferredApplication(
  storage: Storage,
  applicationId: ExternalApplicationId,
  storageKey = pullRequestApplicationStorageKey
): void {
  storage.setItem(storageKey, applicationId);
}
