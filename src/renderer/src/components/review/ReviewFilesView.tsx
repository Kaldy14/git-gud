// The pull-request diff surface: a files panel (or the caller's own panel) beside every file of the
// current scope stacked in one scroller, under a thin progress strip. Bodies mount lazily near the viewport.
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode, Ref } from 'react';
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileDiffOptions } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileDiff as FileDiffIcon,
  FileMinus2,
  FileOutput,
  FilePlus2,
  Search
} from 'lucide-react';

import { splitPath } from '@renderer/components/commit/fileDetailUtils';
import { announce } from '@renderer/lib/announce';
import { useDrawOnBecoming } from '@renderer/lib/motion';
import type { GitAgentNote, GitReviewChunk, GitReviewFileContext } from '@shared/types';
import {
  pullRequestShortcutKey,
  shortcutUsed,
  singleKeyShortcutsEnabled
} from '@renderer/components/github/shortcuts/pullRequestShortcuts';

import { PanelExpandButton, PanelResizeHandle } from '../ui/panelResize';
import { usePanelResize } from '../ui/usePanelResize';
import { prepareReviewDiff, type PreparedReviewDiff } from './reviewContextDiff';
import {
  NO_GUIDE_NOTES,
  patchContainsLine,
  ReviewFileBody,
  ReviewFileCommentButton,
  type ReviewDiffAnnotation,
  type ReviewInlineGuideNote,
  type ReviewLineCollaboration,
  type ReviewLineRangeTint,
  type ReviewTypeDefinitionInteraction
} from './ReviewDiffParts';
import { ReviewFilePathContextMenu } from './ReviewFilePathContextMenu';
import {
  buildReviewFileTree,
  estimateReviewChunkHeight,
  filterReviewFiles,
  reviewPanelSize,
  visibleReviewTreeRows,
  type ReviewFileStatus,
  type ReviewScopeFile,
  type ReviewTreeNode
} from './reviewFileScope';
import { moveReviewLineCursor, paintReviewLineCursor, reviewChunkElements, reviewLineCursorRange, type ReviewLineCursor } from './reviewLineCursor';

export type ReviewFilesJump = {
  path: string;
  line?: number;
  endLine?: number;
  side?: 'left' | 'right';
  /** A comment thread on that line: it is scrolled to and focused once its line has rendered. */
  commentId?: number;
  /** Resume: scroll to this hunk plus an offset into it. */
  chunkId?: string;
  offset?: number;
};

type PendingJump = ReviewFilesJump & { id: number };

/** ReviewView forwards key events from its focusable section, after its own composer and search keys. */
// What the diff keys need from a key event, so a React event and a native one (focus on `body`) both fit.
export type ReviewDiffKeyEvent = { key: string; shiftKey: boolean; preventDefault: () => void; nativeEvent: globalThis.KeyboardEvent };
export type ReviewFilesViewHandle = { handleKeyDown: (event: ReviewDiffKeyEvent) => void };

// Below the sticky file header (32px) with a little air.
const HEADER_CLEARANCE = 40;
const STICKY_HEADER_HEIGHT = 32;

export function ReviewFilesView({
  ref,
  repoPath,
  files,
  scopeKey,
  sidebar,
  sidebarCollapsed,
  sidebarActions,
  progressLead,
  active,
  coverage,
  footerControls,
  message,
  searchEntry,
  searchPanel,
  isSearchSelected,
  diffOptions,
  lineCollaboration,
  agentNotes,
  hiddenAgentNoteIds,
  onSetAgentNoteHidden,
  guideNotes,
  typeDefinitionPaths,
  typeDefinitionInteraction,
  fileContexts,
  preparedDiffCacheKeyPrefix,
  navigationRequest,
  resumePosition,
  isMutating,
  mutationError,
  onSetViewed,
  onReveal
}: {
  ref: Ref<ReviewFilesViewHandle>;
  repoPath: string;
  /** The scope's files in display order; hidden ones only appear (dimmed) in the tree. */
  files: readonly ReviewScopeFile[];
  scopeKey: string;
  sidebar?: ReactNode;
  sidebarCollapsed: boolean;
  sidebarActions?: ReactNode;
  progressLead?: ReactNode;
  active: boolean;
  coverage?: { fileCount: number; viewedFileCount: number; hiddenFileCount: number };
  footerControls: ReactNode;
  /** Replaces the stacked files (loading, error, nothing to review). */
  message?: ReactNode;
  searchEntry?: ReactNode;
  searchPanel?: ReactNode;
  isSearchSelected: boolean;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  lineCollaboration?: ReviewLineCollaboration;
  agentNotes: readonly GitAgentNote[];
  hiddenAgentNoteIds: ReadonlySet<string>;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
  guideNotes: readonly ReviewInlineGuideNote[];
  typeDefinitionPaths: ReadonlySet<string>;
  typeDefinitionInteraction: ReviewTypeDefinitionInteraction;
  fileContexts: ReadonlyMap<string, GitReviewFileContext>;
  preparedDiffCacheKeyPrefix: string;
  navigationRequest?: { path: string; line?: number; endLine?: number; side?: 'left' | 'right'; commentId?: number; signal: number };
  resumePosition?: { chunkId: string; path: string; offset: number };
  isMutating: boolean;
  mutationError?: string;
  onSetViewed: (file: ReviewScopeFile, viewed: boolean) => void;
  /** Shows one file the filters hide, leaving the filters on for everything else; false when refused. */
  onReveal: (path: string) => boolean;
}): ReactElement {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(new Map<string, HTMLElement>());
  const observerRef = useRef<IntersectionObserver | undefined>(undefined);
  const scrollTopsRef = useRef(new Map<string, number>());
  const currentByScopeRef = useRef(new Map<string, string>());
  const anchorRef = useRef<{ path: string; top: number; fallbackPath: string; isNext: boolean } | undefined>(undefined);
  const jumpIdRef = useRef(0);
  // Hunks whose diff has mounted; each stays mounted so typed text and highlighting survive.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  const [collapseOverrides, setCollapseOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [currentPath, setCurrentPath] = useState<string>();
  const [pendingJump, setPendingJump] = useState<PendingJump>();
  const [tint, setTint] = useState<ReviewLineRangeTint & { path: string }>();
  const [lineCursor, setLineCursor] = useState<ReviewLineCursor>();
  const filesPanelResize = usePanelResize(reviewPanelSize(repoPath, 'files'));
  const sidePanelResize = usePanelResize(reviewPanelSize(repoPath, 'side'));
  const { attachPanel: attachFilesPanel } = filesPanelResize;
  const { attachPanel: attachSidePanel } = sidePanelResize;
  // Both measure the same aside, so whichever panel shows next already knows the space it has.
  const attachPanel = useCallback((node: HTMLElement | null) => {
    attachFilesPanel(node);
    attachSidePanel(node);
  }, [attachFilesPanel, attachSidePanel]);
  const { width: panelWidth, ...panelResize } = sidebar ? sidePanelResize : filesPanelResize;

  const displayFiles = useMemo(() => files.filter((file) => !file.hidden), [files]);
  const isCollapsed = (file: ReviewScopeFile): boolean => collapseOverrides.get(file.path) ?? file.viewed;
  const composerPath = lineCollaboration?.selectedChunkId === undefined ? undefined
    : files.find((file) => file.chunks.some((chunk) => chunk.id === lineCollaboration.selectedChunkId))?.path;
  const current = displayFiles.find((file) => file.path === currentPath) ?? displayFiles[0];
  const currentIndex = current ? displayFiles.indexOf(current) : -1;
  const viewedCount = displayFiles.filter((file) => file.viewed).length;

  function mount(chunkIds: readonly string[]): void {
    setMounted((value) => chunkIds.every((id) => value.has(id)) ? value : new Set([...value, ...chunkIds]));
  }

  // Hunks mount within about two viewports of the scroller, so even a very long file only renders what is near.
  const handleIntersections = useEffectEvent((entries: IntersectionObserverEntry[]) => {
    const ids = entries.filter((entry) => entry.isIntersecting)
      .map((entry) => (entry.target as HTMLElement).dataset.reviewChunkPlaceholder)
      .filter((id): id is string => id !== undefined && !mounted.has(id));
    if (ids.length) mount(ids);
  });
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver((entries) => handleIntersections(entries), { root: scroller, rootMargin: '200% 0px' });
    observerRef.current = observer;
    for (const placeholder of scroller.querySelectorAll('[data-review-chunk-placeholder]')) observer.observe(placeholder);
    return () => { observer.disconnect(); observerRef.current = undefined; };
  }, [message]);
  // Stable callback refs (React 19 runs their cleanup on unmount).
  const [observeSection] = useState(() => (node: HTMLElement | null) => {
    const path = node?.dataset.reviewPath;
    if (!node || !path) return;
    sectionsRef.current.set(path, node);
    return () => {
      if (sectionsRef.current.get(path) === node) sectionsRef.current.delete(path);
    };
  });
  const [observePlaceholder] = useState(() => (node: HTMLElement | null) => {
    if (!node) return;
    observerRef.current?.observe(node);
    return () => observerRef.current?.unobserve(node);
  });

  // Scroll position and the current file are remembered per scope.
  const restoredScopeRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || restoredScopeRef.current === scopeKey) return;
    restoredScopeRef.current = scopeKey;
    scroller.scrollTop = scrollTopsRef.current.get(scopeKey) ?? 0;
    setCurrentPath(currentByScopeRef.current.get(scopeKey));
  }, [scopeKey, message]);

  const spyFrameRef = useRef(0);
  function handleScroll(): void {
    cancelAnimationFrame(spyFrameRef.current);
    spyFrameRef.current = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      scrollTopsRef.current.set(scopeKey, scroller.scrollTop);
      const top = scroller.getBoundingClientRect().top + STICKY_HEADER_HEIGHT + 1;
      const visible = displayFiles.find((file) => (sectionsRef.current.get(file.path)?.getBoundingClientRect().bottom ?? 0) > top);
      if (visible && visible.path !== currentPath) {
        currentByScopeRef.current.set(scopeKey, visible.path);
        setCurrentPath(visible.path);
      }
    });
  }
  useEffect(() => () => cancelAnimationFrame(spyFrameRef.current), []);

  function jumpTo(jump: ReviewFilesJump): void {
    const file = files.find((candidate) => candidate.path === jump.path);
    if (!file) return;
    const chunkWithLine = (chunks: readonly GitReviewChunk[]): string | undefined => jump.line === undefined ? undefined
      : chunks.find((chunk) => patchContainsLine(chunk.patch, jump.line!, jump.side ?? 'right'))?.id;
    const shown = jump.chunkId ?? chunkWithLine(file.chunks);
    // A line in a hunk the filters hide (a thread opened from Overview) needs its file revealed, like a hidden file.
    const filtered = shown ? undefined : chunkWithLine(file.filteredChunks);
    if ((file.hidden || filtered) && !onReveal(file.path)) return;
    setCollapseOverrides((value) => value.get(file.path) === false ? value : new Map(value).set(file.path, false));
    // Mount the hunk holding the target (or the file's first two viewports) first; the rest follow the scroll.
    const target = shown ?? filtered;
    if (target) mount([target]);
    else mount(leadingChunkIds(file, 2 * (scrollerRef.current?.clientHeight ?? 800)));
    currentByScopeRef.current.set(scopeKey, file.path);
    setCurrentPath(file.path);
    setTint(jump.line === undefined ? undefined : { path: jump.path, line: jump.line, endLine: jump.endLine, side: jump.side });
    jumpIdRef.current += 1;
    setPendingJump({ ...jump, id: jumpIdRef.current });
  }

  // Every jump mounts its target first, then scrolls once the diff (rendered by workers) has rows.
  useEffect(() => {
    if (!pendingJump || message) return;
    const jump = pendingJump;
    let frame = 0;
    let attempts = 0;
    const locate = (): void => {
      const scroller = scrollerRef.current;
      const section = sectionsRef.current.get(jump.path);
      const finish = (landed = true): void => {
        setPendingJump((value) => value?.id === jump.id ? undefined : value);
        // Giving up on a target that never rendered lands nowhere, so nothing flashes.
        if (!landed) return;
        // The landing flash starts once the lines are in view, however long the hunk took to render, and
        // belongs to this jump alone: afterwards the tint rests, so lines that mount or scroll back later
        // do not flash again.
        setTint((current) => current ? { ...current, landing: jump.id } : current);
        window.setTimeout(() => setTint((current) => current?.landing === jump.id ? { ...current, landing: undefined } : current), 900);
      };
      if (!scroller || !section) {
        if (++attempts < 120) frame = requestAnimationFrame(locate);
        else finish(false);
        return;
      }
      const scrollerTop = scroller.getBoundingClientRect().top;
      if (jump.chunkId) {
        const chunk = section.querySelector<HTMLElement>(`[data-review-chunk-id="${CSS.escape(jump.chunkId)}"]`);
        if (chunk && chunk.clientHeight > 0) {
          scroller.scrollTop += chunk.getBoundingClientRect().top - scrollerTop - STICKY_HEADER_HEIGHT + Math.min(jump.offset ?? 0, chunk.clientHeight);
          finish();
          return;
        }
      } else if (jump.line !== undefined) {
        const row = findReviewLine(section, jump.line, jump.side ?? 'right');
        const thread = row && jump.commentId !== undefined ? findReviewThread(section, jump.commentId) : undefined;
        if (thread) {
          thread.scrollIntoView({ block: 'center' });
          thread.focus({ preventScroll: true });
          finish();
          return;
        }
        // A thread renders a moment after its line; wait for it a few frames before settling for the line.
        if (row && (jump.commentId === undefined || attempts > 30)) {
          row.scrollIntoView({ block: 'center' });
          finish();
          return;
        }
      } else {
        // A file-level thread has no line; it renders above the file's first hunk.
        const thread = jump.commentId !== undefined ? findReviewThread(section, jump.commentId) : undefined;
        if (thread) {
          thread.scrollIntoView({ block: 'center' });
          thread.focus({ preventScroll: true });
          finish();
          return;
        }
        if (jump.commentId === undefined || attempts > 30) {
          scroller.scrollTop += section.getBoundingClientRect().top - scrollerTop;
          finish();
          return;
        }
      }
      if (++attempts < 120) frame = requestAnimationFrame(locate);
      else {
        // The line is not in the rendered diff (outside every hunk): show the file instead.
        scroller.scrollTop += section.getBoundingClientRect().top - scrollerTop;
        finish(false);
      }
    };
    frame = requestAnimationFrame(locate);
    return () => cancelAnimationFrame(frame);
  }, [pendingJump, message, displayFiles]);

  // Outside requests (Tour points, Overview threads, the old All files) wait for the files, then run once.
  const handledNavigationRef = useRef<number | undefined>(undefined);
  const openNavigationRequest = useEffectEvent(() => {
    if (!navigationRequest || handledNavigationRef.current === navigationRequest.signal) return;
    if (!files.some((file) => file.path === navigationRequest.path)) return;
    handledNavigationRef.current = navigationRequest.signal;
    const { path, line, endLine, side, commentId } = navigationRequest;
    jumpTo({ path, line, endLine, side, commentId });
  });
  // A one-shot reaction to an outside request once its file exists; it cannot run during render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { openNavigationRequest(); }, [navigationRequest, files]);

  const resumedRef = useRef(false);
  const resume = useEffectEvent(() => {
    if (resumedRef.current || !resumePosition || navigationRequest) return;
    const file = displayFiles.find((candidate) => candidate.path === resumePosition.path);
    if (!file) return;
    resumedRef.current = true;
    const chunkId = file.chunks.some((chunk) => chunk.id === resumePosition.chunkId) ? resumePosition.chunkId : undefined;
    jumpTo({ path: file.path, chunkId, offset: chunkId ? resumePosition.offset : undefined });
  });
  // Resumes the saved position once, when its file is first listed.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { resume(); }, [displayFiles]);

  // Ticking Viewed collapses the file; keep the next unviewed header where the reader's eye was, or bring
  // it into view when it was off screen.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    anchorRef.current = undefined;
    const scrollerRect = scroller.getBoundingClientRect();
    const section = sectionsRef.current.get(anchor.path);
    if (section && anchor.isNext) {
      const wasVisible = anchor.top >= 0 && anchor.top < scrollerRect.height;
      scroller.scrollTop += section.getBoundingClientRect().top - scrollerRect.top - (wasVisible ? anchor.top : 0);
      return;
    }
    const fallback = sectionsRef.current.get(anchor.fallbackPath);
    if (fallback && fallback.getBoundingClientRect().top < scrollerRect.top) {
      scroller.scrollTop += fallback.getBoundingClientRect().top - scrollerRect.top;
    }
  }, [files]);

  // The actions below report whether they acted, so a key that did nothing does not light its cap.
  function toggleViewed(file: ReviewScopeFile): boolean {
    if (isMutating || file.path === composerPath) return false;
    const viewed = !file.viewed;
    setCollapseOverrides((value) => {
      if (!value.has(file.path)) return value;
      const next = new Map(value);
      next.delete(file.path);
      return next;
    });
    if (viewed) {
      const index = displayFiles.indexOf(file);
      const next = [...displayFiles.slice(index + 1), ...displayFiles.slice(0, index)].find((candidate) => !candidate.viewed);
      const scroller = scrollerRef.current;
      const nextSection = next ? sectionsRef.current.get(next.path) : undefined;
      if (scroller) {
        anchorRef.current = {
          path: next?.path ?? file.path,
          top: nextSection ? nextSection.getBoundingClientRect().top - scroller.getBoundingClientRect().top : -1,
          fallbackPath: file.path,
          isNext: nextSection !== undefined
        };
      }
      if (next) {
        currentByScopeRef.current.set(scopeKey, next.path);
        setCurrentPath(next.path);
      }
      announce(next ? `${file.path} viewed. Next: ${next.path}` : `${file.path} viewed. Every file is viewed.`);
    } else {
      mount(leadingChunkIds(file, 2 * (scrollerRef.current?.clientHeight ?? 800)));
      announce(`${file.path} marked not viewed`);
    }
    onSetViewed(file, viewed);
    return true;
  }

  function toggleCollapsed(file: ReviewScopeFile): void {
    const collapsed = isCollapsed(file);
    // Collapsing only hides a mounted body, but an open composer would vanish from sight.
    if (!collapsed && file.path === composerPath) return;
    if (collapsed) mount(leadingChunkIds(file, 2 * (scrollerRef.current?.clientHeight ?? 800)));
    setCollapseOverrides((value) => new Map(value).set(file.path, !collapsed));
  }

  function stepFile(direction: -1 | 1): boolean {
    const target = displayFiles[currentIndex === -1 ? 0 : currentIndex + direction];
    if (target) jumpTo({ path: target.path });
    return target !== undefined;
  }

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) paintReviewLineCursor(scroller, lineCursor);
  }, [lineCursor]);

  function firstVisibleChunkId(scroller: HTMLElement): string | undefined {
    const top = scroller.getBoundingClientRect().top + HEADER_CLEARANCE;
    return reviewChunkElements(scroller).find((chunk) => chunk.getBoundingClientRect().bottom > top)?.dataset.reviewChunkId;
  }

  function commentOnLineCursor(scroller: HTMLElement, cursor: ReviewLineCursor): boolean {
    const range = reviewLineCursorRange(scroller, cursor);
    const path = files.find((file) => file.chunks.some((chunk) => chunk.id === cursor.chunkId))?.path;
    if (!range || !path || !lineCollaboration) return false;
    setLineCursor(undefined);
    lineCollaboration.onSelectLines(cursor.chunkId, path, range);
    return true;
  }

  // Diff keys: [ ] files, V viewed, ↑ ↓ (Shift) lines, C comment, Escape clears the cursor. No J/K here.
  function handleKeyDown(event: ReviewDiffKeyEvent): void {
    const scroller = scrollerRef.current;
    if (!active || !scroller || isSearchSelected || composerPath || lineCollaboration?.isSubmitting) return;
    const native = event.nativeEvent;
    if (event.key === 'Escape' && lineCursor && !native.defaultPrevented) {
      event.preventDefault();
      setLineCursor(undefined);
      return;
    }
    const isArrow = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    // Shift extends the line cursor; the helper otherwise rejects modified arrows.
    const key = pullRequestShortcutKey(isArrow && event.shiftKey && !native.altKey && !native.ctrlKey && !native.metaKey
      ? { key: event.key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: native.defaultPrevented, isComposing: native.isComposing, target: native.target }
      : native);
    if (!key) return;
    if (isArrow) {
      event.preventDefault();
      // Crossing into the next hunk or file needs its diff mounted before the cursor can land on it.
      if (lineCursor) {
        const open = displayFiles.filter((file) => !isCollapsed(file)).flatMap((file) => file.chunks);
        const next = open[open.findIndex((chunk) => chunk.id === lineCursor.chunkId) + (key === 'ArrowDown' ? 1 : -1)];
        if (next) mount([next.id]);
      }
      const moved = moveReviewLineCursor(scroller, lineCursor, key === 'ArrowDown' ? 1 : -1, event.shiftKey, firstVisibleChunkId(scroller));
      setLineCursor(moved);
      // At either end of the diff the cursor stays where it is, and so does the key cap.
      if (JSON.stringify(moved) !== JSON.stringify(lineCursor)) shortcutUsed(key === 'ArrowDown' ? '↓' : '↑');
      return;
    }
    if (!singleKeyShortcutsEnabled()) return;
    if (key === ']' || key === '[') {
      event.preventDefault();
      if (stepFile(key === ']' ? 1 : -1)) shortcutUsed(key);
    } else if (key === 'v' && current) {
      event.preventDefault();
      if (toggleViewed(current)) shortcutUsed('V');
    } else if (key === 'c' && lineCursor) {
      event.preventDefault();
      if (commentOnLineCursor(scroller, lineCursor)) shortcutUsed('C');
    }
  }

  useImperativeHandle(ref, () => ({ handleKeyDown }));

  const isPanelCollapsed = sidebar !== undefined && sidebarCollapsed;
  const panelStyle: CSSProperties | undefined = isPanelCollapsed ? undefined : { width: panelWidth, flexBasis: panelWidth };
  const progressText = displayFiles.length
    ? `File ${Math.max(1, currentIndex + 1)} of ${displayFiles.length} · ${viewedCount} viewed`
    : 'No files to show';

  return (
    <div className="review-files-layout">
      <div className="review-files-progress">
        {progressLead ?? (
          <>
            <span className="review-files-progress-text" aria-live="off">{progressText}</span>
            <span className="review-files-progress-bar" role="progressbar" aria-label="Files viewed"
              aria-valuemin={0} aria-valuemax={displayFiles.length} aria-valuenow={viewedCount}
              aria-valuetext={`${viewedCount} of ${displayFiles.length} files viewed`}>
              <i style={{ width: `${displayFiles.length ? (viewedCount / displayFiles.length) * 100 : 0}%` }} />
            </span>
          </>
        )}
      </div>
      <div className="review-files-main">
        <aside ref={attachPanel} className="review-files-panel" style={panelStyle} data-collapsed={isPanelCollapsed || undefined}
          aria-label={sidebar ? undefined : 'Changed files'}>
          {sidebar ?? (
            <ReviewFilesPanel
              files={files}
              currentPath={isSearchSelected ? undefined : current?.path}
              actions={sidebarActions}
              expand={<PanelExpandButton resize={panelResize} label="files panel" />}
              searchEntry={searchEntry}
              coverage={coverage}
              footerControls={footerControls}
              mutationError={mutationError}
              onOpen={(path) => jumpTo({ path })}
            />
          )}
          {isPanelCollapsed ? null : <PanelResizeHandle resize={panelResize} label={sidebar ? 'side panel' : 'files panel'} />}
        </aside>
        <div className="review-files-content">
          {searchPanel && isSearchSelected ? <div className="review-files-search">{searchPanel}</div> : null}
          {message ? (
            <div className="review-files-message" hidden={isSearchSelected}>{message}</div>
          ) : (
            <div ref={scrollerRef} className="review-chunks review-stack" hidden={isSearchSelected} onScroll={handleScroll}>
              {displayFiles.map((file) => {
                const collapsed = isCollapsed(file);
                return (
                  <ReviewStackedFile
                    key={file.key}
                    ref={observeSection}
                    file={file}
                    collapsed={collapsed}
                    mountedChunkIds={mounted}
                    observePlaceholder={observePlaceholder}
                    current={file.path === current?.path}
                    composerOpen={file.path === composerPath}
                    isMutating={isMutating}
                    diffOptions={diffOptions}
                    lineCollaboration={lineCollaboration}
                    agentNotes={agentNotes}
                    hiddenAgentNoteIds={hiddenAgentNoteIds}
                    onSetAgentNoteHidden={onSetAgentNoteHidden}
                    guideNotes={guideNotes}
                    tint={tint?.path === file.path ? tint : undefined}
                    typeDefinitionPaths={typeDefinitionPaths}
                    typeDefinitionInteraction={typeDefinitionInteraction}
                    fileContexts={fileContexts}
                    preparedDiffCacheKeyPrefix={preparedDiffCacheKeyPrefix}
                    onToggleCollapsed={() => toggleCollapsed(file)}
                    onToggleViewed={() => toggleViewed(file)}
                    onOpenComposer={() => {
                      if (collapsed) setCollapseOverrides((value) => new Map(value).set(file.path, false));
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStackedFile({
  ref,
  file,
  collapsed,
  mountedChunkIds,
  observePlaceholder,
  current,
  composerOpen,
  isMutating,
  diffOptions,
  lineCollaboration,
  agentNotes,
  hiddenAgentNoteIds,
  onSetAgentNoteHidden,
  guideNotes,
  tint,
  typeDefinitionPaths,
  typeDefinitionInteraction,
  fileContexts,
  preparedDiffCacheKeyPrefix,
  onToggleCollapsed,
  onToggleViewed,
  onOpenComposer
}: {
  ref: Ref<HTMLElement>;
  file: ReviewScopeFile;
  collapsed: boolean;
  mountedChunkIds: ReadonlySet<string>;
  observePlaceholder: (node: HTMLElement | null) => void;
  current: boolean;
  composerOpen: boolean;
  isMutating: boolean;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  lineCollaboration?: ReviewLineCollaboration;
  agentNotes: readonly GitAgentNote[];
  hiddenAgentNoteIds: ReadonlySet<string>;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
  guideNotes: readonly ReviewInlineGuideNote[];
  tint?: ReviewLineRangeTint;
  typeDefinitionPaths: ReadonlySet<string>;
  typeDefinitionInteraction: ReviewTypeDefinitionInteraction;
  fileContexts: ReadonlyMap<string, GitReviewFileContext>;
  preparedDiffCacheKeyPrefix: string;
  onToggleCollapsed: () => void;
  onToggleViewed: () => void;
  onOpenComposer: () => void;
}): ReactElement {
  const { directory, basename } = splitPath(file.path);
  const composerId = `review-file-composer-${file.key}`;
  const viewedDisabled = composerOpen || isMutating;
  // A collapsed file keeps a body it already showed, hidden, so replies and edits typed there survive.
  const hasMountedChunk = file.chunks.some((chunk) => mountedChunkIds.has(chunk.id));
  const hasFileThreads = lineCollaboration?.threads.some((thread) => thread.subjectType === 'file' && thread.path === file.path) ?? false;
  const fileAgentNotes = useMemo(() => agentNotes.filter((note) => note.path === file.path), [agentNotes, file.path]);
  const fileGuideNotes = useMemo(() => {
    const notes = guideNotes.filter((note) => note.path === file.path);
    return notes.length ? notes : NO_GUIDE_NOTES;
  }, [guideNotes, file.path]);

  return (
    <section ref={ref} className="review-stack-file" data-review-path={file.path} data-collapsed={collapsed}
      data-current={current || undefined} aria-label={file.path}>
      <div className="review-stack-file-header">
        <ReviewFilePathContextMenu path={file.path}>
          <button className="review-stack-file-toggle" type="button" aria-expanded={!collapsed}
            aria-disabled={(!collapsed && composerOpen) || undefined}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}
            title={!collapsed && composerOpen ? 'Finish or cancel the comment first' : undefined}
            onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            <ReviewFileStatusIcon status={file.status} />
            <span className="review-file-path" title={file.path}>
              {directory ? <span className="review-file-directory">{directory}</span> : null}
              <span className="review-file-basename">{basename}</span>
            </span>
            <ReviewFileStat additions={file.additions} deletions={file.deletions} />
          </button>
        </ReviewFilePathContextMenu>
        {lineCollaboration ? (
          <ReviewFileCommentButton collaboration={lineCollaboration} chunk={file.chunks[0]!} composerId={composerId}
            onOpen={onOpenComposer} />
        ) : null}
        <label className="review-stack-viewed" data-disabled={viewedDisabled || undefined}
          title={composerOpen ? 'Finish or cancel the comment in this file first' : undefined}>
          <input type="checkbox" checked={file.viewed} aria-disabled={viewedDisabled || undefined}
            aria-label={`Viewed ${basename}`} aria-keyshortcuts="V"
            onChange={() => { if (!viewedDisabled) onToggleViewed(); }} />
          <span aria-hidden="true">Viewed</span>
        </label>
      </div>
      {!collapsed || hasMountedChunk || hasFileThreads ? (
        <ReviewStackedFileBody
          hidden={collapsed}
          mountedChunkIds={mountedChunkIds}
          observePlaceholder={observePlaceholder}
          file={file}
          composerId={composerId}
          diffOptions={diffOptions}
          lineCollaboration={lineCollaboration}
          agentNotes={fileAgentNotes}
          hiddenAgentNoteIds={hiddenAgentNoteIds}
          onSetAgentNoteHidden={onSetAgentNoteHidden}
          guideNotes={fileGuideNotes}
          tint={tint}
          typeDefinitionPaths={typeDefinitionPaths}
          typeDefinitionInteraction={typeDefinitionInteraction}
          fileContexts={fileContexts}
          preparedDiffCacheKeyPrefix={preparedDiffCacheKeyPrefix}
        />
      ) : null}
    </section>
  );
}

// Prepared diffs per hunk, computed once per plan and file context.
const preparedDiffCache = new WeakMap<GitReviewChunk, { key: string; diff: PreparedReviewDiff | undefined }>();

function prepareChunk(chunk: GitReviewChunk, context: GitReviewFileContext | undefined, prefix: string): PreparedReviewDiff | undefined {
  const key = `${prefix}:${context?.id ?? ''}:${context ? context.newContents.length : 0}`;
  const cached = preparedDiffCache.get(chunk);
  if (cached?.key === key) return cached.diff;
  const diff = prepareReviewDiff(chunk, context, prefix);
  preparedDiffCache.set(chunk, { key, diff });
  return diff;
}

function ReviewStackedFileBody({
  hidden,
  file,
  mountedChunkIds,
  observePlaceholder,
  fileContexts,
  preparedDiffCacheKeyPrefix,
  ...body
}: Omit<Parameters<typeof ReviewFileBody>[0], 'preparedDiffs'> & {
  hidden: boolean;
  file: ReviewScopeFile;
  mountedChunkIds: ReadonlySet<string>;
  observePlaceholder: (node: HTMLElement | null) => void;
  fileContexts: ReadonlyMap<string, GitReviewFileContext>;
  preparedDiffCacheKeyPrefix: string;
}): ReactElement {
  const workerPool = useWorkerPool();
  const mountedKey = file.chunks.filter((chunk) => mountedChunkIds.has(chunk.id)).map((chunk) => chunk.id).join('\n');
  // Prepared and highlighted only once a hunk mounts, never for the whole pull request.
  const preparedDiffs = useMemo(() => {
    const ids = new Set(mountedKey.split('\n'));
    const prepared = new Map<string, PreparedReviewDiff>();
    for (const chunk of file.chunks) {
      if (chunk.omittedReason || !ids.has(chunk.id)) continue;
      const diff = prepareChunk(chunk, chunk.fileContextId ? fileContexts.get(chunk.fileContextId) : undefined, preparedDiffCacheKeyPrefix);
      if (diff) prepared.set(chunk.id, diff);
    }
    return prepared;
  }, [file.chunks, fileContexts, mountedKey, preparedDiffCacheKeyPrefix]);
  useEffect(() => {
    for (const prepared of preparedDiffs.values()) workerPool?.primeDiffHighlightCache(prepared.fileDiff);
  }, [preparedDiffs, workerPool]);

  // Collapsing hides the body instead of unmounting it, so typed replies and edits survive.
  return (
    <div className="review-stack-file-body" hidden={hidden}>
      <ReviewFileBody file={file} preparedDiffs={preparedDiffs} {...body}
        isChunkMounted={(chunk) => mountedChunkIds.has(chunk.id)}
        renderChunkPlaceholder={(chunk) => (
          <div ref={observePlaceholder} className="review-stack-placeholder" data-review-chunk-placeholder={chunk.id}
            style={{ height: estimateReviewChunkHeight(chunk) }} aria-hidden="true" />
        )} />
    </div>
  );
}

/** The tree's viewed mark. Ticking a file draws it; a file that was already viewed just shows it. */
function ViewedTick({ viewed }: { viewed: boolean }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  useDrawOnBecoming(ref, viewed);
  return <span ref={ref} className="review-files-tree-viewed" aria-hidden="true">{viewed ? <Check size={12} /> : null}</span>;
}

function ReviewFilesPanel({
  files,
  currentPath,
  actions,
  expand,
  searchEntry,
  coverage,
  footerControls,
  mutationError,
  onOpen
}: {
  files: readonly ReviewScopeFile[];
  currentPath?: string;
  actions?: ReactNode;
  expand: ReactNode;
  searchEntry?: ReactNode;
  coverage?: { fileCount: number; viewedFileCount: number; hiddenFileCount: number };
  footerControls: ReactNode;
  mutationError?: string;
  onOpen: (path: string) => void;
}): ReactElement {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => buildReviewFileTree(filterReviewFiles(files, filter)), [files, filter]);

  return (
    <>
      <header className="review-files-panel-header">
        <h2>Files</h2>
        <span className="review-files-count">{files.length}</span>
        <span className="review-files-panel-actions">{actions}{expand}</span>
      </header>
      <div className="review-files-filter">
        <Search size={14} aria-hidden="true" />
        <input type="search" value={filter} placeholder="Filter files" aria-label="Filter files" spellCheck={false}
          onChange={(event) => setFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filter) {
              event.preventDefault();
              event.stopPropagation();
              setFilter('');
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.currentTarget.closest('.review-files-panel')?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
            }
          }} />
      </div>
      {searchEntry}
      <ReviewFilesTree nodes={filtered} currentPath={currentPath} filtering={filter.trim() !== ''} onOpen={onOpen} />
      <footer className="review-files-footer">
        {coverage ? (
          <p className="review-files-coverage" title="Hidden files never count as viewed. Open a dimmed file to review it.">
            {coverage.viewedFileCount} of {coverage.fileCount} viewed
            {coverage.hiddenFileCount > 0 ? ` · ${coverage.hiddenFileCount} hidden` : ''}
          </p>
        ) : null}
        <div className="review-files-footer-controls">{footerControls}</div>
        {mutationError ? <p className="review-navigation-error" role="alert">{mutationError}</p> : null}
      </footer>
    </>
  );
}

function ReviewFilesTree({ nodes, currentPath, filtering, onOpen }: {
  nodes: readonly ReviewTreeNode[];
  currentPath?: string;
  filtering: boolean;
  onOpen: (path: string) => void;
}): ReactElement {
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string>();
  const treeRef = useRef<HTMLDivElement>(null);
  // A filter shows every match, whatever was folded.
  const rows = useMemo(() => visibleReviewTreeRows(nodes, filtering ? new Set() : collapsedDirectories), [nodes, filtering, collapsedDirectories]);
  const parents = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (list: readonly ReviewTreeNode[], parent?: string): void => {
      for (const node of list) {
        if (parent) map.set(node.id, parent);
        if (node.kind === 'directory') walk(node.children, node.id);
      }
    };
    walk(nodes);
    return map;
  }, [nodes]);
  const tabStop = rows.find((row) => row.id === focusedId)?.id ?? rows.find((row) => row.id === currentPath)?.id ?? rows[0]?.id;

  // The current file follows the scroll; keep its row in view without stealing focus.
  useEffect(() => {
    if (!currentPath) return;
    treeRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(currentPath)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [currentPath]);

  function focusRow(id: string | undefined): void {
    if (!id) return;
    setFocusedId(id);
    treeRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();
  }

  function toggleDirectory(id: string, open?: boolean): void {
    setCollapsedDirectories((value) => {
      const isOpen = !value.has(id);
      if (open !== undefined && open === isOpen) return value;
      const next = new Set(value);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, row: ReviewTreeNode, index: number): void {
    const isOpenDirectory = row.kind === 'directory' && (filtering || !collapsedDirectories.has(row.id));
    let handled = true;
    if (event.key === 'ArrowDown') focusRow(rows[index + 1]?.id);
    else if (event.key === 'ArrowUp') focusRow(rows[index - 1]?.id);
    else if (event.key === 'Home') focusRow(rows[0]?.id);
    else if (event.key === 'End') focusRow(rows[rows.length - 1]?.id);
    else if (event.key === 'ArrowRight') {
      if (row.kind === 'directory' && !isOpenDirectory) toggleDirectory(row.id, true);
      else if (row.kind === 'directory') focusRow(rows[index + 1]?.id);
    } else if (event.key === 'ArrowLeft') {
      if (isOpenDirectory && !filtering) toggleDirectory(row.id, false);
      else focusRow(parents.get(row.id));
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (row.kind === 'file') onOpen(row.file.path);
      else if (!filtering) toggleDirectory(row.id);
    } else handled = false;
    if (handled && !event.altKey && !event.ctrlKey && !event.metaKey) event.preventDefault();
  }

  if (rows.length === 0) {
    return <p className="review-files-tree-empty">{filtering ? 'No files match.' : 'No changed files.'}</p>;
  }

  return (
    <div ref={treeRef} className="review-files-tree" role="tree" aria-label="Changed files">
      {rows.map((row, index) => {
        const style = { '--review-tree-depth': row.depth } as CSSProperties;
        if (row.kind === 'directory') {
          const open = filtering || !collapsedDirectories.has(row.id);
          return (
            <div key={row.id} className="review-files-tree-row" data-kind="directory" role="treeitem" aria-level={row.depth + 1}
              aria-expanded={open} tabIndex={row.id === tabStop ? 0 : -1} data-tree-id={row.id} style={style}
              title={row.name} onFocus={() => setFocusedId(row.id)}
              onClick={() => { setFocusedId(row.id); if (!filtering) toggleDirectory(row.id); }}
              onKeyDown={(event) => handleKeyDown(event, row, index)}>
              {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              <span className="review-files-tree-name">{row.name}</span>
            </div>
          );
        }
        const { file } = row;
        return (
          <div key={row.id} className="review-files-tree-row" data-kind="file" data-hidden={file.hidden || undefined}
            data-viewed={file.viewed || undefined} role="treeitem" aria-level={row.depth + 1}
            aria-selected={file.path === currentPath} tabIndex={row.id === tabStop ? 0 : -1} data-tree-id={row.id} style={style}
            aria-label={`${file.path}, ${STATUS_LABELS[file.status]}, ${file.additions} added, ${file.deletions} removed${file.viewed ? ', viewed' : ''}${file.hidden ? ', hidden by review filters' : ''}`}
            title={file.hidden ? `${file.path} · Hidden by review filters. Open it to review just this file.` : file.path}
            onFocus={() => setFocusedId(row.id)}
            onClick={() => { setFocusedId(row.id); onOpen(file.path); }}
            onKeyDown={(event) => handleKeyDown(event, row, index)}>
            <span className="review-files-tree-chevron" aria-hidden="true" />
            {file.hidden ? <EyeOff size={14} aria-hidden="true" className="review-files-tree-hidden-icon" /> : <ReviewFileStatusIcon status={file.status} />}
            <span className="review-files-tree-name">{row.name}</span>
            <ReviewFileStat additions={file.additions} deletions={file.deletions} />
            <ViewedTick viewed={file.viewed} />
          </div>
        );
      })}
    </div>
  );
}

const STATUS_LABELS: Record<ReviewFileStatus, string> = {
  added: 'added', deleted: 'deleted', renamed: 'renamed', modified: 'modified'
};

function ReviewFileStatusIcon({ status }: { status: ReviewFileStatus }): ReactElement {
  const Icon = status === 'added' ? FilePlus2 : status === 'deleted' ? FileMinus2 : status === 'renamed' ? FileOutput : FileDiffIcon;
  return <Icon size={14} aria-hidden="true" className="review-file-status-icon" data-status={status} />;
}

function ReviewFileStat({ additions, deletions }: { additions: number; deletions: number }): ReactElement {
  return (
    <span className="review-file-stat" aria-hidden="true">
      <span data-tone="added">+{additions}</span>
      <span data-tone="removed">−{deletions}</span>
    </span>
  );
}

function leadingChunkIds(file: ReviewScopeFile, height: number): string[] {
  const ids: string[] = [];
  let covered = 0;
  for (const chunk of file.chunks) {
    if (covered >= height) break;
    ids.push(chunk.id);
    covered += estimateReviewChunkHeight(chunk);
  }
  return ids;
}

function findReviewThread(section: HTMLElement, commentId: number): HTMLElement | undefined {
  const selector = `[data-review-comment-id="${commentId}"]`;
  const inLightDom = section.querySelector<HTMLElement>(selector);
  if (inLightDom) return inLightDom;
  for (const diff of section.querySelectorAll('.gg-diff')) {
    const thread = diff.shadowRoot?.querySelector<HTMLElement>(selector);
    if (thread) return thread;
  }
  return undefined;
}

function findReviewLine(section: HTMLElement, line: number, side: 'left' | 'right'): HTMLElement | undefined {
  const context = ':is([data-line-type="context"], [data-line-type="context-expanded"])';
  const selectors = side === 'left'
    ? [`[data-line="${line}"][data-line-type="change-deletion"]`, `[data-alt-line="${line}"]${context}`]
    : [`[data-line="${line}"][data-line-type="change-addition"]`, `[data-line="${line}"]${context}`];
  for (const diff of section.querySelectorAll('.gg-diff')) {
    for (const selector of selectors) {
      const row = diff.shadowRoot?.querySelector<HTMLElement>(selector);
      if (row) return row;
    }
  }
  return undefined;
}
