import { describe, expect, it } from 'vitest';

import { describeOperationError, ipcErrorMessage } from './ipcErrors';

describe('ipcErrorMessage', () => {
  it('removes the IPC channel and error class that Electron adds', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'repo:push': GitCommandError: fatal: No configured push destination."), 'x'))
      .toBe('fatal: No configured push destination.');
    expect(ipcErrorMessage(new Error("Error invoking remote method 'repo:fetch': Error: Timed out"), 'x')).toBe('Timed out');
  });

  it('keeps ordinary messages and falls back for non-errors', () => {
    expect(ipcErrorMessage(new Error('Plain failure'), 'x')).toBe('Plain failure');
    expect(ipcErrorMessage('nope', 'Fallback')).toBe('Fallback');
    expect(ipcErrorMessage(new Error(''), 'Fallback')).toBe('Fallback');
  });
});


describe('operation error presentation', () => {
  it('summarizes clone failures while retaining the exact Git output for inspection', () => {
    const output = "Cloning into '/projects/app'...\nfatal: repository '/missing.git' does not exist\n";
    expect(describeOperationError(output)).toEqual({
      summary: 'Could not clone repository',
      hint: 'Check the repository URL and your access, then try again.',
      detail: output
    });
  });

  it('leads with the failure instead of command progress for other multiline errors', () => {
    const output = 'Updating abc..def\nerror: local changes would be overwritten\nCommit or stash your changes.';
    expect(describeOperationError(output)).toEqual({ summary: 'local changes would be overwritten', detail: output });
  });

  it('keeps a concise error as-is and supplies a fallback for an empty message', () => {
    expect(describeOperationError('Permission denied')).toEqual({ summary: 'Permission denied' });
    expect(describeOperationError('')).toEqual({ summary: 'Git operation failed' });
  });
});
