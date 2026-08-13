import { describe, expect, it } from 'vitest';

import {
  createReviewViewState,
  getReviewScrollTopForNavigation,
  selectReviewViewUnit,
  setReviewViewScrollTop
} from './reviewViewState';

describe('review view state', () => {
  it('restores the selected story and its scroll position after a view remount', () => {
    let state = createReviewViewState();

    state = selectReviewViewUnit(state, 'story:authentication', 'src/auth.ts');
    state = setReviewViewScrollTop(state, 'story:authentication', 864);

    const restored = createReviewViewState(state);

    expect(restored).toEqual({
      selectedUnitId: 'story:authentication',
      requestedFilePath: 'src/auth.ts',
      scrollTopByUnit: {
        'story:authentication': 864
      }
    });
  });

  it('keeps a separate scroll position for each review story', () => {
    let state = createReviewViewState();

    state = setReviewViewScrollTop(state, 'story:first', 320);
    state = setReviewViewScrollTop(state, 'story:second', 1280);

    expect(state.scrollTopByUnit).toEqual({
      'story:first': 320,
      'story:second': 1280
    });
  });

  it('restores group navigation but lets file navigation jump to its target', () => {
    const state = setReviewViewScrollTop(
      createReviewViewState(),
      'story:authentication',
      864
    );

    expect(
      getReviewScrollTopForNavigation(state, 'story:authentication', 'unit')
    ).toBe(864);
    expect(
      getReviewScrollTopForNavigation(state, 'story:authentication', 'file')
    ).toBeUndefined();
  });
});
