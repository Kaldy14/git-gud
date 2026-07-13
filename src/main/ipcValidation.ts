import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';
import type {
  AppSettingsInput,
  GitCheckoutTarget,
  GitCommitInput,
  GitConflictActionInput,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFileDiffRequest,
  GitInteractiveRebaseAction,
  GitInteractiveRebaseInput,
  GitMergeInput,
  GitPatchApplyInput,
  GitProfile,
  GitPullInput,
  GitPushInput,
  GitRebaseInput,
  GitRenameBranchInput,
  GitResetInput,
  GitStashPushInput,
  GitStashRefInput,
  GitTagCreateInput,
  GitTagDeleteInput
} from '@shared/types';

type IpcArgValidator<TChannel extends IpcChannelName> = (
  args: readonly unknown[]
) => IpcChannelMap[TChannel]['args'];

type IpcArgValidators = {
  [TChannel in IpcChannelName]: IpcArgValidator<TChannel>;
};

const validators = {
  'workspace:get': (args) => noArgs('workspace:get', args),
  'repo:open-dialog': (args) => noArgs('repo:open-dialog', args),
  'repo:open-path': (args) => readOnlyArg(args, 'repo:open-path', 'repoPath', readString),
  'tabs:activate': (args) => readOnlyArg(args, 'tabs:activate', 'tabId', readString),
  'tabs:close': (args) => readOnlyArg(args, 'tabs:close', 'tabId', readString),
  'tabs:select-commit': (args) => readStringWithOptionalString(args, 'tabs:select-commit', 'tabId', 'selectedCommit'),
  'tabs:select-file': (args) => readStringWithOptionalString(args, 'tabs:select-file', 'tabId', 'selectedFile'),
  'workspace:set-sidebar-collapsed': (args) =>
    readOnlyArg(args, 'workspace:set-sidebar-collapsed', 'collapsed', readBoolean),
  'workspace:set-sidebar-width': (args) => readOnlyArg(args, 'workspace:set-sidebar-width', 'width', readPositiveInteger),
  'workspace:set-detail-panel-collapsed': (args) =>
    readOnlyArg(args, 'workspace:set-detail-panel-collapsed', 'collapsed', readBoolean),
  'workspace:set-detail-panel-width': (args) =>
    readOnlyArg(args, 'workspace:set-detail-panel-width', 'width', readPositiveInteger),
  'repo:overview': (args) => readOnlyArg(args, 'repo:overview', 'repoPath', readString),
  'repo:graph': (args) => readRepoPathWithOptionalLimit(args),
  'repo:commit-detail': (args) => readStringPair(args, 'repo:commit-detail', 'repoPath', 'sha'),
  'repo:wip-detail': (args) => readOnlyArg(args, 'repo:wip-detail', 'repoPath', readString),
  'repo:file-diff': (args) => readRepoPathWithObject(args, 'repo:file-diff', readFileDiffRequest),
  'repo:file-history': (args) => readRepoPathAndPathWithOptionalLimit(args),
  'repo:file-blame': (args) => readStringPairWithOptionalString(args, 'repo:file-blame', 'repoPath', 'path', 'revision'),
  'repo:compare': (args) => readStringTriple(args, 'repo:compare', 'repoPath', 'base', 'head'),
  'repo:apply-patch': (args) => readRepoPathWithObject(args, 'repo:apply-patch', readPatchApplyInput),
  'repo:stage-file': (args) => readStringPair(args, 'repo:stage-file', 'repoPath', 'path'),
  'repo:unstage-file': (args) => readStringPair(args, 'repo:unstage-file', 'repoPath', 'path'),
  'repo:discard-file': (args) => readStringPair(args, 'repo:discard-file', 'repoPath', 'path'),
  'repo:discard-all': (args) => readOnlyArg(args, 'repo:discard-all', 'repoPath', readString),
  'repo:open-file': (args) => readStringPair(args, 'repo:open-file', 'repoPath', 'path'),
  'repo:reveal-file': (args) => readStringPair(args, 'repo:reveal-file', 'repoPath', 'path'),
  'repo:stage-all': (args) => readOnlyArg(args, 'repo:stage-all', 'repoPath', readString),
  'repo:unstage-all': (args) => readOnlyArg(args, 'repo:unstage-all', 'repoPath', readString),
  'repo:commit': (args) => readRepoPathWithObject(args, 'repo:commit', readCommitInput),
  'repo:fetch': (args) => readOnlyArg(args, 'repo:fetch', 'repoPath', readString),
  'repo:pull': (args) => readRepoPathWithObject(args, 'repo:pull', readPullInput),
  'repo:push': (args) => readRepoPathWithObject(args, 'repo:push', readPushInput),
  'repo:create-branch': (args) => readRepoPathWithObject(args, 'repo:create-branch', readCreateBranchInput),
  'repo:rename-branch': (args) => readRepoPathWithObject(args, 'repo:rename-branch', readRenameBranchInput),
  'repo:delete-branch': (args) => readRepoPathWithObject(args, 'repo:delete-branch', readDeleteBranchInput),
  'repo:checkout': (args) => readRepoPathWithObject(args, 'repo:checkout', readCheckoutTarget),
  'repo:merge': (args) => readRepoPathWithObject(args, 'repo:merge', readMergeInput),
  'repo:create-tag': (args) => readRepoPathWithObject(args, 'repo:create-tag', readTagCreateInput),
  'repo:delete-tag': (args) => readRepoPathWithObject(args, 'repo:delete-tag', readTagDeleteInput),
  'repo:stash-push': (args) => readRepoPathWithObject(args, 'repo:stash-push', readStashPushInput),
  'repo:stash-apply': (args) => readRepoPathWithObject(args, 'repo:stash-apply', readStashRefInput),
  'repo:stash-pop': (args) => readRepoPathWithObject(args, 'repo:stash-pop', readStashRefInput),
  'repo:stash-drop': (args) => readRepoPathWithObject(args, 'repo:stash-drop', readStashRefInput),
  'repo:cherry-pick': (args) => readStringPair(args, 'repo:cherry-pick', 'repoPath', 'sha'),
  'repo:revert': (args) => readStringPair(args, 'repo:revert', 'repoPath', 'sha'),
  'repo:reset': (args) => readRepoPathWithObject(args, 'repo:reset', readResetInput),
  'repo:rebase': (args) => readRepoPathWithObject(args, 'repo:rebase', readRebaseInput),
  'repo:interactive-rebase-plan': (args) => readStringPair(args, 'repo:interactive-rebase-plan', 'repoPath', 'base'),
  'repo:interactive-rebase': (args) => readRepoPathWithObject(args, 'repo:interactive-rebase', readInteractiveRebaseInput),
  'repo:resolve-conflict': (args) => readRepoPathWithObject(args, 'repo:resolve-conflict', readConflictActionInput),
  'repo:undo': (args) => readStringPair(args, 'repo:undo', 'repoPath', 'undoId'),
  'repo:open-terminal': (args) => readOnlyArg(args, 'repo:open-terminal', 'repoPath', readString),
  'repo:cancel-operation': (args) => readOperationCancellationArgs(args),
  'settings:get': (args) => noArgs('settings:get', args),
  'settings:update': (args) => readOnlyArg(args, 'settings:update', 'settings', readSettingsInput),
  'profiles:list': (args) => noArgs('profiles:list', args),
  'profiles:save': (args) => readOnlyArg(args, 'profiles:save', 'profile', readProfile),
  'repo:assign-profile': (args) => readStringWithOptionalString(args, 'repo:assign-profile', 'repoPath', 'profileId')
} satisfies IpcArgValidators;

export function validateIpcArgs<TChannel extends IpcChannelName>(
  channel: TChannel,
  args: readonly unknown[]
): IpcChannelMap[TChannel]['args'] {
  return validators[channel](args) as IpcChannelMap[TChannel]['args'];
}

function noArgs(channel: string, args: readonly unknown[]): [] {
  assertArgCount(channel, args, 0);
  return [];
}

function readOnlyArg<TValue>(
  args: readonly unknown[],
  channel: string,
  label: string,
  read: (value: unknown, label: string) => TValue
): [TValue] {
  assertArgCount(channel, args, 1);
  return [read(args[0], label)];
}

function readStringPair(
  args: readonly unknown[],
  channel: string,
  firstLabel: string,
  secondLabel: string
): [string, string] {
  assertArgCount(channel, args, 2);
  return [readString(args[0], firstLabel), readString(args[1], secondLabel)];
}

function readOperationCancellationArgs(args: readonly unknown[]): [string, string] {
  assertArgCount('repo:cancel-operation', args, 2);
  return [readString(args[0], 'repoPath'), readNonEmptyString(args[1], 'operationId')];
}

function readStringWithOptionalString(
  args: readonly unknown[],
  channel: string,
  firstLabel: string,
  secondLabel: string
): [string, string | undefined] {
  assertArgCountRange(channel, args, 1, 2);
  return [readString(args[0], firstLabel), readOptionalString(args[1], secondLabel)];
}

function readStringPairWithOptionalString(
  args: readonly unknown[],
  channel: string,
  firstLabel: string,
  secondLabel: string,
  thirdLabel: string
): [string, string, string | undefined] {
  assertArgCountRange(channel, args, 2, 3);
  return [
    readString(args[0], firstLabel),
    readString(args[1], secondLabel),
    readOptionalString(args[2], thirdLabel)
  ];
}

function readStringTriple(
  args: readonly unknown[],
  channel: string,
  firstLabel: string,
  secondLabel: string,
  thirdLabel: string
): [string, string, string] {
  assertArgCount(channel, args, 3);
  return [
    readString(args[0], firstLabel),
    readString(args[1], secondLabel),
    readString(args[2], thirdLabel)
  ];
}

function readRepoPathWithOptionalLimit(args: readonly unknown[]): [string, number | undefined] {
  assertArgCountRange('repo:graph', args, 1, 2);
  return [readString(args[0], 'repoPath'), readOptionalPositiveInteger(args[1], 'limit')];
}

function readRepoPathAndPathWithOptionalLimit(args: readonly unknown[]): [string, string, number | undefined] {
  assertArgCountRange('repo:file-history', args, 2, 3);
  return [
    readString(args[0], 'repoPath'),
    readString(args[1], 'path'),
    readOptionalPositiveInteger(args[2], 'limit')
  ];
}

function readRepoPathWithObject<TValue>(
  args: readonly unknown[],
  channel: string,
  read: (value: unknown) => TValue
): [string, TValue] {
  assertArgCount(channel, args, 2);
  return [readString(args[0], 'repoPath'), read(args[1])];
}

function readCommitInput(value: unknown): GitCommitInput {
  const record = readRecord(value, 'commit input');
  return {
    message: readStringProperty(record, 'message'),
    amend: readBooleanProperty(record, 'amend')
  };
}

function readPullInput(value: unknown): GitPullInput {
  const record = readRecord(value, 'pull input');
  return {
    mode: readEnumProperty(record, 'mode', ['ff-only', 'rebase'])
  };
}

function readPushInput(value: unknown): GitPushInput {
  const record = readRecord(value, 'push input');
  return {
    forceWithLease: readBooleanProperty(record, 'forceWithLease')
  };
}

function readCreateBranchInput(value: unknown): GitCreateBranchInput {
  const record = readRecord(value, 'create branch input');
  return {
    name: readStringProperty(record, 'name'),
    startPoint: readOptionalStringProperty(record, 'startPoint'),
    checkout: readBooleanProperty(record, 'checkout')
  };
}

function readRenameBranchInput(value: unknown): GitRenameBranchInput {
  const record = readRecord(value, 'rename branch input');
  return {
    oldName: readStringProperty(record, 'oldName'),
    newName: readStringProperty(record, 'newName')
  };
}

function readDeleteBranchInput(value: unknown): GitDeleteBranchInput {
  const record = readRecord(value, 'delete branch input');
  return {
    name: readStringProperty(record, 'name'),
    force: readBooleanProperty(record, 'force')
  };
}

function readCheckoutTarget(value: unknown): GitCheckoutTarget {
  const record = readRecord(value, 'checkout target');
  const kind = readEnumProperty(record, 'kind', ['local', 'remote', 'commit']);

  if (kind === 'local') {
    return {
      kind,
      name: readStringProperty(record, 'name')
    };
  }

  if (kind === 'remote') {
    return {
      kind,
      name: readStringProperty(record, 'name'),
      localName: readOptionalStringProperty(record, 'localName')
    };
  }

  return {
    kind,
    sha: readStringProperty(record, 'sha')
  };
}

function readMergeInput(value: unknown): GitMergeInput {
  const record = readRecord(value, 'merge input');
  return {
    ref: readStringProperty(record, 'ref')
  };
}

function readTagCreateInput(value: unknown): GitTagCreateInput {
  const record = readRecord(value, 'tag create input');
  return {
    name: readStringProperty(record, 'name'),
    targetSha: readOptionalStringProperty(record, 'targetSha')
  };
}

function readTagDeleteInput(value: unknown): GitTagDeleteInput {
  const record = readRecord(value, 'tag delete input');
  return {
    name: readStringProperty(record, 'name')
  };
}

function readStashPushInput(value: unknown): GitStashPushInput {
  const record = readRecord(value, 'stash push input');
  return {
    message: readOptionalStringProperty(record, 'message'),
    includeUntracked: readBooleanProperty(record, 'includeUntracked')
  };
}

function readStashRefInput(value: unknown): GitStashRefInput {
  const record = readRecord(value, 'stash ref input');
  return {
    selector: readStringProperty(record, 'selector'),
    expectedSha: readStringProperty(record, 'expectedSha')
  };
}

function readResetInput(value: unknown): GitResetInput {
  const record = readRecord(value, 'reset input');
  return {
    target: readStringProperty(record, 'target'),
    mode: readEnumProperty(record, 'mode', ['soft', 'mixed', 'hard'])
  };
}

function readRebaseInput(value: unknown): GitRebaseInput {
  const record = readRecord(value, 'rebase input');
  return {
    target: readStringProperty(record, 'target')
  };
}

function readInteractiveRebaseInput(value: unknown): GitInteractiveRebaseInput {
  const record = readRecord(value, 'interactive rebase input');
  return {
    base: readStringProperty(record, 'base'),
    commits: readInteractiveRebaseTodoItems(record.commits)
  };
}

function readInteractiveRebaseTodoItems(value: unknown): GitInteractiveRebaseInput['commits'] {
  if (!Array.isArray(value)) {
    throw new Error('commits must be an array.');
  }

  return value.map((item, index) => {
    const record = readRecord(item, `commits[${index}]`);
    return {
      sha: readStringProperty(record, 'sha'),
      action: readEnumProperty<GitInteractiveRebaseAction>(record, 'action', ['pick', 'reword', 'squash', 'fixup', 'drop']),
      message: readOptionalStringProperty(record, 'message')
    };
  });
}

function readConflictActionInput(value: unknown): GitConflictActionInput {
  const record = readRecord(value, 'conflict action input');
  return {
    action: readEnumProperty(record, 'action', ['continue', 'skip', 'abort'])
  };
}

function readFileDiffRequest(value: unknown): GitFileDiffRequest {
  const record = readRecord(value, 'file diff request');
  const kind = readEnumProperty(record, 'kind', ['commit', 'wip']);

  if (kind === 'commit') {
    return {
      kind,
      sha: readStringProperty(record, 'sha'),
      path: readStringProperty(record, 'path'),
      originalPath: readOptionalStringProperty(record, 'originalPath')
    };
  }

  return {
    kind,
    path: readStringProperty(record, 'path'),
    staged: readBooleanProperty(record, 'staged')
  };
}

function readPatchApplyInput(value: unknown): GitPatchApplyInput {
  const record = readRecord(value, 'patch apply input');
  return {
    path: readStringProperty(record, 'path'),
    mode: readEnumProperty(record, 'mode', ['stage', 'unstage']),
    patch: readStringProperty(record, 'patch')
  };
}

function readSettingsInput(value: unknown): AppSettingsInput {
  const record = readRecord(value, 'settings');
  return {
    defaultDiffStyle: readOptionalEnumProperty(record, 'defaultDiffStyle', ['unified', 'split']),
    graphPageSize: readOptionalPositiveIntegerProperty(record, 'graphPageSize'),
    largeRepoMode: readOptionalBooleanProperty(record, 'largeRepoMode'),
    graphColumns: readOptionalGraphColumns(record.graphColumns),
    remoteAvatars: readOptionalBooleanProperty(record, 'remoteAvatars'),
    terminalApp: readOptionalEnumProperty(record, 'terminalApp', ['Terminal'])
  };
}

function readOptionalGraphColumns(value: unknown): AppSettingsInput['graphColumns'] {
  if (value === undefined) {
    return undefined;
  }

  const record = readRecord(value, 'graphColumns');
  return {
    author: readOptionalBooleanProperty(record, 'author'),
    date: readOptionalBooleanProperty(record, 'date'),
    sha: readOptionalBooleanProperty(record, 'sha')
  };
}

function readProfile(value: unknown): GitProfile {
  const record = readRecord(value, 'profile');
  return {
    id: readStringProperty(record, 'id'),
    name: readStringProperty(record, 'name'),
    email: readStringProperty(record, 'email'),
    avatarColor: readStringProperty(record, 'avatarColor'),
    sshKeyPath: readOptionalStringProperty(record, 'sshKeyPath'),
    ghConfigDir: readOptionalStringProperty(record, 'ghConfigDir'),
    signingKey: readOptionalStringProperty(record, 'signingKey'),
    remoteUrlPatterns: readOptionalStringArrayProperty(record, 'remoteUrlPatterns')
  };
}

function assertArgCount(channel: string, args: readonly unknown[], expected: number): void {
  if (args.length !== expected) {
    throw new Error(`${channel} expected ${expected} argument${expected === 1 ? '' : 's'}, received ${args.length}.`);
  }
}

function assertArgCountRange(channel: string, args: readonly unknown[], min: number, max: number): void {
  if (args.length < min || args.length > max) {
    throw new Error(`${channel} expected ${min}-${max} arguments, received ${args.length}.`);
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readStringProperty(record: Record<string, unknown>, property: string): string {
  return readString(record[property], property);
}

function readOptionalStringProperty(record: Record<string, unknown>, property: string): string | undefined {
  return readOptionalString(record[property], property);
}

function readBooleanProperty(record: Record<string, unknown>, property: string): boolean {
  return readBoolean(record[property], property);
}

function readOptionalBooleanProperty(record: Record<string, unknown>, property: string): boolean | undefined {
  if (record[property] === undefined) {
    return undefined;
  }

  return readBoolean(record[property], property);
}

function readEnumProperty<TValue extends string>(
  record: Record<string, unknown>,
  property: string,
  values: readonly TValue[]
): TValue {
  return readEnum(record[property], property, values);
}

function readOptionalEnumProperty<TValue extends string>(
  record: Record<string, unknown>,
  property: string,
  values: readonly TValue[]
): TValue | undefined {
  if (record[property] === undefined) {
    return undefined;
  }

  return readEnum(record[property], property, values);
}

function readOptionalPositiveIntegerProperty(record: Record<string, unknown>, property: string): number | undefined {
  return readOptionalPositiveInteger(record[property], property);
}

function readOptionalStringArrayProperty(record: Record<string, unknown>, property: string): string[] | undefined {
  const value = record[property];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${property} must be an array of strings.`);
  }

  return value.map((item, index) => readString(item, `${property}[${index}]`));
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  const result = readString(value, label);

  if (result.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  return result;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readString(value, label);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function readOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readPositiveInteger(value, label);
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function readEnum<TValue extends string>(value: unknown, label: string, values: readonly TValue[]): TValue {
  if (typeof value === 'string' && values.includes(value as TValue)) {
    return value as TValue;
  }

  throw new Error(`${label} must be one of: ${values.join(', ')}.`);
}
