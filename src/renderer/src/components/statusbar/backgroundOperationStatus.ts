import type { OperationLogEntry } from '@renderer/components/operations/OperationLog';

export type BackgroundOperationStatus = {
  id: string;
  label: string;
  status: OperationLogEntry['status'];
  detail?: string;
};

/**
 * Picks the automatic operation to summarize quietly in the status bar for one repository.
 * A running operation wins over terminal history; otherwise the most recent terminal entry
 * is shown until the operation log expires it.
 */
export function selectBackgroundOperationStatus(
  entries: OperationLogEntry[],
  repoPath: string | undefined
): BackgroundOperationStatus | undefined {
  if (!repoPath) {
    return undefined;
  }

  const candidates = entries.filter((entry) => entry.background && entry.repoPath === repoPath);
  const entry =
    candidates.find((candidate) => candidate.status === 'pending') ??
    candidates.reduce<OperationLogEntry | undefined>(
      (latest, candidate) =>
        !latest || Date.parse(candidate.happenedAt) > Date.parse(latest.happenedAt) ? candidate : latest,
      undefined
    );

  return entry
    ? { id: entry.id, label: entry.label, status: entry.status, detail: entry.detail }
    : undefined;
}
