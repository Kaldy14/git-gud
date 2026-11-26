import type {
  GitHubPullRequestDraftFileComment,
  GitHubPullRequestDraftLineComment,
  GitHubPullRequestDraftReply,
  GitHubPullRequestReviewInput
} from '@shared/types';

export type ReviewEvent = GitHubPullRequestReviewInput['event'];

export type PullRequestReviewDraft =
  | (GitHubPullRequestDraftLineComment & {
      kind: 'line';
      createdAt: string;
    })
  | (GitHubPullRequestDraftFileComment & {
      kind: 'file';
      createdAt: string;
    })
  | (GitHubPullRequestDraftReply & {
      kind: 'reply';
      createdAt: string;
    });

// A draft before it gets its id and time (distributes over the draft kinds).
export type NewPullRequestReviewDraft = PullRequestReviewDraft extends infer TDraft
  ? TDraft extends PullRequestReviewDraft ? Omit<TDraft, 'id' | 'createdAt'> : never
  : never;

export function retainUnsubmittedOrFailedDrafts<TDraft extends { id: string }>(
  drafts: TDraft[],
  submittedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>
): TDraft[] {
  return drafts.filter(
    (draft) => !submittedIds.has(draft.id) || failedIds.has(draft.id)
  );
}

export function loadPullRequestReviewDrafts(
  storage: Storage,
  storageKey: string
): PullRequestReviewDraft[] {
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter(isPullRequestReviewDraft) : [];
  } catch {
    return [];
  }
}

export function savePullRequestReviewDrafts(
  storage: Storage,
  storageKey: string,
  drafts: PullRequestReviewDraft[]
): void {
  if (drafts.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(storageKey, JSON.stringify(drafts));
}

/**
 * Removes posted drafts from what storage holds for that pull request, not from a component's state: the
 * submission may finish after the reader left the pull request, and reopening it must not offer them again.
 * Returns the drafts that remain.
 */
export function removeSubmittedDraftsFromStorage(
  storage: Storage,
  storageKey: string,
  submittedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>
): PullRequestReviewDraft[] {
  const remaining = retainUnsubmittedOrFailedDrafts(loadPullRequestReviewDrafts(storage, storageKey), submittedIds, failedIds);
  savePullRequestReviewDrafts(storage, storageKey, remaining);
  return remaining;
}

function isPullRequestReviewDraft(value: unknown): value is PullRequestReviewDraft {
  if (!isRecord(value)) {
    return false;
  }
  const hasBaseFields =
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string';
  if (!hasBaseFields) {
    return false;
  }
  if (value.kind === 'reply') {
    return typeof value.inReplyToId === 'number' && value.inReplyToId > 0;
  }
  if (value.kind === 'file') {
    return typeof value.path === 'string' && value.path.length > 0;
  }
  return (
    value.kind === 'line' &&
    typeof value.path === 'string' &&
    typeof value.line === 'number' &&
    value.line > 0 &&
    (value.side === 'left' || value.side === 'right') &&
    (value.startLine === undefined ||
      (typeof value.startLine === 'number' && value.startLine > 0)) &&
    (value.startSide === undefined ||
      value.startSide === 'left' ||
      value.startSide === 'right')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
