import type { ReactElement } from 'react';
import { FilePlus2, GitBranch, Plus, Settings, X } from 'lucide-react';

import { ProfileMenu } from '@renderer/components/profile/ProfileMenu';
import type { GitProfile, RepoProfileState, RepoTab } from '@shared/types';

const START_TAB_ID = 'new-repository-tab';

type TabStripProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  isStartTabOpen: boolean;
  isStartTabActive: boolean;
  profileState?: RepoProfileState;
  activeRepoDirty?: boolean;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenStartTab: () => void;
  onActivateStartTab: () => void;
  onCloseStartTab: () => void;
  onOpenSettings: () => void;
  onActivateProfile: (profileId: string | undefined) => Promise<void>;
  onSaveAndActivateProfile: (profile: GitProfile) => Promise<void>;
};

export function TabStrip({
  tabs,
  activeTabId,
  isStartTabOpen,
  isStartTabActive,
  profileState,
  activeRepoDirty = false,
  onActivateTab,
  onCloseTab,
  onOpenStartTab,
  onActivateStartTab,
  onCloseStartTab,
  onOpenSettings,
  onActivateProfile,
  onSaveAndActivateProfile
}: TabStripProps): ReactElement {
  const navigationTabIds = [...tabs.map((tab) => tab.id), ...(isStartTabOpen ? [START_TAB_ID] : [])];
  const activateNavigationTab = (tabId: string): void => {
    if (tabId === START_TAB_ID) {
      onActivateStartTab();
      return;
    }

    onActivateTab(tabId);
  };

  return (
    <div className="drag-region flex h-10 shrink-0 items-stretch border-b border-[var(--border)] bg-[var(--bg-titlebar)] pl-[84px]">
      <div className="relative flex min-w-0 flex-1 items-stretch">
        <div className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Open repositories">
          {tabs.map((tab, tabIndex) => {
            const isActive = tab.id === activeTabId;

            return (
              <div
                key={tab.id}
                className="no-drag repo-tab group"
                data-active={isActive}
                title={tab.path}
              >
                <button
                  id={tabDomId(tab.id)}
                  className="repo-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onActivateTab(tab.id)}
                  onKeyDown={(event) =>
                    handleTabKeyDown(event, tabIndex, navigationTabIds, activateNavigationTab)
                  }
                >
                  <GitBranch size={13} className={isActive ? 'shrink-0 text-[var(--accent-2)]' : 'shrink-0'} />
                  <span className="min-w-0 truncate">{tab.name}</span>
                  {isActive && activeRepoDirty ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-2)]" title="Working directory has changes" aria-label="Working directory has changes" />
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-3)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] focus:opacity-100 group-hover:opacity-100 group-data-[active=true]:opacity-100"
                  onClick={() => onCloseTab(tab.id)}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {isStartTabOpen ? (
            <div
              className="no-drag repo-tab group"
              data-active={isStartTabActive}
              title="Open or create a repository"
            >
              <button
                id={tabDomId(START_TAB_ID)}
                className="repo-tab-main"
                type="button"
                role="tab"
                aria-selected={isStartTabActive}
                tabIndex={isStartTabActive ? 0 : -1}
                onClick={onActivateStartTab}
                onKeyDown={(event) =>
                  handleTabKeyDown(event, tabs.length, navigationTabIds, activateNavigationTab)
                }
              >
                <FilePlus2
                  size={13}
                  className={isStartTabActive ? 'shrink-0 text-[var(--accent-2)]' : 'shrink-0'}
                />
                <span className="min-w-0 truncate">New Tab</span>
              </button>
              {tabs.length > 0 ? (
                <button
                  type="button"
                  aria-label="Close New Tab"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-3)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] focus:opacity-100 group-hover:opacity-100 group-data-[active=true]:opacity-100"
                  onClick={onCloseStartTab}
                >
                  <X size={11} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          className="no-drag grid w-10 shrink-0 place-items-center rounded-none text-[var(--text-3)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"
          type="button"
          aria-label="New tab"
          title="New tab"
          onClick={onOpenStartTab}
        >
          <Plus size={15} />
        </button>

        <div className="drag-region min-w-0 flex-1" aria-hidden="true" />
      </div>

      <div className="no-drag flex shrink-0 items-center gap-0.5 px-2">
        <button className="icon-btn" type="button" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <Settings size={15} />
        </button>
        <ProfileMenu
          profileState={profileState}
          onActivateProfile={onActivateProfile}
          onSaveAndActivateProfile={onSaveAndActivateProfile}
        />
      </div>
    </div>
  );
}

function handleTabKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  tabIds: string[],
  onActivateTab: (tabId: string) => void
): void {
  let nextIndex: number | undefined;

  if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabIds.length;
  } else if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = tabIds.length - 1;
  }

  const nextTabId = typeof nextIndex === 'number' ? tabIds[nextIndex] : undefined;

  if (!nextTabId) {
    return;
  }

  event.preventDefault();
  onActivateTab(nextTabId);
  window.requestAnimationFrame(() => document.getElementById(tabDomId(nextTabId))?.focus());
}

function tabDomId(tabId: string): string {
  return `repo-tab-${tabId.replace(/[^\dA-Za-z_-]/g, '-')}`;
}
