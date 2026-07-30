export const externalApplicationIds = [
  'vscode',
  'cursor',
  'zed',
  'finder',
  'terminal',
  'iterm2',
  'ghostty',
  'warp',
  'xcode',
  'webstorm'
] as const;

export type ExternalApplicationId = (typeof externalApplicationIds)[number];

export type ExternalApplication = {
  id: ExternalApplicationId;
  name: string;
  iconDataUrl: string;
};

export type OpenPullRequestInApplicationInput = {
  applicationId: ExternalApplicationId;
  url: string;
  owner: string;
  repository: string;
  number: number;
  headSha: string;
};

export type OpenPullRequestInApplicationResult = {
  applicationName: string;
  worktreePath: string;
  cleanup: 'when-closed' | 'automatic';
  message: string;
};

export function isExternalApplicationId(value: unknown): value is ExternalApplicationId {
  return externalApplicationIds.includes(value as ExternalApplicationId);
}
