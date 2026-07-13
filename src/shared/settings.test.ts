import { describe, expect, it } from 'vitest';

import { createDefaultAppSettings, normalizeAppSettings } from './settings';

describe('app settings', () => {
  it('defaults to a focused commit graph and local initials', () => {
    expect(createDefaultAppSettings()).toMatchObject({
      graphColumns: {
        author: false,
        date: false,
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
      author: false,
      date: false,
      sha: true
    });
    expect(normalized.remoteAvatars).toBe(true);
  });

  it('keeps legacy author and date preferences hidden', () => {
    expect(normalizeAppSettings({ graphColumns: { author: true, date: true } }).graphColumns).toEqual({
      author: false,
      date: false,
      sha: false
    });
  });

  it('recovers from valid JSON with the wrong persisted shape', () => {
    expect(normalizeAppSettings(null)).toEqual(createDefaultAppSettings());
    expect(normalizeAppSettings([])).toEqual(createDefaultAppSettings());
    expect(normalizeAppSettings({ graphColumns: null })).toEqual(createDefaultAppSettings());
  });
});
