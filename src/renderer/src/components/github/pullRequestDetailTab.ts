// Pull-request detail layout modelled on T3 Code: Summary, Guide, Activity, and Code tabs.
// Code keeps Git Gud's own review sections.
export const PULL_REQUEST_DETAIL_TABS = ['summary', 'guide', 'activity', 'code'] as const;
export type PullRequestDetailTab = (typeof PULL_REQUEST_DETAIL_TABS)[number];
export const PULL_REQUEST_DETAIL_TAB_KEY = 'git-gud:pr-detail-tab:v1';

export function loadPullRequestDetailTab(storage: Pick<Storage, 'getItem'>): PullRequestDetailTab {
  try {
    const stored = storage.getItem(PULL_REQUEST_DETAIL_TAB_KEY);
    return PULL_REQUEST_DETAIL_TABS.find((tab) => tab === stored) ?? 'summary';
  } catch {
    return 'summary';
  }
}

// Tabs and panels reference each other for assistive technology.
export const pullRequestDetailTabId = (tab: PullRequestDetailTab) => `pr-detail-tab-${tab}`;
export const pullRequestDetailPanelId = (tab: PullRequestDetailTab) => `pr-detail-panel-${tab}`;

export function pullRequestDetailPanelProps(tab: PullRequestDetailTab) {
  return { id: pullRequestDetailPanelId(tab), role: 'tabpanel', 'aria-labelledby': pullRequestDetailTabId(tab), tabIndex: 0 } as const;
}
