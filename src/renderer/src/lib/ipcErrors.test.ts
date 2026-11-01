import { describe, expect, it } from 'vitest';

import { ipcErrorMessage } from './ipcErrors';

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
