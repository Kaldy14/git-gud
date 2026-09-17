const DISMISSED_PULL_REQUEST_SUGGESTIONS_STORAGE_PREFIX =
  'git-gud:dismissed-pull-request-suggestions:v1:';
const MAX_DISMISSED_PULL_REQUEST_SUGGESTIONS = 200;

export function loadDismissedPullRequestSuggestionIds(
  storage: Pick<Storage, 'getItem'>,
  profileId: string
): Set<string> {
  const stored = storage.getItem(dismissedPullRequestSuggestionsStorageKey(profileId));

  if (!stored) {
    return new Set();
  }

  try {
    const value: unknown = JSON.parse(stored);

    if (!Array.isArray(value)) {
      return new Set();
    }

    return new Set(
      value
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(-MAX_DISMISSED_PULL_REQUEST_SUGGESTIONS)
    );
  } catch {
    return new Set();
  }
}

export function saveDismissedPullRequestSuggestionIds(
  storage: Pick<Storage, 'setItem'>,
  profileId: string,
  dismissedIds: ReadonlySet<string>
): void {
  storage.setItem(
    dismissedPullRequestSuggestionsStorageKey(profileId),
    JSON.stringify([...dismissedIds].slice(-MAX_DISMISSED_PULL_REQUEST_SUGGESTIONS))
  );
}

function dismissedPullRequestSuggestionsStorageKey(profileId: string): string {
  return `${DISMISSED_PULL_REQUEST_SUGGESTIONS_STORAGE_PREFIX}${encodeURIComponent(profileId)}`;
}
