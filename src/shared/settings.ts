import type { AppSettings } from './types';

export const MIN_GRAPH_PAGE_SIZE = 250;
export const MAX_GRAPH_PAGE_SIZE = 12000;

export function createDefaultAppSettings(): AppSettings {
  return {
    defaultDiffStyle: 'unified',
    graphPageSize: 1500,
    largeRepoMode: false,
    graphColumns: {
      author: true,
      date: true,
      sha: false
    },
    remoteAvatars: false,
    terminalApp: 'Terminal'
  };
}

export function normalizeAppSettings(input: unknown, fallback: AppSettings = createDefaultAppSettings()): AppSettings {
  const settings = isRecord(input) ? input : {};
  const graphColumns = isRecord(settings.graphColumns) ? settings.graphColumns : {};

  return {
    defaultDiffStyle:
      settings.defaultDiffStyle === 'split' || settings.defaultDiffStyle === 'unified'
        ? settings.defaultDiffStyle
        : fallback.defaultDiffStyle,
    graphPageSize: clampGraphPageSize(
      typeof settings.graphPageSize === 'number' ? settings.graphPageSize : fallback.graphPageSize
    ),
    largeRepoMode:
      typeof settings.largeRepoMode === 'boolean' ? settings.largeRepoMode : fallback.largeRepoMode,
    graphColumns: {
      author: typeof graphColumns.author === 'boolean' ? graphColumns.author : fallback.graphColumns.author,
      date: typeof graphColumns.date === 'boolean' ? graphColumns.date : fallback.graphColumns.date,
      sha: typeof graphColumns.sha === 'boolean' ? graphColumns.sha : fallback.graphColumns.sha
    },
    remoteAvatars:
      typeof settings.remoteAvatars === 'boolean' ? settings.remoteAvatars : fallback.remoteAvatars,
    terminalApp: 'Terminal'
  };
}

export function clampGraphPageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return createDefaultAppSettings().graphPageSize;
  }

  return Math.min(MAX_GRAPH_PAGE_SIZE, Math.max(MIN_GRAPH_PAGE_SIZE, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
