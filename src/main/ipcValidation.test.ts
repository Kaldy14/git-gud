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
