const LAST_SEEN_RELEASE_STORAGE_KEY = 'git-gud:last-seen-release:v1';

type ReleaseStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function shouldShowChangelog(version: string, storage: ReleaseStorage): boolean {
  const currentVersion = parseReleaseVersion(version);

  if (!currentVersion || currentVersion.every((part) => part === 0)) {
    return false;
  }

  const seenVersion = readSeenVersion(storage);
  const parsedSeenVersion = seenVersion ? parseReleaseVersion(seenVersion) : undefined;

  if (!parsedSeenVersion) {
    return true;
  }

  return compareVersionParts(currentVersion, parsedSeenVersion) > 0;
}

export function markChangelogSeen(version: string, storage: ReleaseStorage): void {
  try {
    storage.setItem(LAST_SEEN_RELEASE_STORAGE_KEY, version);
  } catch {
    // A read-only storage implementation should not block the user from closing the dialog.
  }
}

function readSeenVersion(storage: ReleaseStorage): string | undefined {
  try {
    return storage.getItem(LAST_SEEN_RELEASE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function parseReleaseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].+)?$/.exec(version.trim());

  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionParts(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
