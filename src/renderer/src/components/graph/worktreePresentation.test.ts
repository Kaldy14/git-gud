import { describe, expect, it } from 'vitest';

import { describeWipWorktree } from './worktreePresentation';

describe('WIP worktree presentation', () => {
  it('leaves the primary WIP row unlabelled above its branch', () => {
    expect(
      describeWipWorktree({
        path: '/repos/git-gud',
        branch: 'main',
        current: true
      })
    ).toEqual({
      identity: 'local changes on main'
    });
  });

  it('keeps a linked worktree identified by its branch', () => {
    expect(
      describeWipWorktree({
        path: '/repos/git-gud-feature',
        branch: 'feature/worktree',
        current: false
      })
    ).toEqual({
      identity: 'linked worktree feature/worktree',
      chip: {
        label: 'feature/worktree',
        location: 'Linked worktree'
      }
    });
  });
});
