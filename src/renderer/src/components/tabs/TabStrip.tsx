import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { FilePlus2, LayoutDashboard, Plus, Settings, X } from 'lucide-react';

import { ProfileMenu } from '@renderer/components/profile/ProfileMenu';
import {
  resolveTabDropIndex,
  type TabDropPosition
} from '@renderer/components/tabs/tabReordering';
import type { GitProfile, RepoProfileState, RepoTab } from '@shared/types';

const START_TAB_ID = 'new-repository-tab';
const DASHBOARDS_TAB_ID = 'dashboards-tab';

type TabDropTarget = {
  tabId: string;
  position: TabDropPosition;
};

type TabDragSession = {
  tabId: string;
  pointerId: number;
  startX: number;
  dragging: boolean;
};

type TabStripProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  isStartTabOpen: boolean;
  isStartTabActive: boolean;
  isDashboardsTabActive: boolean;
  dashboardUnreadCount?: number;
  profileState?: RepoProfileState;
  activeRepoDirty?: boolean;
  onActivateTab: (tabId: string) => void;
  onReorderTab: (tabId: string, targetIndex: number) => void;
  onCloseTab: (tabId: string) => void;
  onOpenStartTab: () => void;
  onActivateStartTab: () => void;
  onCloseStartTab: () => void;
  onActivateDashboardsTab: () => void;
  onOpenSettings: () => void;
  onActivateProfile: (profileId: string | undefined) => Promise<void>;
  onSaveAndActivateProfile: (profile: GitProfile) => Promise<void>;
};

export function TabStrip({
  tabs,
  activeTabId,
  isStartTabOpen,
  isStartTabActive,
  isDashboardsTabActive,
  dashboardUnreadCount = 0,
  profileState,
  activeRepoDirty = false,
  onActivateTab,
  onReorderTab,
  onCloseTab,
  onOpenStartTab,
  onActivateStartTab,
  onCloseStartTab,
  onActivateDashboardsTab,
  onOpenSettings,
  onActivateProfile,
  onSaveAndActivateProfile
}: TabStripProps): ReactElement {
  const [draggedTabId, setDraggedTabId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<TabDropTarget>();
  const dragSessionRef = useRef<TabDragSession | undefined>(undefined);
  const dropTargetRef = useRef<TabDropTarget | undefined>(undefined);
  const suppressTabClickRef = useRef<string | undefined>(undefined);
  const navigationTabIds = [
    ...tabs.map((tab) => tab.id),
    ...(isStartTabOpen ? [START_TAB_ID] : []),
    DASHBOARDS_TAB_ID
  ];
  const activateNavigationTab = (tabId: string): void => {
    if (tabId === START_TAB_ID) {
      onActivateStartTab();
      return;
    }

    if (tabId === DASHBOARDS_TAB_ID) {
      onActivateDashboardsTab();
      return;
    }

    onActivateTab(tabId);
  };
  const finishTabDrag = (): void => {
    dragSessionRef.current = undefined;
    dropTargetRef.current = undefined;
    setDraggedTabId(undefined);
    setDropTarget(undefined);
  };
  const handleTabPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    tabId: string
  ): void => {
    if (event.button !== 0 || tabs.length < 2) {
      return;
    }

    dragSessionRef.current = {
      tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      dragging: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
  };
  const handleTabPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const session = dragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (!session.dragging && Math.abs(event.clientX - session.startX) < 5) {
      return;
    }

    if (!session.dragging) {
      session.dragging = true;
      setDraggedTabId(session.tabId);
    }

    event.preventDefault();
    const targetElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-tab-id]');
    const targetTabId = targetElement?.dataset.tabId;

    if (!targetElement || !targetTabId) {
      dropTargetRef.current = undefined;
      setDropTarget(undefined);
      return;
    }

    const position = dropPositionForPointer(event.clientX, targetElement.getBoundingClientRect());
    const nextDropTarget = { tabId: targetTabId, position };
    dropTargetRef.current = nextDropTarget;
    setDropTarget((current) =>
      current?.tabId === targetTabId && current.position === position
        ? current
        : nextDropTarget
    );
  };
  const handleTabPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    const session = dragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const target = dropTargetRef.current;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!session.dragging) {
      finishTabDrag();
      return;
    }

    event.preventDefault();
    const targetIndex = resolveTabDropIndex(
      tabs.map((tab) => tab.id),
      session.tabId,
      target?.tabId ?? '',
      target?.position ?? 'before'
    );

    suppressTabClickRef.current = session.tabId;
    window.setTimeout(() => {
      if (suppressTabClickRef.current === session.tabId) {
        suppressTabClickRef.current = undefined;
      }
    }, 0);
    finishTabDrag();

    if (typeof targetIndex === 'number') {
      onReorderTab(session.tabId, targetIndex);
    }
  };

  return (
    <div className="drag-region flex h-10 shrink-0 items-stretch border-b border-[var(--border)] bg-[var(--bg-titlebar)] pl-[84px]">
      <div
        className="relative flex min-w-0 flex-1 items-stretch"
        role="tablist"
        aria-label="Workspace views"
      >
        <div className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab, tabIndex) => {
            const isActive = tab.id === activeTabId;

            return (
              <div
                key={tab.id}
                className="no-drag repo-tab repo-tab--repository group"
                data-active={isActive}
                data-dragging={draggedTabId === tab.id}
                data-drop-position={
                  dropTarget?.tabId === tab.id && draggedTabId !== tab.id
                    ? dropTarget.position
                    : undefined
                }
                data-tab-id={tab.id}
                data-reorderable={tabs.length > 1}
                title={tab.path}
              >
                <button
                  id={tabDomId(tab.id)}
                  className="repo-tab-main"
                  data-tab-drag-handle={tabs.length > 1}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onPointerDown={(event) => handleTabPointerDown(event, tab.id)}
                  onPointerMove={handleTabPointerMove}
                  onPointerUp={handleTabPointerUp}
                  onPointerCancel={finishTabDrag}
                  onClick={() => {
                    if (suppressTabClickRef.current === tab.id) {
                      suppressTabClickRef.current = undefined;
                      return;
                    }

                    onActivateTab(tab.id);
                  }}
                  onKeyDown={(event) =>
                    handleTabKeyDown(event, tabIndex, navigationTabIds, activateNavigationTab)
                  }
                >
                  <span className="min-w-0 truncate">{tab.name}</span>
                  {isActive && activeRepoDirty ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-2)]" title="Working directory has changes" aria-label="Working directory has changes" />
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  className="repo-tab-close"
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

        <div
          className="no-drag repo-tab repo-tab--icon"
          data-active={isDashboardsTabActive}
          title={
            dashboardUnreadCount > 0
              ? `Dashboards · ${dashboardUnreadCount} unread workflow ${
                  dashboardUnreadCount === 1 ? 'failure' : 'failures'
                }`
              : 'Dashboards'
          }
        >
          <button
            id={tabDomId(DASHBOARDS_TAB_ID)}
            className="repo-tab-main"
            type="button"
            role="tab"
            aria-label={
              dashboardUnreadCount > 0
                ? `Dashboards, ${dashboardUnreadCount} unread workflow ${
                    dashboardUnreadCount === 1 ? 'failure' : 'failures'
                  }`
                : 'Dashboards'
            }
            aria-selected={isDashboardsTabActive}
            tabIndex={isDashboardsTabActive ? 0 : -1}
            onClick={onActivateDashboardsTab}
            onKeyDown={(event) =>
              handleTabKeyDown(
                event,
                navigationTabIds.length - 1,
                navigationTabIds,
                activateNavigationTab
              )
            }
          >
            <LayoutDashboard
              size={15}
              className={isDashboardsTabActive ? 'text-[var(--accent-2)]' : undefined}
            />
            {dashboardUnreadCount > 0 ? (
              <span className="dashboard-unread-dot" aria-hidden="true" />
            ) : null}
          </button>
        </div>
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

function dropPositionForPointer(clientX: number, bounds: DOMRect): TabDropPosition {
  return clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
}
