import { isExternalApplicationId, type ExternalApplication, type ExternalApplicationId } from '@shared/externalApplications';
const preferredApplicationStorageKey = 'git-gud:open-pr-application:v1';
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

export function loadPreferredApplication(storage: Storage): ExternalApplicationId | undefined {
  const value = storage.getItem(preferredApplicationStorageKey);
  return value && isExternalApplicationId(value) ? value : undefined;
}

export function savePreferredApplication(
  storage: Storage,
  applicationId: ExternalApplicationId
): void {
  storage.setItem(preferredApplicationStorageKey, applicationId);
}
