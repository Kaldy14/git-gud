import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';

import type { CodeReference } from '@shared/codeReference';
import { unanchorTourPoints } from '@shared/pullRequestTour';
import type { GitHubPullRequestDetail } from '@shared/types';
import type { ReviewInlineGuideNote, ReviewScopeFileSummary } from '@renderer/components/review/ReviewView';
import { announce } from '@renderer/lib/announce';

import type { PullRequestNotice } from '../overview/PullRequestOverviewTab';
import type { PullRequestCodeLocation } from '../pullRequestNavigation';
import {
  isWithinPullRequestWorkspace,
  pullRequestShortcutKey,
  shortcutUsed,
  singleKeyShortcutsEnabled
} from '../shortcuts/pullRequestShortcuts';
import { COMPOSER_OPEN_NOTICE, isAnchoredPoint, tourInlineNotes, tourPointRange, tourStepScope, unreviewedTourSteps } from './pullRequestTourWalk';
import { WriteTourButton } from './PullRequestTourTab';
import type { PullRequestTourQueryState } from './pullRequestTourQuery';
import { ActivePointStyle, TourBanner, TourStepPanel, type TourFinishCheck } from './TourStepPanel';
import { TourProgress } from './TourProgress';
import { TourStepMap } from './TourStepMap';
import { plainTourText } from './tourText';
import { tourFileStats, tourSegmentWeight, tourStepLines, type TourFileStat } from './tourVisuals';
import { pullRequestLocator } from './pullRequestTourQuery';
import { usePullRequestTourWalk } from './usePullRequestTourWalk';

const EMPTY_STATS: ReadonlyMap<string, TourFileStat> = new Map();

export const TOUR_PANEL_COLLAPSED_KEY = 'git-gud:pr-tour-panel-collapsed:v1';
// A jump the Tour started scrolls the diff; scroll sync waits this long so it never fights it.
const JUMP_QUIET_MS = 700;
// Keys that move within these widgets belong to them, not to the Tour.
const ARROW_OWNERS = '[role="tablist"], [role="tree"], [role="separator"], [role="slider"], [role="radiogroup"]';

/**
 * The Tour on the shared diff surface. Given which diff tab shows (`tour` or `code`), it returns what the
 * one `ReviewView` needs: the file scope, the narrative panel and progress strip on Tour, and the inline
 * point marks for either tab. It also owns the Tour keys (← → R), point ↔ code sync and Finish review.
 */
export function useTourDiffSurface({
  detail,
  tourState,
  diffTab,
  visible,
  active,
  composerOpen,
  paneRef,
  onShowTour,
  onNavigate,
  onOpenCode,
  onFinishReview,
  onNotice
}: {
  detail: GitHubPullRequestDetail;
  tourState: PullRequestTourQueryState;
  diffTab: 'tour' | 'code';
  // The diff pane is on screen (Tour or Code is the selected tab).
  visible: boolean;
  active: boolean;
  composerOpen: boolean;
  paneRef: RefObject<HTMLElement | null>;
  onShowTour: () => void;
  onNavigate: (location: PullRequestCodeLocation) => void;
  onOpenCode: (location: PullRequestCodeLocation) => void;
  onFinishReview: () => void;
  onNotice: (notice: PullRequestNotice) => void;
}) {
  const storedTour = tourState.tour?.stops.length ? tourState.tour : null;
  const { isCurrent } = tourState;
  // A tour written before the latest push keeps its text but loses its line anchors.
  const tour = useMemo(() => storedTour && !isCurrent ? unanchorTourPoints(storedTour) : storedTour, [storedTour, isCurrent]);
  const { walk, dispatch } = usePullRequestTourWalk(pullRequestLocator(detail), storedTour);
  const count = tour?.stops.length ?? 0;
  const step = Math.min(walk.step, Math.max(0, count - 1));
  const stop = tour?.stops[step];
  const isTour = diffTab === 'tour' && tour !== null;

  const [files, setFiles] = useState<readonly ReviewScopeFileSummary[]>([]);
  const [collapsed, setCollapsed] = useState(() => readFlag(TOUR_PANEL_COLLAPSED_KEY));
  const [finishCheck, setFinishCheck] = useState<TourFinishCheck>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingRef = useRef(false);
  const quietUntilRef = useRef(0);
  // Set when the diff picks the point (scrolling, or a click on its mark): only then does the panel scroll its
  // list to it. A step that lands on its first point is read from the top.
  const revealPointRef = useRef(false);
  const takePointReveal = useCallback(() => {
    const reveal = revealPointRef.current;
    revealPointRef.current = false;
    return reveal;
  }, []);

  const refuse = (): boolean => {
    if (composerOpen) onNotice({ tone: 'danger', message: COMPOSER_OPEN_NOTICE });
    return composerOpen;
  };

  function jumpToPoint(stepIndex: number, pointIndex: number): void {
    const point = tour?.stops[stepIndex]?.points[pointIndex];
    if (!point || !isAnchoredPoint(point)) return;
    quietUntilRef.current = performance.now() + JUMP_QUIET_MS;
    onNavigate(tourPointRange(point));
  }

  // Both report whether they acted, so a key that was refused does not light its cap.
  function go(target: number, point?: number): boolean {
    if (!tour || target < 0 || target >= count || refuse()) return false;
    setFinishCheck(undefined);
    // The diff re-scopes and jumps for the new step; that scrolling is not the reader choosing a point.
    revealPointRef.current = false;
    quietUntilRef.current = performance.now() + JUMP_QUIET_MS;
    if (target !== step) focusHeadingRef.current = true;
    dispatch({ type: 'go', step: target, point: point ?? (target === step ? undefined : null) });
    if (point !== undefined) {
      landedRef.current.steps.add(target);
      jumpToPoint(target, point);
    }
    return true;
  }

  function selectPoint(point: number): void {
    dispatch({ type: 'point', point });
    jumpToPoint(step, point);
  }

  function advance(): boolean {
    if (!tour || refuse()) return false;
    if (step < count - 1) {
      setFinishCheck(undefined);
      focusHeadingRef.current = true;
      revealPointRef.current = false;
      quietUntilRef.current = performance.now() + JUMP_QUIET_MS;
      dispatch({ type: 'review-and-next', step, count });
      return true;
    }
    dispatch({ type: 'review-and-next', step, count });
    const unreviewed = unreviewedTourSteps({ reviewed: [...walk.reviewed, step] }, count);
    if (unreviewed.length) {
      setFinishCheck({ unreviewed });
      announce(`${unreviewed.length} ${unreviewed.length === 1 ? 'step is' : 'steps are'} not reviewed yet`);
    } else {
      onFinishReview();
    }
    return true;
  }

  // Opens a step from outside the Tour: an Overview row or a point mark in Code.
  const openStep = (target: number, point?: number): void => {
    if (!tour || refuse()) return;
    onShowTour();
    go(target, point);
  };

  // Moving steps puts focus on the new step's heading and says where the reader is.
  useEffect(() => {
    if (!focusHeadingRef.current || !stop) return;
    focusHeadingRef.current = false;
    headingRef.current?.focus({ preventScroll: true });
    announce(`Step ${step + 1} of ${count}: ${plainTourText(stop.title)}`);
  }, [step, stop, count]);

  // The first time a step shows (this visit), the diff lands on its selected point, or its first anchored one,
  // instead of the top of a file that other steps share. Coming back to a step keeps where the reader left it.
  const landedRef = useRef({ tour: '', steps: new Set<number>() });
  const landOnStep = useEffectEvent(() => {
    if (!isTour || !visible || !stop || !tour) return;
    if (landedRef.current.tour !== tour.generatedAt) landedRef.current = { tour: tour.generatedAt, steps: new Set() };
    if (landedRef.current.steps.has(step)) return;
    landedRef.current.steps.add(step);
    const point = walk.point ?? stop.points.findIndex(isAnchoredPoint);
    if (point < 0) return;
    if (walk.point === null) dispatch({ type: 'point', point });
    jumpToPoint(step, point);
  });
  useEffect(() => { landOnStep(); }, [isTour, visible, step]);

  // ← → R while the Tour is the active tab.
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const key = pullRequestShortcutKey(event);
    if (!key || !isWithinPullRequestWorkspace(event.target)) return;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (event.target instanceof Element && event.target.closest(ARROW_OWNERS)) return;
      event.preventDefault();
      if (go(step + (key === 'ArrowRight' ? 1 : -1))) shortcutUsed(key === 'ArrowRight' ? '→' : '←');
    } else if (key === 'r' && singleKeyShortcutsEnabled()) {
      event.preventDefault();
      if (advance()) shortcutUsed('R');
    }
  });
  useEffect(() => {
    if (!isTour || !visible || !active) return;
    const listener = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [isTour, visible, active]);

  // Scrolling the diff selects the point being read: the last mark above the reading line (a mark sits
  // under its lines), else the first mark. Marks mount with their hunks, so they are looked up on
  // each frame-throttled scroll rather than observed.
  const syncPoint = useEffectEvent((scroller: HTMLElement) => {
    const now = performance.now();
    if (now < quietUntilRef.current) {
      // A jump can take several frames (its hunk mounts first); stay quiet until its scrolling settles.
      quietUntilRef.current = Math.max(quietUntilRef.current, now + 200);
      return;
    }
    const { top, bottom } = scroller.getBoundingClientRect();
    // Jumps centre a point's first line and its mark sits under the last, so read a little below the middle.
    const readingLine = top + (bottom - top) * 0.7;
    let chosen: HTMLElement | undefined;
    // Sorted by position: annotation slots are not in line order within a file.
    const marks = [...scroller.querySelectorAll<HTMLElement>('[data-guide-marker]')]
      .map((mark) => ({ mark, rect: mark.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top);
    for (const { mark, rect } of marks) {
      if (rect.top <= readingLine) chosen = mark;
      else {
        // Above every mark the reader is heading for the first one.
        chosen ??= mark;
        break;
      }
    }
    const point = Number(chosen?.dataset.guideMarker) - 1;
    if (chosen && Number.isInteger(point) && point !== walk.point) {
      revealPointRef.current = true;
      dispatch({ type: 'point', point });
    }
  });
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !isTour || !visible) return;
    let frame = 0;
    const onScroll = (event: Event) => {
      const scroller = event.target;
      if (!(scroller instanceof HTMLElement) || !scroller.classList.contains('review-stack')) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncPoint(scroller));
    };
    pane.addEventListener('scroll', onScroll, true);
    return () => {
      pane.removeEventListener('scroll', onScroll, true);
      cancelAnimationFrame(frame);
    };
  }, [paneRef, isTour, visible]);

  // Inline marks: stable callbacks behind a ref so the notes are rebuilt only when the marks change.
  const handlersRef = useRef({ selectPoint, openStep });
  useLayoutEffect(() => { handlersRef.current = { selectPoint, openStep }; });
  const guideReferences = useMemo<ReviewInlineGuideNote[]>(() => {
    if (!tour) return [];
    return tourInlineNotes(tour, isTour ? { tab: 'tour', step } : { tab: 'code' }).map((note) => ({
      path: note.path,
      line: note.line,
      side: note.side,
      body: note.body,
      marker: note.marker,
      ...(isTour
        ? { onOpen: () => { revealPointRef.current = true; handlersRef.current.selectPoint(note.point); } }
        : { stopLabel: `Step ${note.step + 1} in Tour`, onOpen: () => handlersRef.current.openStep(note.step, note.point) })
    }));
  }, [tour, isTour, step]);

  // Only the Tour draws from these, so a pull request read on another tab never parses its patches for them.
  const stats = useMemo(() => isTour && visible ? tourFileStats(detail.reviewPlan) : EMPTY_STATS, [isTour, visible, detail.reviewPlan]);
  const stepLines = useMemo(() => tour ? tourStepLines(tour, stats) : [], [tour, stats]);
  const weights = useMemo(() => stepLines.map(tourSegmentWeight), [stepLines]);

  const changedPaths = useMemo(
    () => [...new Set(detail.reviewPlan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.path)))],
    [detail.reviewPlan.units]
  );
  const scope = useMemo(() => tour && stop ? tourStepScope(tour, step, stop) : undefined, [tour, stop, step]);
  const prose = useMemo(() => ({
    resolve: (reference: CodeReference) => resolveChangedFile(changedPaths, reference),
    open: (reference: CodeReference) => {
      const location = { path: reference.path, ...(reference.line ? { line: reference.line } : {}) };
      if (scope?.paths.includes(reference.path)) onNavigate(location);
      else onOpenCode(location);
    }
  }), [changedPaths, scope, onNavigate, onOpenCode]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      writeFlag(TOUR_PANEL_COLLAPSED_KEY, !value);
      return !value;
    });
  }, []);

  let reviewProps: {
    fileScope?: { key: string; paths: readonly string[] };
    sidebar?: ReactElement;
    sidebarCollapsed?: boolean;
    progressLead?: ReactElement;
    onFilesChange?: (files: ReadonlyArray<ReviewScopeFileSummary>) => void;
  } = {};
  if (isTour && tour && stop && scope) {
    const banner = tourState.running
      ? <TourBanner tone="info">Rewriting this tour. It updates here when the new one is ready.</TourBanner>
      : tourState.failure
        ? <TourBanner tone="warning" action={<WriteTourButton tour={tourState} label="Try again" />}>Could not rewrite this tour.</TourBanner>
        : !isCurrent
          ? <TourBanner tone="warning" action={<WriteTourButton tour={tourState} label="Rewrite" />}>Written before the latest push, so its points are not placed on lines.</TourBanner>
          : undefined;
    const scopeFiles = files.filter((file) => scope.paths.includes(file.path));
    reviewProps = {
      fileScope: scope,
      sidebarCollapsed: collapsed,
      onFilesChange: setFiles,
      progressLead: (
        <TourProgress stops={tour.stops} step={step} reviewed={walk.reviewed} weights={weights} onGo={(target) => go(target)}
          lead={<TourStepMap stops={tour.stops} step={step} reviewed={walk.reviewed} lines={stepLines} onGo={(target) => go(target)} />} />
      ),
      sidebar: (
        <>
          {walk.point !== null ? <ActivePointStyle marker={walk.point + 1} /> : null}
          <TourStepPanel
            stop={stop}
            step={step}
            count={count}
            reviewed={walk.reviewed.includes(step)}
            activePoint={walk.point}
            takePointReveal={takePointReveal}
            files={scopeFiles}
            stats={stats}
            banner={banner}
            riskMuted={!isCurrent}
            prose={prose}
            collapsed={collapsed}
            finishCheck={finishCheck}
            headingRef={headingRef}
            onToggleCollapsed={toggleCollapsed}
            onSelectPoint={selectPoint}
            onOpenFile={(path) => onNavigate({ path })}
            onAdvance={advance}
            onToggleReviewed={() => dispatch({ type: 'toggle-reviewed', step })}
            onFinishAnyway={() => {
              setFinishCheck(undefined);
              onFinishReview();
            }}
            onGo={(target) => go(target)}
          />
        </>
      )
    };
  }

  return { usable: tour !== null, reviewProps, guideReferences, openStep };
}

// A full changed path, or a unique path suffix such as a bare file name.
function resolveChangedFile(paths: readonly string[], reference: CodeReference): CodeReference | undefined {
  if (paths.includes(reference.path)) return reference;
  const matches = paths.filter((path) => path.endsWith(`/${reference.path}`));
  return matches.length === 1 ? { ...reference, path: matches[0]! } : undefined;
}

function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === 'true'; } catch { return false; }
}

function writeFlag(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, String(value)); } catch { /* a convenience only */ }
}
