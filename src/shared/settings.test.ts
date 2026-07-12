import { describe, expect, it } from 'vitest';

import { createDefaultAppSettings, normalizeAppSettings } from './settings';

describe('app settings', () => {
  it('defaults to readable graph columns and local initials', () => {
    expect(createDefaultAppSettings()).toMatchObject({
      graphColumns: {
        author: true,
        date: true,
        sha: false
      },
      remoteAvatars: false
    });
  });

  it('merges partial nested graph column updates', () => {
    const normalized = normalizeAppSettings({
      graphColumns: {
        sha: true
      },
      remoteAvatars: true
    });

    expect(normalized.graphColumns).toEqual({
      author: true,
      date: true,
      sha: true
    });
    expect(normalized.remoteAvatars).toBe(true);
  });

  it('recovers from valid JSON with the wrong persisted shape', () => {
    expect(normalizeAppSettings(null)).toEqual(createDefaultAppSettings());
    expect(normalizeAppSettings([])).toEqual(createDefaultAppSettings());
    expect(normalizeAppSettings({ graphColumns: null })).toEqual(createDefaultAppSettings());
  });
});
