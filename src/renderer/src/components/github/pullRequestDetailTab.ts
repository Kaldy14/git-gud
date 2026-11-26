// Pull-request detail tabs: each answers one question. Overview: can this merge and what should
// worry me. Conversation: what have people said. Tour: walk me through it. Code: let me read all of it.
export const PULL_REQUEST_DETAIL_TABS = ['overview', 'conversation', 'tour', 'code'] as const;
export type PullRequestDetailTab = (typeof PULL_REQUEST_DETAIL_TABS)[number];
export const PULL_REQUEST_DETAIL_TAB_KEY = 'git-gud:pr-detail-tab:v1';

// Values remembered before the tabs were renamed.
const LEGACY_TABS = new Map<string, PullRequestDetailTab>([['summary', 'overview'], ['activity', 'conversation'], ['guide', 'tour']]);

export function loadPullRequestDetailTab(storage: Pick<Storage, 'getItem'>): PullRequestDetailTab {
  try {
    const stored = storage.getItem(PULL_REQUEST_DETAIL_TAB_KEY) ?? '';
    return PULL_REQUEST_DETAIL_TABS.find((tab) => tab === stored) ?? LEGACY_TABS.get(stored) ?? 'overview';
  } catch {
    return 'overview';
  }
}

// Tabs and panels reference each other for assistive technology.
export const pullRequestDetailTabId = (tab: PullRequestDetailTab) => `pr-detail-tab-${tab}`;
export const pullRequestDetailPanelId = (tab: PullRequestDetailTab) => `pr-detail-panel-${tab}`;

export function pullRequestDetailPanelProps(tab: PullRequestDetailTab) {
  return { id: pullRequestDetailPanelId(tab), role: 'tabpanel', 'aria-labelledby': pullRequestDetailTabId(tab), tabIndex: 0 } as const;
}

export type DiffTab = 'tour' | 'code';

/** Which face of the shared diff surface a tab shows; Overview, Conversation and a Tour without steps show none. */
export function diffTabFor(tab: PullRequestDetailTab, tourUsable: boolean): DiffTab | undefined {
  if (tab === 'code') return 'code';
  return tab === 'tour' && tourUsable ? 'tour' : undefined;
}

/**
 * Tour and Code are one `ReviewView`; moving between them while a comment composer is open would hide the
 * composer, so that tab change is refused. Leaving for Overview or Conversation keeps the composer mounted.
 */
export function refusesTabChange(
  next: PullRequestDetailTab,
  surface: { diffTab: DiffTab; composerOpen: boolean; tourUsable: boolean }
): boolean {
  const requested = diffTabFor(next, surface.tourUsable);
  return surface.composerOpen && requested !== undefined && requested !== surface.diffTab;
}
