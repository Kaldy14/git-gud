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

    expect(branchArgs[1]).toMatchObject({
      name: 'feature/ipc-validation',
      checkout: true
    });
    expect(resetArgs[1]).toMatchObject({
      target: 'HEAD~1',
      mode: 'mixed'
    });
    expect(validateIpcArgs('repo:discard-file', ['/repo', 'src/main.ts'])).toEqual(['/repo', 'src/main.ts']);
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
          terminalApp: 'Terminal'
        }
      ])[0]
    ).toMatchObject({
      defaultDiffStyle: 'split',
      graphPageSize: 750,
      largeRepoMode: true
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
  });
});
