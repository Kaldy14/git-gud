import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, FolderOpen, GitBranch, History, Plus, Settings, X } from 'lucide-react';

import type { RecentRepository, RepoProfileState, RepoTab } from '@shared/types';

type TabStripProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  recentRepos: RecentRepository[];
  profileState?: RepoProfileState;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenRepository: () => void;
  onOpenRecentRepository: (repoPath: string) => void;
};

export function TabStrip({
  tabs,
  activeTabId,
  recentRepos,
  profileState,
  onActivateTab,
  onCloseTab,
  onOpenRepository,
  onOpenRecentRepository
}: TabStripProps): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const profileLabel = profileState?.activeProfile?.name ?? profileState?.effectiveIdentity.name ?? 'Profile';
  const profileEmail = profileState?.activeProfile?.email ?? profileState?.effectiveIdentity.email;
  const profileColor = profileState?.activeProfile?.avatarColor ?? 'var(--accent)';

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isMenuOpen]);

  return (
    <div className="drag-region flex h-10 shrink-0 items-stretch border-b border-[var(--border)] bg-[var(--bg-titlebar)] pl-[78px]">
      <div className="no-drag relative flex min-w-0 flex-1 items-stretch">
        <div className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;

            return (
              <button
                key={tab.id}
                className="repo-tab group"
                data-active={isActive}
                type="button"
                title={tab.path}
                onClick={() => onActivateTab(tab.id)}
              >
                <GitBranch size={13} className={isActive ? 'shrink-0 text-[var(--accent-2)]' : 'shrink-0'} />
                <span className="min-w-0 truncate">{tab.name}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tab.name}`}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--text-3)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] group-hover:opacity-100 group-data-[active=true]:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            );
          })}
        </div>

        <button
          className="grid w-9 shrink-0 place-items-center rounded-none text-[var(--text-3)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"
          type="button"
          aria-label="Open repository"
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          <Plus size={15} />
        </button>

        {isMenuOpen ? (
          <div
            ref={menuRef}
            className="absolute left-1 top-[42px] z-50 w-80 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
          >
            <button
              className="menu-row"
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onOpenRepository();
              }}
            >
              <FolderOpen size={14} className="text-[var(--accent-2)]" />
              <span>Open repository…</span>
            </button>
            {recentRepos.length > 0 ? (
              <>
                <div className="mx-2 my-1.5 h-px bg-[var(--border)]" />
                <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
                  Recent
                </p>
                {recentRepos.slice(0, 8).map((recentRepo) => (
                  <button
                    key={recentRepo.path}
                    className="menu-row"
                    type="button"
                    title={recentRepo.path}
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenRecentRepository(recentRepo.path);
                    }}
                  >
                    <History size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{recentRepo.name}</span>
                  </button>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="no-drag flex shrink-0 items-center gap-0.5 px-2">
        <button className="icon-btn" type="button" aria-label="Notifications" title="Notifications">
          <Bell size={15} />
        </button>
        <button className="icon-btn" type="button" aria-label="Settings" title="Settings — coming in M6">
          <Settings size={15} />
        </button>
        <button
          className="ml-1 flex h-7 items-center gap-2 rounded-full py-0.5 pl-1 pr-2 text-xs text-[var(--text-2)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"
          type="button"
          title={profileEmail ? `${profileLabel} <${profileEmail}>` : 'No Git identity configured'}
        >
          <span
            className="grid h-5.5 w-5.5 place-items-center rounded-full text-[10px] font-bold text-[var(--bg-field)]"
            style={{ background: profileColor }}
          >
            {initials(profileLabel)}
          </span>
          <span className="max-w-28 truncate">{profileLabel}</span>
          <ChevronDown size={12} />
        </button>
      </div>
    </div>
  );
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'P';
}
