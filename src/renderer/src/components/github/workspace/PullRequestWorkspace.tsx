import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import { announce } from '@renderer/lib/announce';
import { gitHubPullRequestDetailQueryOptions } from '@renderer/queries/github';
import type { DiffSyntaxTheme, GitHubPullRequestInbox, GitHubPullRequestSummary } from '@shared/types';
import { loadPullRequestDetailTab, PULL_REQUEST_DETAIL_TAB_KEY, PULL_REQUEST_DETAIL_TABS, type PullRequestDetailTab } from '../pullRequestDetailTab';
import { PullRequestReviewView } from '../PullRequestReviewView';
import { PullRequestListRail } from '../rail/PullRequestListRail';
import {
  adjacentRailRow,
  buildRailSections,
  isRailSectionExpanded,
  loadRailExpansion,
  pullRequestKey,
  saveRailExpansion,
  visibleRailOrder,
  type RailExpansion,
  type RailSectionId
} from '../rail/pullRequestRailModel';
import { isRailFloating, isRailOpen, loadRailPreferences, railTabKind, saveRailPreferences, type RailPreferences } from '../rail/pullRequestRailVisibility';
import { PullRequestShortcutBar, PullRequestShortcutsDialog } from '../shortcuts/PullRequestShortcutBar';
import { shortcutUsed } from '../shortcuts/pullRequestShortcuts';
import { pullRequestLocator } from '../tour/pullRequestTourQuery';
import { PullRequestLeaveGuardProvider, useRequestLeave } from './pullRequestLeaveGuard';
import { PullRequestWorkspaceChromeContext, type PullRequestWorkspaceChrome } from './pullRequestWorkspaceChrome';
import { useWorkspaceCommands, type WorkspaceCommand } from './pullRequestWorkspaceKeys';

export type PullRequestWorkspaceProps = {
  // The profile's whole inbox, for the rail.
  inbox: UseQueryResult<GitHubPullRequestInbox>;
  pullRequest: GitHubPullRequestSummary;
  openTour?: boolean;
  openBugFinder?: boolean;
  codexRepoPath?: string;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onSelectPullRequest: (pullRequest: GitHubPullRequestSummary) => void;
  onBackToInbox: () => void;
  onOpenCommit?: (sha: string) => void;
  onClose: () => void;
  onMerged: () => void;
};

// The rail re-renders on every J/K step; the open pull request must not re-render with it.
const MemoizedReviewView = memo(PullRequestReviewView);

// Holding J should not fire a request per row: a keyboard step selects at once and opens after this.
const KEYBOARD_SWITCH_DELAY_MS = 150;

/**
 * The pull request workspace: the queue rail, the open pull request and the shortcut bar. Rendered once
 * per profile so it stays mounted while pull requests change; only the review view is keyed by pull request.
 */
export function PullRequestWorkspace(props: PullRequestWorkspaceProps): ReactElement {
  return (
    <PullRequestLeaveGuardProvider>
      <PullRequestWorkspaceBody {...props} />
    </PullRequestLeaveGuardProvider>
  );
}

function PullRequestWorkspaceBody({
  inbox,
  pullRequest,
  openTour,
  openBugFinder,
  onSelectPullRequest,
  onBackToInbox,
  onClose,
  ...reviewProps
}: PullRequestWorkspaceProps): ReactElement {
  // Every way out of the open pull request asks first when an editor holds unsaved text.
  const requestLeave = useRequestLeave();
  const queryClient = useQueryClient();
  const railId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const openKey = pullRequestKey(pullRequest);

  // The tab is the workspace's, so it stays put while pull requests change.
  const [tab, setTab] = useState<PullRequestDetailTab>(() => openTour ? 'tour' : openBugFinder ? 'code' : loadPullRequestDetailTab(window.localStorage));
  // The latest tab, read between renders so two quick H presses move two tabs.
  const tabRef = useRef(tab);
  useLayoutEffect(() => { tabRef.current = tab; }, [tab]);
  // The open pull request can refuse a tab change (a comment composer would be hidden), so every change
  // (click, H/L, a link inside a pane) asks it first and the tab never moves on a refusal.
  const tabGuardRef = useRef<(next: PullRequestDetailTab) => boolean>(undefined);
  const registerTabGuard = useCallback((guard: ((next: PullRequestDetailTab) => boolean) | undefined) => {
    tabGuardRef.current = guard;
  }, []);
  const selectTab = useCallback((next: PullRequestDetailTab): boolean => {
    if (next === tabRef.current || tabGuardRef.current?.(next) === false) return false;
    tabRef.current = next;
    setTab(next);
    rememberTab(next);
    return true;
  }, []);
  // A deep link or inbox action can ask for the Tour or the bug scan's Code view.
  const openRequest = `${openKey}:${openTour ? 'tour' : openBugFinder ? 'code' : ''}`;
  const [previousOpenRequest, setPreviousOpenRequest] = useState(openRequest);
  if (previousOpenRequest !== openRequest) {
    setPreviousOpenRequest(openRequest);
    if (openTour) setTab('tour');
    else if (openBugFinder) setTab('code');
  }

  // Rail visibility: per tab kind when docked, session-only when it floats over a narrow window.
  const width = useWindowWidth();
  const floating = isRailFloating(width);
  const [railPreferences, setRailPreferences] = useState<RailPreferences>(() => loadRailPreferences(window.localStorage));
  const [floatingOpen, setFloatingOpen] = useState(false);
  // Widening past the floating width drops the session choice, as the repository sidebar does.
  if (!floating && floatingOpen) setFloatingOpen(false);
  const railKind = railTabKind(tab);
  const railOpen = isRailOpen({ width, kind: railKind, saved: railPreferences, floatingOpen });
  const setRailOpen = useCallback((open: boolean) => {
    if (floating) {
      setFloatingOpen(open);
      return;
    }
    setRailPreferences((current) => {
      const next = { ...current, [railKind]: open };
      saveRailPreferences(window.localStorage, next);
      return next;
    });
  }, [floating, railKind]);

  // A pull request opened from outside the inbox stays under "Viewing" while the workspace is open.
  // Checked once per opened pull request, when the inbox is known.
  const [viewing, setViewing] = useState<GitHubPullRequestSummary[]>([]);
  const [viewingCheckedKey, setViewingCheckedKey] = useState<string>();
  if (inbox.data && viewingCheckedKey !== openKey) {
    setViewingCheckedKey(openKey);
    const listed = [...inbox.data.pullRequests, ...viewing].some((candidate) => pullRequestKey(candidate) === openKey);
    if (!listed) setViewing([...viewing, pullRequest]);
  }

  const [search, setSearch] = useState('');
  const [expansion, setExpansion] = useState<RailExpansion>(() => loadRailExpansion(window.localStorage));
  const inboxRows = inbox.data?.pullRequests;
  const sections = useMemo(() => buildRailSections(inboxRows ?? [], viewing, search), [inboxRows, viewing, search]);
  const order = useMemo(() => visibleRailOrder(sections, expansion), [sections, expansion]);

  function toggleSection(id: RailSectionId): void {
    setExpansion((current) => {
      const section = sections.find((candidate) => candidate.id === id);
      const next = { ...current, [id]: !(section ? isRailSectionExpanded(section, current) : true) };
      saveRailExpansion(window.localStorage, next);
      return next;
    });
  }

  // Selection moves at once; the pull request it names opens now (click) or after a pause (J/K).
  const [selectedKey, setSelectedKey] = useState(openKey);
  const [selectedOpenKey, setSelectedOpenKey] = useState(openKey);
  if (selectedOpenKey !== openKey) {
    setSelectedOpenKey(openKey);
    setSelectedKey(openKey);
  }
  // Read by key handlers between renders while J is held.
  const selectedKeyRef = useRef(openKey);
  useEffect(() => { selectedKeyRef.current = selectedKey; }, [selectedKey]);
  const lastIndexRef = useRef(0);
  const switchTimerRef = useRef<number>(undefined);
  // Where the selection sits in the visible order, so J/K continue from there if it leaves the list.
  useEffect(() => {
    const index = order.findIndex((candidate) => pullRequestKey(candidate) === selectedKey);
    if (index >= 0) lastIndexRef.current = index;
  }, [order, selectedKey]);
  // A pending J/K switch is dropped once the open pull request changes by any route (a deep link, a rail
  // click, back): it must not override that pull request when its pause ends.
  useEffect(() => () => window.clearTimeout(switchTimerRef.current), [openKey]);

  function select(next: GitHubPullRequestSummary): void {
    selectedKeyRef.current = pullRequestKey(next);
    setSelectedKey(selectedKeyRef.current);
  }

  function open(next: GitHubPullRequestSummary): void {
    window.clearTimeout(switchTimerRef.current);
    if (pullRequestKey(next) === openKey) return;
    onSelectPullRequest(next);
    const index = order.findIndex((candidate) => pullRequestKey(candidate) === pullRequestKey(next));
    announce(`Opened #${next.number} ${next.title}${index >= 0 ? `, ${index + 1} of ${order.length}` : ''}`);
  }

  function openFromRail(next: GitHubPullRequestSummary): void {
    // A click overrides a J/K switch still waiting for its pause, even while the leave question is open.
    window.clearTimeout(switchTimerRef.current);
    const leave = () => {
      select(next);
      open(next);
      if (floating) setFloatingOpen(false);
    };
    // The open pull request's own row leaves nothing, so there is nothing to ask about.
    if (pullRequestKey(next) === openKey) leave();
    else requestLeave(leave);
  }

  // J/K move the selection freely; only the switch the pause commits asks about unsaved text, so a held J
  // asks once and J then K back to the open pull request never asks. "Keep editing" puts the selection back.
  function step(direction: 1 | -1): void {
    const target = adjacentRailRow(order, selectedKeyRef.current, lastIndexRef.current, direction);
    if (!target) return;
    shortcutUsed(direction === 1 ? 'J' : 'K');
    select(target.pullRequest);
    lastIndexRef.current = target.index;
    window.clearTimeout(switchTimerRef.current);
    if (pullRequestKey(target.pullRequest) === openKey) return;
    switchTimerRef.current = window.setTimeout(
      () => requestLeave(() => open(target.pullRequest), () => select(pullRequest)),
      KEYBOARD_SWITCH_DELAY_MS
    );
  }

  // Prefetch the neighbours when the app is idle, into the same cache the review view reads. Cached
  // neighbours are left alone: a large detail landing on the main thread would stall the next J.
  useEffect(() => {
    const index = order.findIndex((candidate) => pullRequestKey(candidate) === openKey);
    if (index < 0) return;
    const neighbours = [order[index - 1], order[index + 1]].filter((candidate) => candidate !== undefined);
    const handle = requestIdle(() => {
      for (const neighbour of neighbours) void queryClient.ensureQueryData(gitHubPullRequestDetailQueryOptions(pullRequestLocator(neighbour))).catch(() => undefined);
    });
    return () => cancelIdle(handle);
  }, [order, openKey, queryClient]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Whether the open pull request has a usable tour; until it reports, the last one's answer stands.
  const [tourUsable, setTourUsable] = useState(false);
  const backToInbox = useCallback(() => requestLeave(onBackToInbox), [requestLeave, onBackToInbox]);
  const close = useCallback(() => requestLeave(onClose), [requestLeave, onClose]);

  useWorkspaceCommands((command: WorkspaceCommand) => {
    switch (command) {
      case 'next': step(1); return;
      case 'previous': step(-1); return;
      case 'next-tab':
      case 'previous-tab': {
        const next = PULL_REQUEST_DETAIL_TABS[PULL_REQUEST_DETAIL_TABS.indexOf(tabRef.current) + (command === 'next-tab' ? 1 : -1)];
        if (next && selectTab(next)) shortcutUsed(command === 'next-tab' ? 'L' : 'H');
        return;
      }
      case 'search':
        shortcutUsed('/');
        setRailOpen(true);
        // The rail may mount in this render; focus once it is there.
        window.setTimeout(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        }, 0);
        return;
      case 'toggle-rail':
        shortcutUsed('Mod+B');
        setRailOpen(!railOpen);
        return;
      case 'help': setShortcutsOpen(true);
    }
  });

  // A floating rail closes on a press outside it, like the repository sidebar's flyout.
  const railContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!floating || !railOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && railContainerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-rail-toggle]')) return;
      setFloatingOpen(false);
    };
    // Escape closes it from wherever focus is (the toggle, the review). Whatever handles Escape itself (the
    // search field clearing its text, a composer) has already called preventDefault; a dialog or menu keeps
    // focus inside itself and closes first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      setFloatingOpen(false);
      document.querySelector<HTMLElement>('[data-rail-toggle]')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [floating, railOpen]);

  const chrome = useMemo<PullRequestWorkspaceChrome>(() => ({
    railOpen,
    railId,
    toggleRail: () => setRailOpen(!railOpen),
    openShortcuts: () => setShortcutsOpen(true)
  }), [railOpen, railId, setRailOpen]);

  return (
    <PullRequestWorkspaceChromeContext.Provider value={chrome}>
      <div className="pr-workspace-shell" data-pull-request-workspace>
        <div className="pr-workspace-body">
          {railOpen ? (
            <div className="pr-rail-slot" ref={railContainerRef} data-floating={floating || undefined}>
              <PullRequestListRail
                id={railId}
                sections={sections}
                expansion={expansion}
                selectedKey={selectedKey}
                totalCount={inboxRows?.length ?? 0}
                omittedCount={inbox.data?.omittedCount}
                isLoading={inbox.isLoading}
                isRefreshing={inbox.isFetching && !inbox.isLoading}
                errorMessage={inbox.error instanceof Error ? inbox.error.message : undefined}
                lastRefreshedAt={inbox.data?.loadedAt}
                search={search}
                searchRef={searchRef}
                floating={floating}
                onSearchChange={setSearch}
                onToggleSection={toggleSection}
                onSelect={openFromRail}
                onRefresh={() => void inbox.refetch()}
                onClose={() => {
                  setFloatingOpen(false);
                  document.querySelector<HTMLElement>('[data-rail-toggle]')?.focus();
                }}
              />
            </div>
          ) : null}
          <MemoizedReviewView
            {...reviewProps}
            key={`${pullRequest.profileId}:${pullRequest.id}`}
            pullRequest={pullRequest}
            tab={tab}
            onTabChange={selectTab}
            registerTabGuard={registerTabGuard}
            onTourUsableChange={setTourUsable}
            initialBugFinderOpen={openBugFinder}
            onBackToInbox={backToInbox}
            onClose={close}
          />
        </div>
        <PullRequestShortcutBar tab={tab} tourUsable={tourUsable} onViewAll={() => setShortcutsOpen(true)} />
      </div>
      {shortcutsOpen ? <PullRequestShortcutsDialog tab={tab} tourUsable={tourUsable} onClose={() => setShortcutsOpen(false)} /> : null}
    </PullRequestWorkspaceChromeContext.Provider>
  );
}

function rememberTab(tab: PullRequestDetailTab): void {
  try { window.localStorage.setItem(PULL_REQUEST_DETAIL_TAB_KEY, tab); } catch { /* remembered tab is a convenience */ }
}

function subscribeResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function useWindowWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth);
}

function requestIdle(callback: () => void): number {
  return typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(callback, { timeout: 2_000 })
    : window.setTimeout(callback, 300);
}

function cancelIdle(handle: number): void {
  if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
}
