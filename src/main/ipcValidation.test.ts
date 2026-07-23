import { describe, expect, it } from 'vitest';

import { validateIpcArgs } from './ipcValidation';

describe('IPC argument validation', () => {
  it('accepts valid typed command payloads', () => {
    const branchArgs = validateIpcArgs('repo:create-branch', [
      '/repo',
      {
        name: 'feature/ipc-validation',
        checkout: true
      }
    ]);
    const resetArgs = validateIpcArgs('repo:reset', [
      '/repo',
      {
        target: 'HEAD~1',
        mode: 'mixed'
      }
    ]);
    const deleteBranchArgs = validateIpcArgs('repo:delete-branch', [
      '/repo',
      {
        localName: 'feature/ipc-validation',
        remote: { name: 'origin', branch: 'feature/ipc-validation' },
        force: false
      }
    ]);
    const remoteResetArgs = validateIpcArgs('repo:checkout', [
      '/repo',
      {
        kind: 'remote-reset',
        name: 'origin/feature/ipc-validation',
        localName: 'feature/ipc-validation'
      }
    ]);

    expect(branchArgs[1]).toMatchObject({
      name: 'feature/ipc-validation',
      checkout: true
    });
    expect(resetArgs[1]).toMatchObject({
      target: 'HEAD~1',
      mode: 'mixed'
    });
    expect(deleteBranchArgs[1]).toEqual({
      localName: 'feature/ipc-validation',
      remote: { name: 'origin', branch: 'feature/ipc-validation' },
      force: false
    });
    expect(remoteResetArgs[1]).toEqual({
      kind: 'remote-reset',
      name: 'origin/feature/ipc-validation',
      localName: 'feature/ipc-validation'
    });
    expect(validateIpcArgs('repo:discard-file', ['/repo', 'src/main.ts'])).toEqual(['/repo', 'src/main.ts']);
    expect(validateIpcArgs('repo:discard-all', ['/repo'])).toEqual(['/repo']);
    expect(validateIpcArgs('system:open-codex-task', ['/repo', 'Explain this selection.'])).toEqual([
      '/repo',
      'Explain this selection.'
    ]);
    expect(validateIpcArgs('workspace:set-sidebar-width', [420])).toEqual([420]);
    expect(validateIpcArgs('workspace:set-detail-panel-collapsed', [true])).toEqual([true]);
    expect(validateIpcArgs('workspace:set-detail-panel-width', [440])).toEqual([440]);
    expect(validateIpcArgs('repo:replace-path', ['repo:/project', '/project-worktree'])).toEqual([
      'repo:/project',
      '/project-worktree'
    ]);
    expect(validateIpcArgs('profiles:activate', ['profile:kaldy'])).toEqual(['profile:kaldy']);
    expect(validateIpcArgs('profiles:activate', [undefined])).toEqual([undefined]);
    expect(validateIpcArgs('github:pull-request-inbox', ['profile:kaldy'])).toEqual(['profile:kaldy']);
    expect(
      validateIpcArgs('github:pull-request-detail', [
        { profileId: 'profile:kaldy', owner: 'acme', repository: 'widgets', number: 42 }
      ])
    ).toEqual([{ profileId: 'profile:kaldy', owner: 'acme', repository: 'widgets', number: 42 }]);
    expect(
      validateIpcArgs('github:submit-pull-request-review', [
        {
          profileId: 'profile:kaldy',
          owner: 'acme',
          repository: 'widgets',
          number: 42,
          event: 'comment',
          body: '',
          commitId: 'abc123',
          comments: [{
            id: 'draft-line-1',
            body: 'Please cover this edge case.',
            path: 'src/widget.ts',
            line: 18,
            side: 'right'
          }],
          replies: [{
            id: 'draft-reply-1',
            body: 'Agreed — I added this to the review.',
            inReplyToId: 123
          }]
        }
      ])[0]
    ).toMatchObject({
      event: 'comment',
      commitId: 'abc123',
      comments: [{ line: 18, side: 'right', path: 'src/widget.ts' }],
      replies: [{ inReplyToId: 123 }]
    });
    expect(validateIpcArgs('repo:file-history', ['/repo', 'src/app.ts', 50])).toEqual(['/repo', 'src/app.ts', 50]);
    expect(validateIpcArgs('repo:file-blame', ['/repo', 'src/app.ts'])).toEqual(['/repo', 'src/app.ts', undefined]);
    expect(validateIpcArgs('repo:compare', ['/repo', 'main', 'feature/test'])).toEqual(['/repo', 'main', 'feature/test']);
    expect(validateIpcArgs('repo:cherry-pick', ['/repo', ['older-sha', 'newer-sha']])).toEqual([
      '/repo',
      ['older-sha', 'newer-sha']
    ]);
    expect(validateIpcArgs('repo:commit-selection-detail', ['/repo', ['newer-sha', 'older-sha']])).toEqual([
      '/repo',
      ['newer-sha', 'older-sha']
    ]);
    expect(
      validateIpcArgs('repo:file-diff', [
        '/repo',
        { kind: 'selection', shas: ['newer-sha', 'older-sha'], path: 'src/app.ts' }
      ])[1]
    ).toEqual({ kind: 'selection', shas: ['newer-sha', 'older-sha'], path: 'src/app.ts', originalPath: undefined });
    expect(validateIpcArgs('repo:review-plan', ['/repo', { kind: 'commit', sha: 'abc123' }])).toEqual([
      '/repo',
      { kind: 'commit', sha: 'abc123' }
    ]);
    expect(validateIpcArgs('repo:review-plan', ['/repo', { kind: 'wip', scope: 'all' }])).toEqual([
      '/repo',
      { kind: 'wip', scope: 'all' }
    ]);
    expect(
      validateIpcArgs('repo:review-plan', [
        '/repo',
        { kind: 'branch', name: 'feature/review-all', sha: 'abc123' }
      ])
    ).toEqual([
      '/repo',
      { kind: 'branch', name: 'feature/review-all', sha: 'abc123' }
    ]);
    expect(
      validateIpcArgs('repo:set-review-progress', [
        '/repo',
        { targetKey: 'commit:abc123', chunkIds: ['a'.repeat(64)], viewed: true }
      ])
    ).toEqual([
      '/repo',
      { targetKey: 'commit:abc123', chunkIds: ['a'.repeat(64)], viewed: true }
    ]);
    expect(
      validateIpcArgs('repo:stash-drop', [
        '/repo',
        { selector: 'stash@{0}', expectedSha: 'a'.repeat(40) }
      ])
    ).toEqual(['/repo', { selector: 'stash@{0}', expectedSha: 'a'.repeat(40) }]);
    expect(validateIpcArgs('repo:cancel-operation', ['/repo', 'operation-1'])).toEqual([
      '/repo',
      'operation-1'
    ]);
    expect(
      validateIpcArgs('repo:apply-patch', [
        '/repo',
        {
          path: 'README.md',
          mode: 'stage',
          patch: 'diff --git a/README.md b/README.md\n@@ -1,0 +1 @@\n+hello\n'
        }
      ])[1]
    ).toMatchObject({
      path: 'README.md',
      mode: 'stage'
    });
    expect(
      validateIpcArgs('settings:update', [
        {
          defaultDiffStyle: 'split',
          graphPageSize: 750,
          largeRepoMode: true,
          graphColumns: {
            author: false,
            date: true,
            sha: true
          },
          remoteAvatars: true
        }
      ])[0]
    ).toMatchObject({
      defaultDiffStyle: 'split',
      graphPageSize: 750,
      largeRepoMode: true,
      graphColumns: {
        author: false,
        date: true,
        sha: true
      },
      remoteAvatars: true
    });
  });

  it('accepts optional arguments when they are omitted or undefined', () => {
    expect(validateIpcArgs('repo:graph', ['/repo'])).toEqual(['/repo', undefined]);
    expect(validateIpcArgs('tabs:select-file', ['tab-1', undefined])).toEqual(['tab-1', undefined]);
  });

  it('rejects invalid enums before they reach Git commands', () => {
    expect(() =>
      validateIpcArgs('repo:pull', [
        '/repo',
        {
          mode: 'merge'
        }
      ])
    ).toThrow('mode must be one of: ff-only, rebase.');
    expect(() =>
      validateIpcArgs('settings:update', [
        {
          defaultDiffStyle: 'stacked'
        }
      ])
    ).toThrow('defaultDiffStyle must be one of: unified, split.');
  });

  it('rejects malformed nested payloads', () => {
    expect(() =>
      validateIpcArgs('repo:file-diff', [
        '/repo',
        {
          kind: 'wip',
          path: 'README.md',
          staged: 'yes'
        }
      ])
    ).toThrow('staged must be a boolean.');
    expect(() => validateIpcArgs('workspace:set-sidebar-width', [420.5])).toThrow('width must be a positive integer.');
    expect(() => validateIpcArgs('workspace:set-detail-panel-collapsed', ['yes'])).toThrow('collapsed must be a boolean.');
    expect(() => validateIpcArgs('repo:file-history', ['/repo', 'file.ts', 1.5])).toThrow('limit must be a positive integer.');
    expect(() =>
      validateIpcArgs('github:pull-request-detail', [
        { profileId: 'profile:kaldy', owner: '../acme', repository: 'widgets', number: 42 }
      ])
    ).toThrow('owner contains unsupported characters.');
    expect(() =>
      validateIpcArgs('github:submit-pull-request-review', [
        {
          profileId: 'profile:kaldy',
          owner: 'acme',
          repository: 'widgets',
          number: 42,
          event: 'request-changes',
          body: '',
          commitId: 'abc123',
          comments: [],
          replies: []
        }
      ])
    ).toThrow('body must not be empty');
    expect(() => validateIpcArgs('repo:compare', ['/repo', 'main'])).toThrow('repo:compare expected 3 arguments');
    expect(() => validateIpcArgs('repo:cherry-pick', ['/repo', 'not-an-array'])).toThrow(
      'shas must be an array of strings.'
    );
    expect(() =>
      validateIpcArgs(
        'repo:cherry-pick',
        ['/repo', Array.from({ length: 101 }, (_, index) => `sha-${index}`)]
      )
    ).toThrow('shas must contain no more than 100 entries.');
    expect(() =>
      validateIpcArgs('repo:file-diff', ['/repo', { kind: 'selection', shas: 'not-an-array', path: 'file.ts' }])
    ).toThrow('shas must be an array of strings.');
    expect(() => validateIpcArgs('repo:review-plan', ['/repo', { kind: 'wip', scope: 'index' }])).toThrow(
      'scope must be one of: all, staged, unstaged.'
    );
    expect(() =>
      validateIpcArgs('repo:review-plan', ['/repo', { kind: 'branch', name: '', sha: 'abc123' }])
    ).toThrow('name must not be empty.');
    expect(() =>
      validateIpcArgs('repo:set-review-progress', [
        '/repo',
        { targetKey: 'wip:all', chunkIds: ['not-a-hash'], viewed: true }
      ])
    ).toThrow('chunkIds must contain SHA-256 identifiers.');
    expect(() =>
      validateIpcArgs('repo:stash-drop', ['/repo', { selector: 'stash@{0}' }])
    ).toThrow('expectedSha must be a string.');
    expect(() => validateIpcArgs('repo:delete-branch', ['/repo', { force: false }])).toThrow(
      'delete branch input must include a local or remote branch.'
    );
    expect(() => validateIpcArgs('repo:push-tag', ['/repo', { name: 'v1.0.0' }])).toThrow(
      'remote must be a string.'
    );
    expect(() => validateIpcArgs('repo:delete-tag', ['/repo', { name: 'v1.0.0' }])).toThrow(
      'target must be one of: local, remote, both.'
    );
    expect(() =>
      validateIpcArgs('repo:delete-tag', ['/repo', { name: 'v1.0.0', target: 'remote' }])
    ).toThrow('remote must be a string.');
    expect(() =>
      validateIpcArgs('repo:delete-branch', [
        '/repo',
        { remote: { name: 'origin' }, force: false }
      ])
    ).toThrow('branch must be a string.');
    expect(() => validateIpcArgs('repo:cancel-operation', ['/repo'])).toThrow(
      'repo:cancel-operation expected 2 arguments'
    );
    expect(() => validateIpcArgs('repo:cancel-operation', ['/repo', '   '])).toThrow(
      'operationId must not be empty.'
    );
    expect(() => validateIpcArgs('system:open-codex-task', ['/repo', '   '])).toThrow(
      'prompt must not be empty.'
    );
    expect(() =>
      validateIpcArgs('settings:update', [
        {
          graphColumns: { sha: 'yes' }
        }
      ])
    ).toThrow('sha must be a boolean.');
  });
});
