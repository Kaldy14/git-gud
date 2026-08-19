import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTO_FETCH_INTERVAL_MINUTES,
  createDefaultAppSettings,
  normalizeAppSettings
} from './settings';

describe('app settings', () => {
  it('defaults to a focused commit graph and Gravatar author images', () => {
    expect(createDefaultAppSettings()).toMatchObject({
      diffSyntaxTheme: 'git-gud-dark',
      defaultSyncOperation: 'fetch-all',
      autoFetchIntervalMinutes: DEFAULT_AUTO_FETCH_INTERVAL_MINUTES,
      graphColumns: {
        author: false,
        date: false,
        sha: false
      },
      confirmForcePush: true,
      remoteAvatars: true
    });
  });

  it('defaults auto-fetch to one minute and accepts zero as disabled', () => {
    expect(normalizeAppSettings({}).autoFetchIntervalMinutes).toBe(1);
    expect(normalizeAppSettings({ autoFetchIntervalMinutes: 0 }).autoFetchIntervalMinutes).toBe(0);
    expect(normalizeAppSettings({ autoFetchIntervalMinutes: 60 }).autoFetchIntervalMinutes).toBe(60);
  });

  it('normalizes auto-fetch intervals to the supported whole-minute range', () => {
    expect(normalizeAppSettings({ autoFetchIntervalMinutes: -1 }).autoFetchIntervalMinutes).toBe(0);
    expect(normalizeAppSettings({ autoFetchIntervalMinutes: 2.6 }).autoFetchIntervalMinutes).toBe(3);
    expect(normalizeAppSettings({ autoFetchIntervalMinutes: 61 }).autoFetchIntervalMinutes).toBe(60);
    expect(normalizeAppSettings({ autoFetchIntervalMinutes: Number.NaN }).autoFetchIntervalMinutes).toBe(1);
  });

  it('keeps valid syntax themes and repairs unknown persisted values', () => {
    expect(normalizeAppSettings({ diffSyntaxTheme: 'tokyo-night-storm' }).diffSyntaxTheme).toBe(
      'tokyo-night-storm'
    );
    expect(normalizeAppSettings({ diffSyntaxTheme: 'unknown' }).diffSyntaxTheme).toBe('git-gud-dark');
  });

  it('keeps supported sync operations and repairs unknown persisted values', () => {
    expect(normalizeAppSettings({ defaultSyncOperation: 'pull-ff' }).defaultSyncOperation).toBe('pull-ff');
    expect(normalizeAppSettings({ defaultSyncOperation: 'pull-ff-only' }).defaultSyncOperation).toBe('pull-ff-only');
    expect(normalizeAppSettings({ defaultSyncOperation: 'pull-rebase' }).defaultSyncOperation).toBe('pull-rebase');
    expect(normalizeAppSettings({ defaultSyncOperation: 'unknown' }).defaultSyncOperation).toBe('fetch-all');
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

  it('requires force-push confirmation by default and preserves an explicit opt-out', () => {
    expect(normalizeAppSettings({ graphPageSize: 1500 }).confirmForcePush).toBe(true);
    expect(normalizeAppSettings({ confirmForcePush: false }).confirmForcePush).toBe(false);
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
