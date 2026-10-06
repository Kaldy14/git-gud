import type { BranchCleanupEvidence } from '@shared/maintenance';

export const EVIDENCE_LABELS: Record<BranchCleanupEvidence, string> = {
  merged: 'Merged',
  'patch-equivalent': 'Equivalent patches',
  'content-integrated': 'Content in base',
  unmerged: 'Not merged',
  unknown: 'Unknown'
};

export const EVIDENCE_HINTS: Record<BranchCleanupEvidence, string> = {
  merged: 'Every commit on this branch is already part of the comparison branch.',
  'patch-equivalent':
    'Each commit has an equivalent patch in the comparison branch, as after a rebase or cherry-pick. Whitespace is ignored and reverted changes can still match, so this is limited evidence.',
  'content-integrated': 'Merging would not change the comparison branch, as after a squash merge. Likely integrated, not proven.',
  unmerged: 'The branch may contain changes that are not in the comparison branch. Review it before deleting.',
  unknown: 'Git could not determine whether this branch is integrated.'
};

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}

export function formatList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback;
}
