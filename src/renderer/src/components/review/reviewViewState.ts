export type ReviewViewState = {
  selectedUnitId?: string;
  requestedFilePath?: string;
  scrollTopByUnit: Readonly<Record<string, number>>;
};

export type ReviewNavigationReason = 'unit' | 'file';

export function createReviewViewState(initial?: ReviewViewState): ReviewViewState {
  return {
    selectedUnitId: initial?.selectedUnitId,
    requestedFilePath: initial?.requestedFilePath,
    scrollTopByUnit: { ...initial?.scrollTopByUnit }
  };
}

export function selectReviewViewUnit(
  state: ReviewViewState,
  selectedUnitId: string,
  requestedFilePath: string | undefined
): ReviewViewState {
  return {
    ...state,
    selectedUnitId,
    requestedFilePath
  };
}

export function setReviewViewScrollTop(
  state: ReviewViewState,
  unitId: string,
  scrollTop: number
): ReviewViewState {
  return {
    ...state,
    scrollTopByUnit: {
      ...state.scrollTopByUnit,
      [unitId]: scrollTop
    }
  };
}

export function getReviewScrollTopForNavigation(
  state: ReviewViewState,
  unitId: string,
  reason: ReviewNavigationReason
): number | undefined {
  return reason === 'unit' ? state.scrollTopByUnit[unitId] : undefined;
}
