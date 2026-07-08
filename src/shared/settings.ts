import type { AppSettings, AppSettingsInput } from './types';

export const MIN_GRAPH_PAGE_SIZE = 250;
export const MAX_GRAPH_PAGE_SIZE = 12000;

export function createDefaultAppSettings(): AppSettings {
  return {
    defaultDiffStyle: 'unified',
    graphPageSize: 1500,
    largeRepoMode: false,
    terminalApp: 'Terminal'
  };
}

export function normalizeAppSettings(input: AppSettingsInput, fallback: AppSettings = createDefaultAppSettings()): AppSettings {
  return {
    defaultDiffStyle: input.defaultDiffStyle === 'split' || input.defaultDiffStyle === 'unified' ? input.defaultDiffStyle : fallback.defaultDiffStyle,
    graphPageSize: clampGraphPageSize(input.graphPageSize ?? fallback.graphPageSize),
    largeRepoMode: typeof input.largeRepoMode === 'boolean' ? input.largeRepoMode : fallback.largeRepoMode,
    terminalApp: 'Terminal'
  };
}

export function clampGraphPageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return createDefaultAppSettings().graphPageSize;
  }

  return Math.min(MAX_GRAPH_PAGE_SIZE, Math.max(MIN_GRAPH_PAGE_SIZE, Math.round(value)));
}
