import { useCallback, useEffect, useState } from 'react';

import type { PullRequestTour } from '@shared/pullRequestTour';
import type { GitHubPullRequestLocator } from '@shared/types';

import {
  loadTourWalk,
  saveTourWalk,
  tourWalkReducer,
  tourWalkStorageKey,
  type TourWalkAction
} from './pullRequestTourWalk';

/**
 * The reader's place in a tour (step, reviewed steps, selected point), restored per pull request and tour
 * generation. A rewritten tour gets a fresh walk. `dispatch` is the reducer's; callers guard moves.
 */
export function usePullRequestTourWalk(locator: GitHubPullRequestLocator, tour: PullRequestTour | null) {
  const key = tour ? tourWalkStorageKey(locator, tour) : '';
  const count = tour?.stops.length ?? 0;
  const [state, setState] = useState(() => ({ key, walk: loadTourWalk(window.localStorage, key, count) }));
  // A new tour generation (rewrite, new head) swaps the walk during render, before anything paints.
  const current = state.key === key ? state : { key, walk: loadTourWalk(window.localStorage, key, count) };
  if (current !== state) setState(current);
  const { walk } = current;

  useEffect(() => {
    if (key) saveTourWalk(window.localStorage, key, walk);
  }, [key, walk]);

  const dispatch = useCallback((action: TourWalkAction) => {
    setState((value) => {
      if (value.key !== key) return value;
      const next = tourWalkReducer(value.walk, action);
      return next === value.walk ? value : { key, walk: next };
    });
  }, [key]);
  return { walk, dispatch };
}
