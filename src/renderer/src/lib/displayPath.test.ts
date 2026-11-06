import { describe, expect, it } from 'vitest';

import { abbreviateHomePath } from './displayPath';

describe('abbreviateHomePath', () => {
  it('shows macOS and Linux home folders as ~ and leaves other paths alone', () => {
    expect(abbreviateHomePath('/Users/ada/Code/git-gud')).toBe('~/Code/git-gud');
    expect(abbreviateHomePath('/home/ada')).toBe('~');
    expect(abbreviateHomePath('/Volumes/Dev/git-gud')).toBe('/Volumes/Dev/git-gud');
    expect(abbreviateHomePath('/home2/ada/repo')).toBe('/home2/ada/repo');
  });
});
