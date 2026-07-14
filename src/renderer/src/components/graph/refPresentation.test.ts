import { describe, expect, it } from 'vitest';

import { branchNameFromRemoteRef } from './refPresentation';

describe('branchNameFromRemoteRef', () => {
  it('hides the remote prefix while preserving the full branch path', () => {
    expect(branchNameFromRemoteRef('origin/feature/ITE-526-wall')).toBe('feature/ITE-526-wall');
    expect(branchNameFromRemoteRef('upstream/bugfix/ITE-508-scroll')).toBe('bugfix/ITE-508-scroll');
  });

  it('leaves an unqualified branch name unchanged', () => {
    expect(branchNameFromRemoteRef('main')).toBe('main');
  });
});
