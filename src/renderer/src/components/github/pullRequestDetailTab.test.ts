import { describe, expect, it } from 'vitest';

import { loadPullRequestDetailTab, refusesTabChange } from './pullRequestDetailTab';

const storage = (value: string | null) => ({ getItem: () => value });

describe('loadPullRequestDetailTab', () => {
  it('migrates the tab remembered before the rename', () => {
    expect(loadPullRequestDetailTab(storage('summary'))).toBe('overview');
    expect(loadPullRequestDetailTab(storage('activity'))).toBe('conversation');
    expect(loadPullRequestDetailTab(storage('guide'))).toBe('tour');
    expect(loadPullRequestDetailTab(storage('code'))).toBe('code');
    expect(loadPullRequestDetailTab(storage('blocks'))).toBe('blocks');
  });

  it('opens Overview for nothing or an unknown value', () => {
    expect(loadPullRequestDetailTab(storage(null))).toBe('overview');
    expect(loadPullRequestDetailTab(storage('constructor'))).toBe('overview');
    expect(loadPullRequestDetailTab({ getItem: () => { throw new Error('blocked'); } })).toBe('overview');
  });
});

describe('refusesTabChange', () => {
  const surface = { diffTab: 'code' as const, composerOpen: true, tourUsable: true };

  it('keeps Tour, Blocks and Code from swapping while a composer is open', () => {
    expect(refusesTabChange('tour', surface)).toBe(true);
    expect(refusesTabChange('blocks', surface)).toBe(true);
    expect(refusesTabChange('code', { ...surface, diffTab: 'tour' })).toBe(true);
    expect(refusesTabChange('code', { ...surface, diffTab: 'blocks' })).toBe(true);
  });

  it('lets the reader leave for a reading tab or stay on the same diff tab', () => {
    expect(refusesTabChange('overview', surface)).toBe(false);
    expect(refusesTabChange('conversation', surface)).toBe(false);
    expect(refusesTabChange('code', surface)).toBe(false);
  });

  it('allows the switch with no composer, or to a Tour that has no steps to show', () => {
    expect(refusesTabChange('tour', { ...surface, composerOpen: false })).toBe(false);
    expect(refusesTabChange('tour', { ...surface, tourUsable: false })).toBe(false);
  });
});
