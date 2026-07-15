import type { ReactElement } from 'react';
import { FolderOpen, GitBranch, History, Plus, Settings, X } from 'lucide-react';

import { ProfileMenu } from '@renderer/components/profile/ProfileMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu';
import type { GitProfile, RecentRepository, RepoProfileState, RepoTab } from '@shared/types';

type TabStripProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  recentRepos: RecentRepository[];
  profileState?: RepoProfileState;
  activeRepoDirty?: boolean;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenRepository: () => void;
  onOpenRecentRepository: (repoPath: string) => void;
  onOpenSettings: () => void;
  onActivateProfile: (profileId: string | undefined) => Promise<void>;
  onSaveAndActivateProfile: (profile: GitProfile) => Promise<void>;
};

export function TabStrip({
  tabs,
  activeTabId,
  recentRepos,
  profileState,
  activeRepoDirty = false,
  onActivateTab,
  onCloseTab,
  onOpenRepository,
  onOpenRecentRepository,
  onOpenSettings,
  onActivateProfile,
  onSaveAndActivateProfile
}: TabStripProps): ReactElement {
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
                  onKeyDown={(event) => handleTabKeyDown(event, tabIndex, tabs, onActivateTab)}
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
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="no-drag grid w-10 shrink-0 place-items-center rounded-none text-[var(--text-3)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"
              type="button"
              aria-label="Open repository"
            >
              <Plus size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={2} className="w-80">
            <DropdownMenuItem onSelect={onOpenRepository}>
              <FolderOpen size={14} className="text-[var(--accent-2)]" />
              <span>Open repository…</span>
            </DropdownMenuItem>
            {recentRepos.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Recent</DropdownMenuLabel>
                {recentRepos.slice(0, 8).map((recentRepo) => (
                  <DropdownMenuItem
                    key={recentRepo.path}
                    title={recentRepo.path}
                    onSelect={() => onOpenRecentRepository(recentRepo.path)}
                  >
                    <History size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{recentRepo.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

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
  tabs: RepoTab[],
  onActivateTab: (tabId: string) => void
): void {
  let nextIndex: number | undefined;

  if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = tabs.length - 1;
  }

  const nextTab = typeof nextIndex === 'number' ? tabs[nextIndex] : undefined;

  if (!nextTab) {
    return;
  }

  event.preventDefault();
  onActivateTab(nextTab.id);
  window.requestAnimationFrame(() => document.getElementById(tabDomId(nextTab.id))?.focus());
}

function tabDomId(tabId: string): string {
  return `repo-tab-${tabId.replace(/[^\dA-Za-z_-]/g, '-')}`;
}
