import { describe, expect, it } from 'vitest';

import { createDefaultAppSettings, normalizeAppSettings } from './settings';

describe('app settings', () => {
  it('defaults to a focused commit graph and Gravatar author images', () => {
    expect(createDefaultAppSettings()).toMatchObject({
      diffSyntaxTheme: 'git-gud-dark',
      graphColumns: {
        author: false,
        date: false,
        sha: false
      },
      remoteAvatars: true
    });
  });

  it('keeps valid syntax themes and repairs unknown persisted values', () => {
    expect(normalizeAppSettings({ diffSyntaxTheme: 'tokyo-night-storm' }).diffSyntaxTheme).toBe(
      'tokyo-night-storm'
    );
    expect(normalizeAppSettings({ diffSyntaxTheme: 'unknown' }).diffSyntaxTheme).toBe('git-gud-dark');
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

  it('restores Gravatar for legacy settings while preserving an explicit opt-out', () => {
    expect(normalizeAppSettings({ graphPageSize: 1500 }).remoteAvatars).toBe(true);
    expect(normalizeAppSettings({ remoteAvatars: false }).remoteAvatars).toBe(false);
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
