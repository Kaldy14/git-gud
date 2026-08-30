import { describe, expect, it, vi } from 'vitest';

import { markChangelogSeen, shouldShowChangelog } from './changelogVisibility';

function storageWithSeenVersion(seenVersion?: string): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: vi.fn(() => seenVersion ?? null),
    setItem: vi.fn()
  };
}

describe('changelog visibility', () => {
  it('shows a real release when no version was acknowledged', () => {
    expect(shouldShowChangelog('0.4.23', storageWithSeenVersion())).toBe(true);
  });

  it('shows only versions newer than the acknowledged release', () => {
    expect(shouldShowChangelog('0.4.24', storageWithSeenVersion('0.4.23'))).toBe(true);
    expect(shouldShowChangelog('0.4.23', storageWithSeenVersion('0.4.23'))).toBe(false);
    expect(shouldShowChangelog('0.4.22', storageWithSeenVersion('0.4.23'))).toBe(false);
  });

  it('stays hidden for source builds and invalid versions', () => {
    expect(shouldShowChangelog('0.0.0', storageWithSeenVersion())).toBe(false);
    expect(shouldShowChangelog('dev', storageWithSeenVersion())).toBe(false);
  });

  it('records the acknowledged version without failing on read-only storage', () => {
    const storage = storageWithSeenVersion();
    markChangelogSeen('0.4.23', storage);
    expect(storage.setItem).toHaveBeenCalledWith('git-gud:last-seen-release:v1', '0.4.23');

    expect(() =>
      markChangelogSeen('0.4.23', {
        getItem: () => null,
        setItem: () => {
          throw new Error('read only');
        }
      })
    ).not.toThrow();
  });
});
