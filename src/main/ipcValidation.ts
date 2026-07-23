import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';
import { MAX_CODEX_DEEP_LINK_PROMPT_LENGTH } from '@shared/codex';
import type {
  AppSettingsInput,
  GitCheckoutTarget,
  GitCommitInput,
  GitConflictActionInput,
  GitConflictFileResolutionInput,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFileDiffRequest,
  GitHubPullRequestLocator,
  GitHubPullRequestMergeInput,
  GitHubPullRequestReviewInput,
  GitInteractiveRebaseAction,
  GitInteractiveRebaseInput,
  GitMergeInput,
  GitPatchApplyInput,
  GitProfile,
  GitPullInput,
  GitPushInput,
  GitRebaseInput,
  GitReviewProgressUpdate,
  GitReviewTarget,
  GitRenameBranchInput,
  GitResetInput,
  GitStashPushInput,
  GitStashRefInput,
  GitTagCreateInput,
  GitTagDeleteInput,
  GitTagPushInput
} from '@shared/types';

type IpcArgValidator<TChannel extends IpcChannelName> = (
  args: readonly unknown[]
) => IpcChannelMap[TChannel]['args'];

type IpcArgValidators = {
  [TChannel in IpcChannelName]: IpcArgValidator<TChannel>;
};

const MAX_BULK_CHERRY_PICK_COMMITS = 100;

const validators = {
  'workspace:get': (args) => noArgs('workspace:get', args),
  'repo:open-dialog': (args) => noArgs('repo:open-dialog', args),
  'repo:open-path': (args) => readOnlyArg(args, 'repo:open-path', 'repoPath', readString),
  'repo:replace-path': (args) => readStringPair(args, 'repo:replace-path', 'tabId', 'repoPath'),
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
  'repo:commit-selection-detail': (args) =>
    readStringAndStringArray(args, 'repo:commit-selection-detail', 'repoPath', 'shas'),
  'repo:wip-detail': (args) => readOnlyArg(args, 'repo:wip-detail', 'repoPath', readString),
  'repo:file-diff': (args) => readRepoPathWithObject(args, 'repo:file-diff', readFileDiffRequest),
  'repo:review-plan': (args) => readRepoPathWithObject(args, 'repo:review-plan', readReviewTarget),
  'repo:review-guide-state': (args) => readReviewGuideStateArgs(args),
  'repo:start-review-guide': (args) => readStartReviewGuideArgs(args),
  'repo:set-review-progress': (args) =>
    readRepoPathWithObject(args, 'repo:set-review-progress', readReviewProgressUpdate),
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
  'system:open-codex-task': (args) => readCodexTaskArgs(args),
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
  'repo:push-tag': (args) => readRepoPathWithObject(args, 'repo:push-tag', readTagPushInput),
  'repo:delete-tag': (args) => readRepoPathWithObject(args, 'repo:delete-tag', readTagDeleteInput),
  'repo:stash-push': (args) => readRepoPathWithObject(args, 'repo:stash-push', readStashPushInput),
  'repo:stash-apply': (args) => readRepoPathWithObject(args, 'repo:stash-apply', readStashRefInput),
  'repo:stash-pop': (args) => readRepoPathWithObject(args, 'repo:stash-pop', readStashRefInput),
  'repo:stash-drop': (args) => readRepoPathWithObject(args, 'repo:stash-drop', readStashRefInput),
  'repo:cherry-pick': (args) =>
    readStringAndLimitedStringArray(
      args,
      'repo:cherry-pick',
      'repoPath',
      'shas',
      MAX_BULK_CHERRY_PICK_COMMITS
    ),
  'repo:revert': (args) => readStringPair(args, 'repo:revert', 'repoPath', 'sha'),
  'repo:reset': (args) => readRepoPathWithObject(args, 'repo:reset', readResetInput),
  'repo:rebase': (args) => readRepoPathWithObject(args, 'repo:rebase', readRebaseInput),
  'repo:interactive-rebase-plan': (args) => readStringPair(args, 'repo:interactive-rebase-plan', 'repoPath', 'base'),
  'repo:interactive-rebase': (args) => readRepoPathWithObject(args, 'repo:interactive-rebase', readInteractiveRebaseInput),
  'repo:resolve-conflict': (args) => readRepoPathWithObject(args, 'repo:resolve-conflict', readConflictActionInput),
  'repo:conflict-file': (args) => readStringPair(args, 'repo:conflict-file', 'repoPath', 'path'),
  'repo:resolve-conflict-file': (args) =>
    readRepoPathWithObject(args, 'repo:resolve-conflict-file', readConflictFileResolutionInput),
  'repo:undo': (args) => readStringPair(args, 'repo:undo', 'repoPath', 'undoId'),
  'repo:cancel-operation': (args) => readOperationCancellationArgs(args),
  'settings:get': (args) => noArgs('settings:get', args),
  'settings:update': (args) => readOnlyArg(args, 'settings:update', 'settings', readSettingsInput),
  'profiles:list': (args) => noArgs('profiles:list', args),
  'profiles:list-github-accounts': (args) => noArgs('profiles:list-github-accounts', args),
  'github:pull-request-inbox': (args) =>
    readOnlyArg(args, 'github:pull-request-inbox', 'profileId', readNonEmptyString),
  'github:pull-request-detail': (args) =>
    readOnlyArg(args, 'github:pull-request-detail', 'locator', readGitHubPullRequestLocator),
  'github:submit-pull-request-review': (args) =>
    readOnlyArg(args, 'github:submit-pull-request-review', 'input', readGitHubPullRequestReviewInput),
  'github:merge-pull-request': (args) =>
    readOnlyArg(args, 'github:merge-pull-request', 'input', readGitHubPullRequestMergeInput),
  'profiles:save': (args) => readOnlyArg(args, 'profiles:save', 'profile', readProfile),
  'profiles:activate': (args) => readOnlyArg(args, 'profiles:activate', 'profileId', readOptionalString),
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

function readStringAndStringArray(
  args: readonly unknown[],
  channel: string,
  stringLabel: string,
  arrayLabel: string
): [string, string[]] {
  assertArgCount(channel, args, 2);
  return [readString(args[0], stringLabel), readStringArray(args[1], arrayLabel)];
}

function readStringAndLimitedStringArray(
  args: readonly unknown[],
  channel: string,
  stringLabel: string,
  arrayLabel: string,
  maxLength: number
): [string, string[]] {
  const [stringValue, arrayValue] = readStringAndStringArray(args, channel, stringLabel, arrayLabel);

  if (arrayValue.length > maxLength) {
    throw new Error(`${arrayLabel} must contain no more than ${maxLength} entries.`);
  }

  return [stringValue, arrayValue];
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

function readCodexTaskArgs(args: readonly unknown[]): [string, string] {
  assertArgCount('system:open-codex-task', args, 2);
  const repoPath = readString(args[0], 'repoPath');
  const prompt = readNonEmptyString(args[1], 'prompt');

  if (prompt.length > MAX_CODEX_DEEP_LINK_PROMPT_LENGTH) {
    throw new Error(`prompt must be ${MAX_CODEX_DEEP_LINK_PROMPT_LENGTH.toLocaleString()} characters or fewer.`);
  }

  return [repoPath, prompt];
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

function readReviewTarget(value: unknown): GitReviewTarget {
  const record = readRecord(value, 'review target');
  const kind = readEnumProperty(record, 'kind', ['branch', 'commit', 'wip']);

  if (kind === 'commit') {
    return {
      kind,
      sha: readNonEmptyString(record.sha, 'sha')
    };
  }

  if (kind === 'branch') {
    return {
      kind,
      name: readNonEmptyString(record.name, 'name'),
      sha: readNonEmptyString(record.sha, 'sha')
    };
  }

  return {
    kind,
    scope: readEnumProperty(record, 'scope', ['all', 'staged', 'unstaged'])
  };
}

function readStartReviewGuideArgs(
  args: readonly unknown[]
): [string, GitReviewTarget, string] {
  assertArgCount('repo:start-review-guide', args, 3);

  return [
    readString(args[0], 'repoPath'),
    readReviewTarget(args[1]),
    readReviewSourceFingerprint(args[2])
  ];
}

function readReviewGuideStateArgs(args: readonly unknown[]): [string, string] {
  assertArgCount('repo:review-guide-state', args, 2);
  return [
    readString(args[0], 'repoPath'),
    readReviewSourceFingerprint(args[1])
  ];
}

function readReviewSourceFingerprint(value: unknown): string {
  const sourceFingerprint = readNonEmptyString(value, 'sourceFingerprint');

  if (!/^[a-f0-9]{64}$/u.test(sourceFingerprint)) {
    throw new Error('sourceFingerprint must be a SHA-256 identifier.');
  }

  return sourceFingerprint;
}

function readReviewProgressUpdate(value: unknown): GitReviewProgressUpdate {
  const record = readRecord(value, 'review progress update');
  const targetKey = readNonEmptyString(record.targetKey, 'targetKey');
  const chunkIds = readStringArray(record.chunkIds, 'chunkIds');

  if (targetKey.length > 256) {
    throw new Error('targetKey must be 256 characters or fewer.');
  }

  if (chunkIds.length === 0 || chunkIds.some((chunkId) => !/^[a-f0-9]{64}$/.test(chunkId))) {
    throw new Error('chunkIds must contain SHA-256 identifiers.');
  }

  return {
    targetKey,
    chunkIds,
    viewed: readBooleanProperty(record, 'viewed')
  };
}

function readGitHubPullRequestLocator(value: unknown): GitHubPullRequestLocator {
  const record = readRecord(value, 'pull request locator');
  return {
    profileId: readNonEmptyString(record.profileId, 'profileId'),
    owner: readGitHubName(record.owner, 'owner'),
    repository: readGitHubName(record.repository, 'repository'),
    number: readPositiveInteger(record.number, 'number')
  };
}

function readGitHubPullRequestReviewInput(value: unknown): GitHubPullRequestReviewInput {
  const record = readRecord(value, 'pull request review input');
  const locator = readGitHubPullRequestLocator(record);
  const event = readEnumProperty(record, 'event', ['comment', 'approve', 'request-changes']);
  const body = readLimitedString(record.body, 'body', 65_536);
  const comments = readGitHubDraftLineComments(record.comments);
  const replies = readGitHubDraftReplies(record.replies);

  if (
    event === 'comment' &&
    body.trim().length === 0 &&
    comments.length === 0 &&
    replies.length === 0
  ) {
    throw new Error('A comment review must include a summary, line comment, or reply.');
  }

  if (event === 'request-changes' && body.trim().length === 0) {
    throw new Error('body must not be empty when requesting changes.');
  }

  return {
    ...locator,
    event,
    body,
    commitId: readNonEmptyLimitedString(record.commitId, 'commitId', 128),
    comments,
    replies
  };
}

function readGitHubDraftLineComments(
  value: unknown
): GitHubPullRequestReviewInput['comments'] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('comments must be an array with at most 100 items.');
  }

  return value.map((item, index) => {
    const record = readRecord(item, `comments[${index}]`);
    const line = readPositiveInteger(record.line, `comments[${index}].line`);
    const startLine = readOptionalPositiveInteger(
      record.startLine,
      `comments[${index}].startLine`
    );
    const side = readEnumProperty(record, 'side', ['left', 'right']);
    const startSide = readOptionalEnumProperty(record, 'startSide', ['left', 'right']);

    if (startLine !== undefined && startLine > line) {
      throw new Error(`comments[${index}].startLine must be before or equal to line.`);
    }

    if (startLine !== undefined && startSide === undefined) {
      throw new Error(`comments[${index}].startSide is required when startLine is provided.`);
    }

    return {
      id: readNonEmptyLimitedString(record.id, `comments[${index}].id`, 128),
      body: readNonEmptyLimitedString(record.body, `comments[${index}].body`, 65_536),
      path: readNonEmptyLimitedString(record.path, `comments[${index}].path`, 4_096),
      line,
      side,
      startLine,
      startSide
    };
  });
}

function readGitHubDraftReplies(
  value: unknown
): GitHubPullRequestReviewInput['replies'] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('replies must be an array with at most 100 items.');
  }

  return value.map((item, index) => {
    const record = readRecord(item, `replies[${index}]`);
    return {
      id: readNonEmptyLimitedString(record.id, `replies[${index}].id`, 128),
      body: readNonEmptyLimitedString(record.body, `replies[${index}].body`, 65_536),
      inReplyToId: readPositiveInteger(
        record.inReplyToId,
        `replies[${index}].inReplyToId`
      )
    };
  });
}

function readGitHubPullRequestMergeInput(value: unknown): GitHubPullRequestMergeInput {
  const record = readRecord(value, 'pull request merge input');
  return {
    ...readGitHubPullRequestLocator(record),
    method: readEnumProperty(record, 'method', ['merge', 'squash', 'rebase'])
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
  const localName = readOptionalStringProperty(record, 'localName');
  const remote = readOptionalDeleteBranchRemote(record.remote);

  if (!localName && !remote) {
    throw new Error('delete branch input must include a local or remote branch.');
  }

  return {
    ...(localName ? { localName } : {}),
    ...(remote ? { remote } : {}),
    force: readBooleanProperty(record, 'force')
  };
}

function readOptionalDeleteBranchRemote(value: unknown): GitDeleteBranchInput['remote'] {
  if (value === undefined) {
    return undefined;
  }

  const record = readRecord(value, 'delete branch remote');
  return {
    name: readStringProperty(record, 'name'),
    branch: readStringProperty(record, 'branch')
  };
}

function readCheckoutTarget(value: unknown): GitCheckoutTarget {
  const record = readRecord(value, 'checkout target');
  const kind = readEnumProperty(record, 'kind', ['local', 'remote', 'remote-reset', 'commit']);

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

  if (kind === 'remote-reset') {
    return {
      kind,
      name: readStringProperty(record, 'name'),
      localName: readStringProperty(record, 'localName')
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

function readTagPushInput(value: unknown): GitTagPushInput {
  const record = readRecord(value, 'tag push input');
  return {
    name: readStringProperty(record, 'name'),
    remote: readStringProperty(record, 'remote')
  };
}

function readTagDeleteInput(value: unknown): GitTagDeleteInput {
  const record = readRecord(value, 'tag delete input');
  const name = readStringProperty(record, 'name');
  const target = readEnumProperty(record, 'target', ['local', 'remote', 'both']);

  if (target !== 'local') {
    return {
      name,
      target,
      remote: readStringProperty(record, 'remote')
    };
  }

  return {
    name,
    target
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

function readConflictFileResolutionInput(value: unknown): GitConflictFileResolutionInput {
  const record = readRecord(value, 'conflict file resolution input');
  const resolution = readEnumProperty(record, 'resolution', ['content', 'ours', 'theirs', 'delete']);
  const content = readOptionalStringProperty(record, 'content');

  if (resolution === 'content' && content === undefined) {
    throw new Error('content is required for a content conflict resolution.');
  }

  return {
    path: readStringProperty(record, 'path'),
    resolution,
    ...(content !== undefined ? { content } : {})
  };
}

function readFileDiffRequest(value: unknown): GitFileDiffRequest {
  const record = readRecord(value, 'file diff request');
  const kind = readEnumProperty(record, 'kind', ['commit', 'selection', 'wip']);

  if (kind === 'commit') {
    return {
      kind,
      sha: readStringProperty(record, 'sha'),
      path: readStringProperty(record, 'path'),
      originalPath: readOptionalStringProperty(record, 'originalPath')
    };
  }

  if (kind === 'selection') {
    return {
      kind,
      shas: readStringArray(record.shas, 'shas'),
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
    diffSyntaxTheme: readOptionalEnumProperty(record, 'diffSyntaxTheme', ['git-gud-dark', 'tokyo-night-storm']),
    graphPageSize: readOptionalPositiveIntegerProperty(record, 'graphPageSize'),
    largeRepoMode: readOptionalBooleanProperty(record, 'largeRepoMode'),
    graphColumns: readOptionalGraphColumns(record.graphColumns),
    remoteAvatars: readOptionalBooleanProperty(record, 'remoteAvatars')
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
    githubLogin: readOptionalStringProperty(record, 'githubLogin'),
    githubHost: readOptionalStringProperty(record, 'githubHost'),
    signingKey: readOptionalStringProperty(record, 'signingKey'),
    remoteUrlPatterns: readOptionalStringArrayProperty(record, 'remoteUrlPatterns')
  };
}

function readGitHubName(value: unknown, label: string): string {
  const name = readNonEmptyLimitedString(value, label, 100);

  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`${label} contains unsupported characters.`);
  }

  return name;
}

function readLimitedString(value: unknown, label: string, maxLength: number): string {
  const text = readString(value, label);

  if (text.length > maxLength) {
    throw new Error(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`);
  }

  return text;
}

function readNonEmptyLimitedString(value: unknown, label: string, maxLength: number): string {
  const text = readLimitedString(value, label, maxLength);

  if (text.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  return text;
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

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value.map((item, index) => readString(item, `${label}[${index}]`));
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
