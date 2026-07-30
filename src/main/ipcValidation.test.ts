import { describe, expect, it } from 'vitest';

import { validateIpcArgs } from './ipcValidation';

describe('IPC argument validation', () => {
  it('accepts valid typed command payloads', () => {
    expect(validateIpcArgs('updates:get-state', [])).toEqual([]);
    expect(validateIpcArgs('updates:apply', [])).toEqual([]);
    expect(validateIpcArgs('dev:review-grouping-benchmarks', [])).toEqual([]);
    expect(validateIpcArgs('dev:review-grouping-preview', ['tsx-prop-migration'])).toEqual([
      'tsx-prop-migration'
    ]);

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
    const pushArgs = validateIpcArgs('repo:push', [
      '/repo',
      {
        forceWithLease: false,
        branch: 'feature/ipc-validation'
      }
    ]);
    const forcePushArgs = validateIpcArgs('repo:push', [
      '/repo',
      {
        forceWithLease: true,
        branch: 'feature/ipc-validation',
        expectedLocalSha: 'a'.repeat(40),
        target: {
          remote: 'origin',
          branch: 'feature/ipc-validation',
          expectedSha: 'b'.repeat(40),
          setUpstream: false
        }
      }
    ]);
    const tagArgs = validateIpcArgs('repo:create-tag', [
      '/repo',
      {
        name: 'v1.0.0',
        targetSha: 'abc123',
        annotated: true,
        pushRemote: 'origin'
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
    expect(pushArgs[1]).toEqual({
      forceWithLease: false,
      branch: 'feature/ipc-validation'
    });
    expect(forcePushArgs[1]).toEqual({
      forceWithLease: true,
      branch: 'feature/ipc-validation',
      expectedLocalSha: 'a'.repeat(40),
      target: {
        remote: 'origin',
        branch: 'feature/ipc-validation',
        expectedSha: 'b'.repeat(40),
        setUpstream: false
      }
    });
    expect(tagArgs[1]).toEqual({
      name: 'v1.0.0',
      targetSha: 'abc123',
      annotated: true,
      pushRemote: 'origin'
    });
    expect(validateIpcArgs('repo:discard-file', ['/repo', 'src/main.ts'])).toEqual(['/repo', 'src/main.ts']);
    expect(validateIpcArgs('repo:discard-all', ['/repo'])).toEqual(['/repo']);
    expect(
      validateIpcArgs('repo:initialize', [
        { parentDirectory: '/projects', name: 'git-gud', defaultBranch: 'main' }
      ])
    ).toEqual([{ parentDirectory: '/projects', name: 'git-gud', defaultBranch: 'main' }]);
    expect(
      validateIpcArgs('repo:clone', [
        { parentDirectory: '/projects', sourceUrl: 'https://github.com/acme/widgets.git' }
      ])
    ).toEqual([
      {
        parentDirectory: '/projects',
        sourceUrl: 'https://github.com/acme/widgets.git',
        directoryName: undefined
      }
    ]);
    expect(validateIpcArgs('system:open-codex-task', ['/repo', 'Explain this selection.'])).toEqual([
      '/repo',
      'Explain this selection.'
    ]);
    expect(validateIpcArgs('workspace:set-sidebar-width', [420])).toEqual([420]);
    expect(validateIpcArgs('workspace:set-detail-panel-collapsed', [true])).toEqual([true]);
    expect(validateIpcArgs('workspace:set-detail-panel-width', [440])).toEqual([440]);
    expect(validateIpcArgs('settings:update', [{ confirmForcePush: false }])).toEqual([
      {
        defaultDiffStyle: undefined,
        diffSyntaxTheme: undefined,
        graphPageSize: undefined,
        largeRepoMode: undefined,
        confirmForcePush: false,
        graphColumns: undefined,
        remoteAvatars: undefined
      }
    ]);
    expect(validateIpcArgs('repo:replace-path', ['repo:/project', '/project-worktree'])).toEqual([
      'repo:/project',
      '/project-worktree'
    ]);
    expect(validateIpcArgs('tabs:reorder', ['repo:/project', 0])).toEqual([
      'repo:/project',
      0
    ]);
    expect(validateIpcArgs('profiles:activate', ['profile:kaldy'])).toEqual(['profile:kaldy']);
    expect(validateIpcArgs('profiles:activate', [undefined])).toEqual([undefined]);
    expect(validateIpcArgs('github:pull-request-inbox', ['profile:kaldy'])).toEqual(['profile:kaldy']);
    expect(validateIpcArgs('dashboards:select', ['profile:kaldy', 'dashboard:actions'])).toEqual([
      'profile:kaldy',
      'dashboard:actions'
    ]);
    expect(validateIpcArgs('dashboards:alerts', ['profile:kaldy'])).toEqual([
      'profile:kaldy'
    ]);
    expect(
      validateIpcArgs('dashboards:alerts-mark-read', [
        'profile:kaldy',
        ['alert:one', 'alert:two']
      ])
    ).toEqual(['profile:kaldy', ['alert:one', 'alert:two']]);
    expect(
      validateIpcArgs('dashboards:save', [
        {
          profileId: 'profile:kaldy',
          name: 'Delivery',
          tiles: [
            {
              kind: 'github-actions',
              owner: 'acme',
              repository: 'widgets',
              limit: 10,
              view: 'runs',
              filters: {
                branches: ['main', 'release/next'],
                includeTags: true,
                includeMyPullRequests: false
              }
            },
            {
              kind: 'portainer-swarm-stack',
              startsNewRow: true,
              connectionId: 'portainer:production',
              endpointId: 3,
              stackId: 12,
              stackName: 'storefront',
              environmentName: 'Production Swarm'
            }
          ]
        }
      ])[0]
    ).toMatchObject({
      profileId: 'profile:kaldy',
      name: 'Delivery',
      tiles: [
        {
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          view: 'runs',
          filters: {
            branches: ['main', 'release/next'],
            includeTags: true,
            includeMyPullRequests: false
          }
        },
        {
          startsNewRow: true,
          connectionId: 'portainer:production',
          endpointId: 3,
          stackId: 12,
          stackName: 'storefront',
          environmentName: 'Production Swarm'
        }
      ]
    });
    expect(
      validateIpcArgs('portainer:connection-save', [
        {
          name: 'Production',
          baseUrl: 'https://portainer.example.com',
          accessToken: 'ptr_secret',
          tlsVerify: true
        }
      ])
    ).toEqual([
      {
        id: undefined,
        name: 'Production',
        baseUrl: 'https://portainer.example.com',
        accessToken: 'ptr_secret',
        tlsVerify: true
      }
    ]);
    expect(
      validateIpcArgs('portainer:stack-runtime', [
        {
          connectionId: 'portainer:production',
          endpointId: 3,
          stackId: 12,
          stackName: 'storefront'
        }
      ])
    ).toEqual([
      {
        connectionId: 'portainer:production',
        endpointId: 3,
        stackId: 12,
        stackName: 'storefront'
      }
    ]);
    expect(
      validateIpcArgs('portainer:stack-images', [
        {
          connectionId: 'portainer:production',
          endpointId: 3,
          stackId: 12,
          stackName: 'storefront',
          refresh: true
        }
      ])
    ).toEqual([
      {
        connectionId: 'portainer:production',
        endpointId: 3,
        stackId: 12,
        stackName: 'storefront',
        refresh: true
      }
    ]);
    expect(
      validateIpcArgs('github:actions-runs', [
        {
          profileId: 'profile:kaldy',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          view: 'pull-requests',
          filters: {
            branches: ['main'],
            includeTags: false,
            includeMyPullRequests: true
          }
        }
      ])
    ).toEqual([
      {
        profileId: 'profile:kaldy',
        owner: 'acme',
        repository: 'widgets',
        limit: 10,
        view: 'pull-requests',
        filters: {
          branches: ['main'],
          includeTags: false,
          includeMyPullRequests: true
        }
      }
    ]);
    expect(
      validateIpcArgs('github:pull-request-detail', [
        { profileId: 'profile:kaldy', owner: 'acme', repository: 'widgets', number: 42 }
      ])
    ).toEqual([{ profileId: 'profile:kaldy', owner: 'acme', repository: 'widgets', number: 42 }]);
    expect(
      validateIpcArgs('github:start-pull-request-review-guide', [
        { profileId: 'profile:kaldy', owner: 'acme', repository: 'widgets', number: 42 },
        'a'.repeat(64)
      ])
    ).toEqual([
      { profileId: 'profile:kaldy', owner: 'acme', repository: 'widgets', number: 42 },
      'a'.repeat(64)
    ]);
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
           fileComments: [{
             id: 'draft-file-1',
             body: 'This file needs a module-level test.',
             path: 'src/widget.ts'
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
      fileComments: [{ path: 'src/widget.ts' }],
      replies: [{ inReplyToId: 123 }]
    });
    expect(
      validateIpcArgs('github:update-pull-request-review-comment', [{
        profileId: 'profile:kaldy',
        owner: 'acme',
        repository: 'widgets',
        number: 42,
        commentId: 123,
        body: 'Updated review comment'
      }])
    ).toEqual([{
      profileId: 'profile:kaldy',
      owner: 'acme',
      repository: 'widgets',
      number: 42,
      commentId: 123,
      body: 'Updated review comment'
    }]);
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
      validateIpcArgs('repo:commit', [
        '/repo',
        {
          message: 'Updated commit message',
          amend: true,
          expectedHead: 'abc123',
          messageOnly: true
        }
      ])
    ).toEqual([
      '/repo',
      {
        message: 'Updated commit message',
        amend: true,
        expectedHead: 'abc123',
        messageOnly: true
      }
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
    expect(validateIpcArgs('repo:review-guide-state', ['/repo', 'a'.repeat(64)])).toEqual([
      '/repo',
      'a'.repeat(64)
    ]);
    expect(
      validateIpcArgs('repo:start-review-guide', [
        '/repo',
        { kind: 'wip', scope: 'all' },
        'b'.repeat(64)
      ])
    ).toEqual(['/repo', { kind: 'wip', scope: 'all' }, 'b'.repeat(64)]);
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
          diffSyntaxTheme: 'tokyo-night-storm',
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
      diffSyntaxTheme: 'tokyo-night-storm',
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

  it('validates branch upstream inputs before they reach Git', () => {
    expect(
      validateIpcArgs('repo:set-branch-upstream', [
        '/repo',
        { branch: 'feature/tracking', upstream: 'origin/main' }
      ])
    ).toEqual([
      '/repo',
      { branch: 'feature/tracking', upstream: 'origin/main' }
    ]);

    expect(() =>
      validateIpcArgs('repo:set-branch-upstream', [
        '/repo',
        { branch: 'feature/tracking', upstream: 42 }
      ])
    ).toThrow('upstream must be a string.');
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
    expect(() =>
      validateIpcArgs('settings:update', [
        {
          diffSyntaxTheme: 'neon'
        }
      ])
    ).toThrow('diffSyntaxTheme must be one of: git-gud-dark, tokyo-night-storm.');
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
    expect(() => validateIpcArgs('tabs:reorder', ['repo:/project', -1])).toThrow(
      'targetIndex must be a non-negative integer.'
    );
    expect(() =>
      validateIpcArgs('github:actions-runs', [
        {
          profileId: 'profile:kaldy',
          owner: 'acme',
          repository: 'widgets',
          limit: 50
        }
      ])
    ).toThrow('limit must be 20 or fewer.');
    expect(() =>
      validateIpcArgs('github:actions-runs', [
        {
          profileId: 'profile:kaldy',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters: {
            branches: ['main', ' main '],
            includeTags: false,
            includeMyPullRequests: false
          }
        }
      ])
    ).toThrow('filters.branches must not contain duplicate entries.');
    expect(() =>
      validateIpcArgs('github:actions-runs', [
        {
          profileId: 'profile:kaldy',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters: {
            branches: [],
            includeTags: true
          }
        }
      ])
    ).toThrow('filters.includeMyPullRequests must be a boolean.');
    expect(() => validateIpcArgs('workspace:set-detail-panel-collapsed', ['yes'])).toThrow('collapsed must be a boolean.');
    expect(() => validateIpcArgs('dashboards:select', ['profile:kaldy', ''])).toThrow(
      'dashboardId must not be empty.'
    );
    expect(() =>
      validateIpcArgs('dashboards:alerts-mark-read', [
        'profile:kaldy',
        ['']
      ])
    ).toThrow('alertIds[0] must not be empty.');
    expect(() =>
      validateIpcArgs('portainer:connection-save', [
        {
          name: 'Production',
          baseUrl: 'https://portainer.example.com',
          accessToken: 42,
          tlsVerify: true
        }
      ])
    ).toThrow('accessToken must be a string.');
    expect(() =>
      validateIpcArgs('portainer:stack-runtime', [
        {
          connectionId: 'portainer:production',
          endpointId: 0,
          stackId: 12,
          stackName: 'storefront'
        }
      ])
    ).toThrow('endpointId must be a positive integer.');
    expect(() =>
      validateIpcArgs('dashboards:save', [
        {
          profileId: 'profile:kaldy',
          name: 'Delivery',
          tiles: [
            {
              kind: 'portainer-swarm-stack',
              connectionId: 'portainer:production',
              endpointId: 3,
              stackId: 0,
              stackName: 'storefront',
              environmentName: 'Production Swarm'
            }
          ]
        }
      ])
    ).toThrow('stackId must be a positive integer.');
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
           fileComments: [],
           replies: []
        }
      ])
    ).toThrow('body must not be empty');
    expect(() =>
      validateIpcArgs('github:update-pull-request-review-comment', [{
        profileId: 'profile:kaldy',
        owner: 'acme',
        repository: 'widgets',
        number: 42,
        commentId: 0,
        body: ''
      }])
    ).toThrow('commentId must be a positive integer');
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
    expect(() => validateIpcArgs('repo:review-guide-state', ['/repo', 'stale'])).toThrow(
      'sourceFingerprint must be a SHA-256 identifier.'
    );
    expect(() =>
      validateIpcArgs('repo:start-review-guide', [
        '/repo',
        { kind: 'wip', scope: 'all' },
        'stale'
      ])
    ).toThrow('sourceFingerprint must be a SHA-256 identifier.');
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
    expect(() => validateIpcArgs('repo:push', ['/repo', { forceWithLease: false, branch: 42 }])).toThrow(
      'branch must be a string.'
    );
    expect(() =>
      validateIpcArgs('repo:push', [
        '/repo',
        {
          forceWithLease: true,
          branch: 'main',
          expectedLocalSha: 'a'.repeat(40)
        }
      ])
    ).toThrow('force push target must be an object.');
    expect(() => validateIpcArgs('repo:push-tag', ['/repo', { name: 'v1.0.0' }])).toThrow(
      'remote must be a string.'
    );
    expect(() =>
      validateIpcArgs('repo:create-tag', ['/repo', { name: 'v1.0.0', annotated: 'yes' }])
    ).toThrow('annotated must be a boolean.');
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
    expect(() =>
      validateIpcArgs('settings:update', [{ confirmForcePush: 'never' }])
    ).toThrow('confirmForcePush must be a boolean.');
  });
});
