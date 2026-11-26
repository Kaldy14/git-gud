// Diff pieces shared by the standard review (blocks) and the pull-request files layout:
// one file with its hunks, line/file comment threads, the inline composer and inline notes.
import { EASE_OUT } from '@renderer/lib/motion';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { createContext, Fragment, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  DiffLineAnnotation,
  DiffTokenEventBaseProps,
  FileDiffOptions,
  SelectedLineRange
} from '@pierre/diffs';
import { FileDiff, PatchDiff, type DiffBasePropsReact } from '@pierre/diffs/react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  EyeOff,
  FileCode2,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Reply,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';

import { splitPath } from '@renderer/components/commit/fileDetailUtils';
import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import type {
  GitAgentNote,
  GitReviewChunk,
  GitReviewGuideFile,
  GitReviewGuideNote
} from '@shared/types';

import type { PreparedReviewDiff } from './reviewContextDiff';
import { createReviewContextOptions, shareReviewExpansionBoundary } from './reviewContextExpansion';
import { ReviewFilePathContextMenu } from './ReviewFilePathContextMenu';
import { ReviewGuidePriority } from './ReviewGuidePanel';
import { createReviewLineSelectionOptions, normalizeReviewLineSelection } from './reviewLineSelection';
import type { ReviewSearchLine } from './reviewSearch';
import type { VisibleReviewFile } from './reviewSections';
import { REVIEW_TYPE_DEFINITION_HOVER_CSS } from './reviewTypeDefinitionInteraction';

/** Lets the review's owner know whether any editor below holds typed, unsaved text. */
export const ReviewUnsavedTextContext = createContext<((id: string, unsaved: boolean) => void) | undefined>(undefined);

function useReportUnsavedText(unsaved: boolean): void {
  const report = useContext(ReviewUnsavedTextContext);
  const id = useId();
  useEffect(() => {
    if (!report || !unsaved) return;
    report(id, true);
    return () => report(id, false);
  }, [id, report, unsaved]);
}

export type ReviewLineComment = {
  id: string | number;
  body: string;
  author: string;
  authorAvatarUrl?: string;
  createdAt: string;
  path: string;
  subjectType: 'line' | 'file';
  line?: number;
  side?: 'left' | 'right';
  inReplyToId?: string | number;
  isDraft?: boolean;
  canEdit?: boolean;
  isResolved?: boolean;
  isOutdated?: boolean;
  url?: string;
};

export type ReviewLineCommentInput = {
  body: string;
  path: string;
  line: number;
  side: 'left' | 'right';
  startLine?: number;
  startSide?: 'left' | 'right';
};

export type ReviewLineReplyInput = {
  body: string;
  inReplyToId: number;
};

export type ReviewFileCommentInput = {
  body: string;
  path: string;
};

export type ReviewCommentThread = ReviewLineComment & {
  replies: ReviewLineComment[];
};

export type ReviewDiffAnnotation =
  | { kind: 'thread'; thread: ReviewCommentThread }
  | { kind: 'composer' }
  | { kind: 'guide-note'; note: ReviewInlineGuideNote }
  | { kind: 'agent-note'; note: GitAgentNote; hidden: boolean };

export const NO_GUIDE_NOTES: readonly ReviewInlineGuideNote[] = [];

/**
 * An inline AI note. Tour notes carry the caller's label for the copper key (`2`, `2.1`), a title and a way back
 * to their step; `side` places a note on removed code (default: the new side).
 */
export type ReviewInlineGuideNote = GitReviewGuideNote & {
  side?: 'left' | 'right';
  marker?: string;
  title?: string;
  stopLabel?: string;
  onOpen?: () => void;
};

export type ReviewLineCollaboration = {
  threads: ReviewCommentThread[];
  selectedChunkId?: string;
  selectedPath?: string;
  selectedSubject?: 'line' | 'file';
  selectedLines: SelectedLineRange | null;
  getBody: () => string;
  isSubmitting: boolean;
  errorMessage?: string;
  onSelectLines: (chunkId: string, path: string, range: SelectedLineRange | null) => void;
  onSelectFile: (chunkId: string, path: string) => void;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>, body: string) => void;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onUpdateComment?: (commentId: number, body: string) => Promise<void>;
  onUpdateDraftComment?: (id: string, body: string) => void;
  onRemoveDraftComment?: (id: string) => void;
};

export type ReviewTypeDefinitionRequest = (
  chunk: GitReviewChunk,
  token: DiffTokenEventBaseProps,
  event: MouseEvent
) => void;

export type ReviewTypeDefinitionHoverTarget = {
  chunk: GitReviewChunk;
  token: DiffTokenEventBaseProps;
  event: Pick<PointerEvent, 'clientX' | 'clientY'>;
};

export type ReviewTypeDefinitionInteraction = {
  onClick: ReviewTypeDefinitionRequest;
  onEnter: (
    chunk: GitReviewChunk,
    token: DiffTokenEventBaseProps,
    event: PointerEvent
  ) => void;
  onLeave: (token: DiffTokenEventBaseProps) => void;
};

export function createReviewSearchHighlightCSS(
  lines: readonly ReviewSearchLine[] | undefined
): string {
  if (!lines?.length) {
    return '';
  }

  const lineSelectors = new Set<string>();
  const gutterSelectors = new Set<string>();

  for (const line of lines) {
    const lineType = line.kind === 'addition'
      ? '[data-line-type="change-addition"]'
      : line.kind === 'deletion'
        ? '[data-line-type="change-deletion"]'
        : '';

    lineSelectors.add(`[data-line="${line.number}"]${lineType}`);
    gutterSelectors.add(`[data-column-number="${line.number}"]${lineType}`);
  }

  const selectors = [...lineSelectors, ...gutterSelectors].join(',\n');

  return `
    ${selectors} {
      background-color: light-dark(rgb(214 159 34 / 0.24), rgb(235 182 60 / 0.2)) !important;
    }
  `;
}

export function ReviewFile({
  file,
  preparedDiffs,
  diffOptions,
  lineCollaboration,
  agentNotes,
  guideNotes = NO_GUIDE_NOTES,
  guideFile,
  guideLine,
  guideSide,
  guideEndLine,
  hiddenAgentNoteIds,
  onSetAgentNoteHidden,
  typeDefinitionPaths,
  typeDefinitionInteraction,
  isCollapsed,
  searchHighlightsByChunk,
  onToggleCollapsed
}: {
  file: VisibleReviewFile;
  preparedDiffs: ReadonlyMap<string, PreparedReviewDiff>;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  lineCollaboration?: ReviewLineCollaboration;
  agentNotes: readonly GitAgentNote[];
  guideNotes?: readonly ReviewInlineGuideNote[];
  guideFile?: GitReviewGuideFile;
  guideLine?: number;
  guideSide?: 'left' | 'right';
  guideEndLine?: number;
  hiddenAgentNoteIds: ReadonlySet<string>;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
  typeDefinitionPaths: ReadonlySet<string>;
  typeDefinitionInteraction: ReviewTypeDefinitionInteraction;
  isCollapsed: boolean;
  searchHighlightsByChunk?: ReadonlyMap<string, readonly ReviewSearchLine[]>;
  onToggleCollapsed: () => void;
}): ReactElement {
  const firstChunk = file.chunks[0]!;
  const { directory, basename } = splitPath(firstChunk.path);
  const fileComposerId = useId();

  return (
    <section
      className="review-file"
      data-collapsed={isCollapsed}
      data-review-path={firstChunk.path}
    >
      <div className="review-file-header">
        <ReviewFilePathContextMenu path={firstChunk.path}>
          <button
            className="review-chunk-toggle"
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${firstChunk.path}`}
            onClick={onToggleCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight size={14} className="shrink-0 text-[var(--text-3)]" />
            ) : (
              <ChevronDown size={14} className="shrink-0 text-[var(--text-3)]" />
            )}
            <FileCode2 size={14} className="shrink-0 text-[var(--accent-2)]" />
            <span className="review-file-path" title={firstChunk.path}>
              {directory ? <span className="review-file-directory">{directory}</span> : null}
              <span className="review-file-basename">{basename}</span>
            </span>
            {guideFile ? <ReviewGuidePriority priority={guideFile.priority} reason={guideFile.reason} /> : null}
            <span className="badge-mini" title={firstChunk.relationship}>{REVIEW_ROLE_LABELS[firstChunk.role] ?? firstChunk.role}</span>
            {firstChunk.source !== 'commit' ? <span className="badge-mini">{firstChunk.source}</span> : null}
            <span className="text-[var(--success-text)]">+{file.additions}</span>
            <span className="text-[var(--danger-text)]">-{file.deletions}</span>
          </button>
        </ReviewFilePathContextMenu>
        {lineCollaboration ? (
          <ReviewFileCommentButton collaboration={lineCollaboration} chunk={firstChunk} composerId={fileComposerId}
            onOpen={isCollapsed ? onToggleCollapsed : undefined} />
        ) : null}
      </div>
      {!isCollapsed ? (
        <ReviewFileBody
          file={file}
          composerId={fileComposerId}
          preparedDiffs={preparedDiffs}
          diffOptions={diffOptions}
          lineCollaboration={lineCollaboration}
          agentNotes={agentNotes}
          guideNotes={guideNotes}
          tint={guideLine ? { line: guideLine, endLine: guideEndLine, side: guideSide } : undefined}
          hiddenAgentNoteIds={hiddenAgentNoteIds}
          onSetAgentNoteHidden={onSetAgentNoteHidden}
          typeDefinitionPaths={typeDefinitionPaths}
          typeDefinitionInteraction={typeDefinitionInteraction}
          searchHighlightsByChunk={searchHighlightsByChunk}
        />
      ) : null}
    </section>
  );
}

/** `landing` is set for a moment after a jump (its id): the lines flash once, then the tint rests. */
export type ReviewLineRangeTint = { line: number; endLine?: number; side?: 'left' | 'right'; landing?: number };

// The flash repaints each matched cell, so long ranges only get the resting tint.
const LANDING_FLASH_MAX_LINES = 40;

/**
 * Tints a requested line range on either side, context rows included (old side uses the alternate number).
 * Right after a jump (`landing`) the tint starts brighter and settles, so the eye finds the lines. The
 * flash is an inset shadow because the tint itself is `!important`, which an animation cannot override.
 */
export function createReviewRangeTintCSS({ line, endLine, side = 'right', landing }: ReviewLineRangeTint): string {
  const context = ':is([data-line-type="context"], [data-line-type="context-expanded"])';
  const selectors: string[] = [];
  for (let index = 0; index < Math.min((endLine ?? line) - line + 1, 1000); index += 1) {
    const number = line + index;
    for (const attribute of ['data-line', 'data-column-number']) {
      if (side === 'left') {
        selectors.push(`[${attribute}="${number}"][data-line-type="change-deletion"]`, `[data-alt-line="${number}"]${context}`);
      } else {
        selectors.push(`[${attribute}="${number}"]:is([data-line-type="change-addition"], [data-line-type="context"], [data-line-type="context-expanded"])`);
      }
    }
  }
  if (!selectors.length) return '';
  const lines = [...new Set(selectors)].join(',');
  const tint = `${lines} { background-color: color-mix(in srgb, var(--accent-2) 14%, transparent) !important; }`;
  if (landing === undefined || (endLine ?? line) - line + 1 >= LANDING_FLASH_MAX_LINES) return tint;
  // The jump's id is in the animation name, so jumping to the same lines again plays it again.
  return `${tint}
@media (prefers-reduced-motion: no-preference) { ${lines} { animation: review-range-land-${landing} 380ms ${EASE_OUT}; } }
@keyframes review-range-land-${landing} { from { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--accent-2) 24%, transparent); } }`;
}

export function ReviewFileCommentButton({ collaboration, chunk, composerId, disabled = false, onOpen }: {
  collaboration: ReviewLineCollaboration;
  chunk: GitReviewChunk;
  composerId: string;
  disabled?: boolean;
  onOpen?: () => void;
}): ReactElement {
  const isOpen = collaboration.selectedChunkId === chunk.id && collaboration.selectedSubject === 'file';
  return (
    <button
      className="review-comment-action review-file-comment-action"
      type="button"
      data-active={isOpen}
      aria-controls={composerId}
      aria-expanded={isOpen}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        if (isOpen) {
          collaboration.onCancel();
          return;
        }
        onOpen?.();
        collaboration.onSelectFile(chunk.id, chunk.path);
      }}
    >
      <MessageSquare size={12} aria-hidden="true" />
      Comment on file
    </button>
  );
}

/** File-level threads and composer, then the file's hunks. */
export function ReviewFileBody({
  file,
  composerId,
  preparedDiffs,
  diffOptions,
  lineCollaboration,
  agentNotes,
  guideNotes = NO_GUIDE_NOTES,
  tint,
  hiddenAgentNoteIds,
  onSetAgentNoteHidden,
  typeDefinitionPaths,
  typeDefinitionInteraction,
  searchHighlightsByChunk,
  isChunkMounted,
  renderChunkPlaceholder
}: {
  file: Pick<VisibleReviewFile, 'chunks'>;
  composerId: string;
  /** Lazy hunks (pull-request layout): an unmounted hunk renders its placeholder instead. */
  isChunkMounted?: (chunk: GitReviewChunk) => boolean;
  renderChunkPlaceholder?: (chunk: GitReviewChunk) => ReactNode;
  preparedDiffs: ReadonlyMap<string, PreparedReviewDiff>;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  lineCollaboration?: ReviewLineCollaboration;
  agentNotes: readonly GitAgentNote[];
  guideNotes?: readonly ReviewInlineGuideNote[];
  tint?: ReviewLineRangeTint;
  hiddenAgentNoteIds: ReadonlySet<string>;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
  typeDefinitionPaths: ReadonlySet<string>;
  typeDefinitionInteraction: ReviewTypeDefinitionInteraction;
  searchHighlightsByChunk?: ReadonlyMap<string, readonly ReviewSearchLine[]>;
}): ReactElement {
  const tintCSS = tint ? createReviewRangeTintCSS(tint) : '';
  const tintedDiffOptions = useMemo(() => tintCSS
    ? { ...diffOptions, unsafeCSS: `${diffOptions.unsafeCSS ?? ''}\n${tintCSS}` }
    : diffOptions, [diffOptions, tintCSS]);
  const firstChunk = file.chunks[0]!;
  const fileThreads = lineCollaboration?.threads.filter(
    (thread) => thread.subjectType === 'file' && thread.path === firstChunk.path
  ) ?? [];
  const isFileComposerOpen =
    lineCollaboration?.selectedChunkId === firstChunk.id &&
    lineCollaboration.selectedSubject === 'file';

  return (
    <>
      {fileThreads.length > 0 || isFileComposerOpen ? (
        <div className="review-file-comments">
          {fileThreads.map((thread) => (
            <ReviewCommentAnnotation
              key={thread.id}
              thread={thread}
              onAddDraftReply={lineCollaboration?.onAddDraftReply}
              onUpdateComment={lineCollaboration?.onUpdateComment}
              onUpdateDraftComment={lineCollaboration?.onUpdateDraftComment}
              onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
            />
          ))}
          {isFileComposerOpen && lineCollaboration ? (
            <div id={composerId}>
              <ReviewInlineComposer collaboration={lineCollaboration} />
            </div>
          ) : null}
        </div>
      ) : null}
      {file.chunks.map((chunk, chunkIndex) => isChunkMounted && renderChunkPlaceholder && !isChunkMounted(chunk) ? (
        <Fragment key={chunk.id}>{renderChunkPlaceholder(chunk)}</Fragment>
      ) : (
        <ReviewChunk
          key={chunk.id}
          chunk={chunk}
          preparedDiff={preparedDiffs.get(chunk.id)}
          diffOptions={tintedDiffOptions}
          lineCollaboration={lineCollaboration}
          agentNotes={agentNotes}
          guideNotes={guideNotes}
          hiddenAgentNoteIds={hiddenAgentNoteIds}
          onSetAgentNoteHidden={onSetAgentNoteHidden}
          typeDefinitionInteraction={
            typeDefinitionPaths.has(chunk.path) ? typeDefinitionInteraction : undefined
          }
          hideLeadingExpansion={shareReviewExpansionBoundary(
            chunkIndex > 0
              ? preparedDiffs.get(file.chunks[chunkIndex - 1]!.id)?.expandable
              : undefined,
            preparedDiffs.get(chunk.id)?.expandable
          )}
          searchHighlights={searchHighlightsByChunk?.get(chunk.id)}
        />
      ))}
    </>
  );
}

export function ReviewChunk({
  chunk,
  preparedDiff,
  diffOptions,
  lineCollaboration,
  agentNotes,
  guideNotes = NO_GUIDE_NOTES,
  hiddenAgentNoteIds,
  onSetAgentNoteHidden,
  typeDefinitionInteraction,
  hideLeadingExpansion = false,
  searchHighlights
}: {
  chunk: GitReviewChunk;
  preparedDiff?: PreparedReviewDiff;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  lineCollaboration?: ReviewLineCollaboration;
  agentNotes: readonly GitAgentNote[];
  guideNotes?: readonly ReviewInlineGuideNote[];
  hiddenAgentNoteIds: ReadonlySet<string>;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
  typeDefinitionInteraction?: ReviewTypeDefinitionInteraction;
  hideLeadingExpansion?: boolean;
  searchHighlights?: readonly ReviewSearchLine[];
}): ReactElement {
  const isComposing = lineCollaboration?.selectedChunkId === chunk.id;
  const [displayedDiff, setDisplayedDiff] = useState(preparedDiff);

  // Keep the renderer and its annotation nodes stable while someone is typing.
  if (!isComposing && displayedDiff !== preparedDiff) {
    setDisplayedDiff(preparedDiff);
  }

  const expandableDiff = displayedDiff?.expandable;
  const contextualDiffOptions = useMemo<FileDiffOptions<ReviewDiffAnnotation>>(
    () => {
      const options = expandableDiff
        ? createReviewContextOptions(
            diffOptions,
            expandableDiff,
            chunk.path,
            hideLeadingExpansion
          )
        : diffOptions;
      const interactiveOptions = typeDefinitionInteraction
        ? {
            ...options,
            onTokenClick: (token: DiffTokenEventBaseProps, event: MouseEvent) =>
              typeDefinitionInteraction.onClick(chunk, token, event),
            onTokenEnter: (token: DiffTokenEventBaseProps, event: PointerEvent) =>
              typeDefinitionInteraction.onEnter(chunk, token, event),
            onTokenLeave: (token: DiffTokenEventBaseProps) =>
              typeDefinitionInteraction.onLeave(token),
            unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_TYPE_DEFINITION_HOVER_CSS}`
          }
        : options;
      const highlightCSS = createReviewSearchHighlightCSS(searchHighlights);

      return highlightCSS
        ? {
            ...interactiveOptions,
            unsafeCSS: `${interactiveOptions.unsafeCSS ?? ''}\n${highlightCSS}`
          }
        : interactiveOptions;
    },
    [
      chunk,
      diffOptions,
      expandableDiff,
      hideLeadingExpansion,
      typeDefinitionInteraction,
      searchHighlights
    ]
  );
  const selectedLines =
    lineCollaboration?.selectedChunkId === chunk.id &&
    lineCollaboration.selectedSubject === 'line'
      ? lineCollaboration.selectedLines
      : null;
  const normalizedSelection = normalizeReviewLineSelection(selectedLines);
  const lineAnnotations = useMemo<DiffLineAnnotation<ReviewDiffAnnotation>[]>(
    () => [
      ...(lineCollaboration?.threads.flatMap((thread) =>
        thread.subjectType === 'line' &&
        thread.path === chunk.path &&
        thread.line &&
        thread.side &&
        patchContainsLine(chunk.patch, thread.line, thread.side)
          ? [{
              lineNumber: thread.line,
              side: thread.side === 'right' ? 'additions' as const : 'deletions' as const,
              metadata: { kind: 'thread' as const, thread }
            }]
          : []
      ) ?? []),
      ...guideNotes.flatMap((note) =>
        note.path === chunk.path && patchContainsLine(chunk.patch, note.line, note.side ?? 'right')
          ? [{
              lineNumber: note.line,
              side: note.side === 'left' ? 'deletions' as const : 'additions' as const,
              metadata: { kind: 'guide-note' as const, note }
            }]
          : []
      ),
      ...agentNotes.flatMap((note) =>
        note.path === chunk.path && patchContainsLine(chunk.patch, note.line, 'right')
          ? [{
              lineNumber: note.line,
              side: 'additions' as const,
              metadata: {
                kind: 'agent-note' as const,
                note,
                hidden: hiddenAgentNoteIds.has(note.id)
              }
            }]
          : []
      ),
      ...(normalizedSelection
        ? [{
            lineNumber: normalizedSelection.line,
            side: normalizedSelection.side === 'right' ? 'additions' as const : 'deletions' as const,
            metadata: { kind: 'composer' as const }
          }]
        : [])
    ],
    [
      agentNotes,
      guideNotes,
      chunk.patch,
      chunk.path,
      hiddenAgentNoteIds,
      lineCollaboration?.threads,
      normalizedSelection
    ]
  );
  const interactiveDiffOptions: FileDiffOptions<ReviewDiffAnnotation> = lineCollaboration
    ? createReviewLineSelectionOptions(
        contextualDiffOptions,
        (range) => lineCollaboration.onSelectLines(chunk.id, chunk.path, range),
        lineCollaboration.selectedChunkId !== undefined
      )
    : contextualDiffOptions;

  const renderCommentUtility: DiffBasePropsReact<ReviewDiffAnnotation>['renderGutterUtility'] =
    lineCollaboration && lineCollaboration.selectedChunkId === undefined
      ? (getHoveredLine) => (
          <button className="review-gutter-comment" type="button"
            aria-label={`Comment on line in ${chunk.path}`} title="Comment on line"
            onClick={() => {
              const line = getHoveredLine();
              if (line) lineCollaboration.onSelectLines(chunk.id, chunk.path, {
                start: line.lineNumber, end: line.lineNumber, side: line.side
              });
            }}>
            <Plus size={14} aria-hidden="true" />
          </button>
        )
      : undefined;

  return (
    <section className="review-chunk" data-review-chunk-id={chunk.id}
      data-context-ready={preparedDiff?.expandable !== undefined}
      data-context-renderer={displayedDiff?.expandable ? 'full' : 'patch'}>
      {chunk.omittedReason ? (
        <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--text-3)]">
          {chunk.omittedReason === 'binary'
            ? 'Binary changes cannot be previewed.'
            : chunk.omittedReason === 'too-large'
              ? 'This change exceeds the review preview limit.'
              : 'No textual diff is available for this change.'}
        </div>
      ) : (
        displayedDiff ? (
          <FileDiff<ReviewDiffAnnotation>
            className="gg-diff"
            fileDiff={displayedDiff.fileDiff}
            options={interactiveDiffOptions}
            renderGutterUtility={renderCommentUtility}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={(annotation) => (
              annotation.metadata.kind === 'composer' && lineCollaboration
                ? <ReviewInlineComposer collaboration={lineCollaboration} />
                : annotation.metadata.kind === 'thread'
                  ? <ReviewCommentAnnotation
                      thread={annotation.metadata.thread}
                      onAddDraftReply={lineCollaboration?.onAddDraftReply}
                      onUpdateComment={lineCollaboration?.onUpdateComment}
                      onUpdateDraftComment={lineCollaboration?.onUpdateDraftComment}
                      onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
                    />
                  : annotation.metadata.kind === 'guide-note'
                    ? <ReviewGuideInlineNote note={annotation.metadata.note} />
                  : annotation.metadata.kind === 'agent-note'
                    ? <ReviewAgentNoteAnnotation
                        note={annotation.metadata.note}
                        hidden={annotation.metadata.hidden}
                        onSetAgentNoteHidden={onSetAgentNoteHidden}
                      />
                    : null
            )}
          />
        ) : (
          <PatchDiff<ReviewDiffAnnotation>
            className="gg-diff"
            patch={chunk.patch}
            options={interactiveDiffOptions}
            renderGutterUtility={renderCommentUtility}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={(annotation) => (
              annotation.metadata.kind === 'composer' && lineCollaboration
                ? <ReviewInlineComposer collaboration={lineCollaboration} />
                : annotation.metadata.kind === 'thread'
                  ? <ReviewCommentAnnotation
                      thread={annotation.metadata.thread}
                      onAddDraftReply={lineCollaboration?.onAddDraftReply}
                      onUpdateComment={lineCollaboration?.onUpdateComment}
                      onUpdateDraftComment={lineCollaboration?.onUpdateDraftComment}
                      onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
                    />
                  : annotation.metadata.kind === 'guide-note'
                    ? <ReviewGuideInlineNote note={annotation.metadata.note} />
                  : annotation.metadata.kind === 'agent-note'
                    ? <ReviewAgentNoteAnnotation
                        note={annotation.metadata.note}
                        hidden={annotation.metadata.hidden}
                        onSetAgentNoteHidden={onSetAgentNoteHidden}
                      />
                    : null
            )}
          />
        )
      )}
    </section>
  );
}

export function ReviewGuideInlineNote({ note }: { note: ReviewInlineGuideNote }): ReactElement {
  const [hidden, setHidden] = useState(false);
  if (note.marker) {
    return <aside className="review-guide-inline-note" data-guide-reference data-guide-marker={note.marker} aria-label={`Tour point ${note.marker}`}>
      {note.onOpen
        ? <button type="button" className="pr-guide-marker" aria-label={`Open point ${note.marker}${note.stopLabel ? `, ${note.stopLabel}` : ''}`} onClick={note.onOpen}>{note.marker}</button>
        : <span className="pr-guide-marker" aria-hidden="true">{note.marker}</span>}
      <div>
        <strong>{note.title}</strong>
        {note.body ? <ReviewCommentBody body={note.body} compact /> : null}
      </div>
      {note.onOpen && note.stopLabel ? <button type="button" className="review-guide-reference-open" onClick={note.onOpen}>{note.stopLabel}<ArrowUpRight size={12} aria-hidden="true" /></button> : null}
    </aside>;
  }
  return <aside className="review-guide-inline-note" aria-label="AI guide note">
    <span>AI guide</span>
    {hidden ? <button type="button" onClick={() => setHidden(false)}>Show note</button> : <>
      <p>{note.body}</p>
      <button type="button" aria-label="Hide AI guide note" onClick={() => setHidden(true)}><X size={12} /></button>
    </>}
  </aside>;
}

export function AgentNoteAnnotation({
  note,
  hidden,
  onHiddenChange
}: {
  note: GitAgentNote;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
}): ReactElement {
  if (hidden) {
    return (
      <button
        className="agent-note-collapsed"
        type="button"
        aria-label={`Show Agent Note: ${note.summary}`}
        onClick={() => onHiddenChange(false)}
      >
        <Sparkles size={12} />
        <span>Agent note</span>
        <span className="agent-note-read-state">read</span>
        <span className="agent-note-spacer" />
        <span>Show</span>
        <ChevronDown size={12} />
      </button>
    );
  }

  return (
    <article className="agent-note" data-agent-note-id={note.id}>
      <header>
        <span className="agent-note-kicker">
          <Sparkles size={12} />
          Agent note
        </span>
        <span className="agent-note-author">{note.author}</span>
        <button
          className="agent-note-hide"
          type="button"
          onClick={() => onHiddenChange(true)}
        >
          <EyeOff size={12} />
          Hide note
        </button>
      </header>
      <div className="agent-note-body">
        <strong>{note.summary}</strong>
        {note.detail ? <p>{note.detail}</p> : null}
      </div>
      <footer>
        <code>{note.path}:{note.line}</code>
        <time dateTime={note.createdAt}>{formatReviewCommentDate(note.createdAt)}</time>
      </footer>
    </article>
  );
}

export function ReviewAgentNoteAnnotation({
  note,
  hidden,
  onSetAgentNoteHidden
}: {
  note: GitAgentNote;
  hidden: boolean;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
}): ReactElement {
  return (
    <AgentNoteAnnotation
      note={note}
      hidden={hidden}
      onHiddenChange={(nextHidden) => onSetAgentNoteHidden(note.id, nextHidden)}
    />
  );
}

export function ReviewInlineComposer({
  collaboration
}: {
  collaboration: ReviewLineCollaboration;
}): ReactElement {
  const [initialBody] = useState(collaboration.getBody);
  const [hasBody, setHasBody] = useState(() => Boolean(initialBody.trim()));
  useReportUnsavedText(hasBody);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const normalizedSelection = normalizeReviewLineSelection(collaboration.selectedLines);
  const canSubmitSelection = Boolean(
    collaboration.selectedSubject === 'file' ||
      (normalizedSelection && normalizedSelection.side === normalizedSelection.startSide)
  );
  const canSubmitLineComment = hasBody && canSubmitSelection;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <form
      className="review-inline-composer"
      data-subject-type={collaboration.selectedSubject}
      onSubmit={(event) => collaboration.onSubmit(event, collaboration.getBody())}
    >
      <div className="review-inline-composer-label">
        <MessageSquare size={14} />
        {collaboration.selectedSubject === 'file'
          ? `Draft comment on file ${collaboration.selectedPath}`
          : normalizedSelection
          ? `Draft comment on ${collaboration.selectedPath}:${formatReviewLineSelection(normalizedSelection)}`
          : 'Select lines from only one side of the diff to comment.'}
      </div>
      <div className="review-inline-composer-input">
        <textarea
          ref={textareaRef}
          rows={3}
          defaultValue={initialBody}
          placeholder={collaboration.selectedSubject === 'file'
            ? 'Leave a whole-file review comment…'
            : 'Leave an inline review comment…'}
          aria-label={collaboration.selectedSubject === 'file'
            ? 'File review comment'
            : 'Inline review comment'}
          onChange={(event) => {
            const nextBody = event.target.value;
            const nextHasBody = Boolean(nextBody.trim());

            collaboration.onBodyChange(nextBody);
            if (nextHasBody !== hasBody) {
              setHasBody(nextHasBody);
            }
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              canSubmitLineComment &&
              !collaboration.isSubmitting
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>
      <p className="review-inline-composer-hint">
        Saved in Git Gud only. Nothing is posted until you submit the review.
      </p>
      {collaboration.errorMessage ? (
        <p className="review-inline-comment-error">{collaboration.errorMessage}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          className="btn-subtle btn-compact"
          type="button"
          disabled={collaboration.isSubmitting}
          onClick={collaboration.onCancel}
        >
          Cancel
        </button>
        <button
          className="btn-primary btn-compact"
          type="submit"
          disabled={!canSubmitLineComment || collaboration.isSubmitting}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          title="Add to review (⌘↵)"
        >
          {collaboration.isSubmitting
            ? <Loader2 size={12} className="animate-spin" />
            : <Send size={12} />}
          Add to review
          <kbd aria-hidden="true" className="text-[11px] text-current">⌘↵</kbd>
        </button>
      </div>
    </form>
  );
}

export function ReviewCommentAnnotation({
  thread,
  onAddDraftReply,
  onUpdateComment,
  onUpdateDraftComment,
  onRemoveDraftComment
}: {
  thread: ReviewCommentThread;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onUpdateComment?: (commentId: number, body: string) => Promise<void>;
  onUpdateDraftComment?: (id: string, body: string) => void;
  onRemoveDraftComment?: (id: string) => void;
}): ReactElement {
  const articleRef = useRef<HTMLElement>(null);
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [requestedEditId, setEditingCommentId] = useState<ReviewLineComment['id']>();
  const [editBody, setEditBody] = useState('');
  const editedComment = requestedEditId === undefined ? undefined
    : [thread, ...thread.replies].find((comment) => comment.id === requestedEditId);
  // The comment can go away under an open edit (a draft posted with the review); nothing is being edited then.
  const editingCommentId = editedComment?.id;
  useReportUnsavedText(Boolean(replyBody.trim()) || (editedComment !== undefined && editBody.trim() !== editedComment.body.trim()));
  const [restoreFocusId, setRestoreFocusId] = useState<ReviewLineComment['id']>();
  const replyMutation = useMutation({
    mutationFn: async () => {
      if (
        typeof thread.id !== 'number' ||
        !onAddDraftReply ||
        !replyBody.trim()
      ) {
        throw new Error('Replies are unavailable for this comment.');
      }
      await onAddDraftReply({
        body: replyBody.trim(),
        inReplyToId: thread.id
      });
    },
    onSuccess: () => {
      setReplyBody('');
      setIsReplying(false);
    }
  });
  const canReply =
    !thread.isDraft &&
    typeof thread.id === 'number' &&
    Boolean(onAddDraftReply);
  const editMutation = useMutation({
    mutationFn: async ({ commentId, body }: { commentId: ReviewLineComment['id']; body: string }) => {
      if (!body.trim()) {
        throw new Error('Editing is unavailable for this comment.');
      }
      if (typeof commentId === 'string' && onUpdateDraftComment) {
        onUpdateDraftComment(commentId, body.trim());
      } else if (typeof commentId === 'number' && onUpdateComment) {
        await onUpdateComment(commentId, body.trim());
      } else {
        throw new Error('Editing is unavailable for this comment.');
      }
    },
    onSuccess: (_result, { commentId }) => {
      setRestoreFocusId(commentId);
      setEditingCommentId(undefined);
      setEditBody('');
    }
  });

  useEffect(() => {
    if (editingCommentId !== undefined || restoreFocusId === undefined) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      articleRef.current
        ?.querySelector<HTMLButtonElement>(`[data-edit-comment-id="${restoreFocusId}"]`)
        ?.focus();
      setRestoreFocusId(undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingCommentId, restoreFocusId]);

  function startEditing(comment: ReviewLineComment): void {
    if (
      editMutation.isPending ||
      replyMutation.isPending
    ) {
      return;
    }
    setIsReplying(false);
    setReplyBody('');
    replyMutation.reset();
    setEditingCommentId(comment.id);
    setEditBody(comment.body);
    editMutation.reset();
  }

  function submitEditing(): void {
    if (editingCommentId !== undefined) {
      editMutation.mutate({ commentId: editingCommentId, body: editBody });
    }
  }

  function cancelEditing(): void {
    setRestoreFocusId(editingCommentId);
    setEditingCommentId(undefined);
    setEditBody('');
    editMutation.reset();
  }

  return (
    <article
      ref={articleRef}
      data-review-comment-id={thread.id}
      // Focusable from script so an Overview issue can land on its thread.
      tabIndex={-1}
      className="review-line-comment"
      data-draft={thread.isDraft}
      data-subject-type={thread.subjectType}
    >
      <header>
        <ReviewCommentAvatar comment={thread} />
        <strong>{thread.author}</strong>
        {thread.isDraft ? (
          <span className="review-line-comment-draft">
            <Clock3 size={10} />
            Draft
          </span>
        ) : null}
        <time dateTime={thread.createdAt}>{formatReviewCommentDate(thread.createdAt)}</time>
      </header>
      {editingCommentId === thread.id ? (
        <ReviewCommentEditForm
          author={thread.author}
          body={editBody}
          errorMessage={editMutation.error instanceof Error ? editMutation.error.message : undefined}
          isSaving={editMutation.isPending}
          onBodyChange={setEditBody}
          onCancel={cancelEditing}
          onSubmit={submitEditing}
        />
      ) : (
        <ReviewCommentBody body={thread.body} />
      )}
      {thread.replies.length > 0 ? (
        <div className="review-line-comment-replies">
          {thread.replies.map((reply) => (
            <div className="review-line-comment-reply" data-draft={reply.isDraft} key={reply.id}>
              <div className="review-line-comment-reply-meta">
                <ReviewCommentAvatar comment={reply} />
                <strong>{reply.author}</strong>
                {reply.isDraft ? (
                  <span className="review-line-comment-draft">
                    <Clock3 size={10} />
                    Draft
                  </span>
                ) : (
                  <time dateTime={reply.createdAt}>{formatReviewCommentDate(reply.createdAt)}</time>
                )}
                {reply.isDraft && onRemoveDraftComment ? (
                  <button
                    className="review-comment-action review-comment-icon-action review-comment-action--danger"
                    type="button"
                    onClick={() => onRemoveDraftComment(String(reply.id))}
                    aria-label="Remove draft reply"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
                {(reply.isDraft ? onUpdateDraftComment : reply.canEdit && onUpdateComment) && editingCommentId !== reply.id ? (
                  <button
                    className="review-comment-action"
                    type="button"
                    data-edit-comment-id={reply.id}
                    disabled={editingCommentId !== undefined || isReplying || editMutation.isPending}
                    onClick={() => startEditing(reply)}
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                ) : null}
              </div>
              {editingCommentId === reply.id ? (
                <ReviewCommentEditForm
                  author={reply.author}
                  body={editBody}
                  errorMessage={editMutation.error instanceof Error ? editMutation.error.message : undefined}
                  isSaving={editMutation.isPending}
                  onBodyChange={setEditBody}
                  onCancel={cancelEditing}
                  onSubmit={submitEditing}
                  compact
                />
              ) : (
                <ReviewCommentBody body={reply.body} compact />
              )}
            </div>
          ))}
        </div>
      ) : null}
      <footer className="review-line-comment-actions">
        {thread.isDraft && onRemoveDraftComment ? (
          <button
            className="review-comment-action review-comment-action--danger"
            type="button"
            onClick={() => onRemoveDraftComment(String(thread.id))}
          >
            <Trash2 size={12} />
            Remove draft
          </button>
        ) : null}
        {(thread.isDraft ? onUpdateDraftComment : thread.canEdit && onUpdateComment) && editingCommentId !== thread.id ? (
          <button
            className="review-comment-action"
            type="button"
            data-edit-comment-id={thread.id}
            disabled={editingCommentId !== undefined || isReplying || editMutation.isPending}
            onClick={() => startEditing(thread)}
          >
            <Pencil size={12} />
            Edit
          </button>
        ) : null}
        {canReply ? (
          <button
            className="review-comment-action"
            type="button"
            disabled={replyMutation.isPending || editMutation.isPending || editingCommentId !== undefined}
            aria-expanded={isReplying}
            onClick={() => setIsReplying((current) => !current)}
          >
            <Reply size={12} />
            Reply
          </button>
        ) : null}
      </footer>
      {isReplying ? (
        <form
          className="review-line-comment-reply-form"
          onSubmit={(event) => {
            event.preventDefault();
            replyMutation.mutate();
          }}
        >
          <textarea
            rows={3}
            value={replyBody}
            placeholder={`Reply to ${thread.author}…`}
            aria-label={`Reply to ${thread.author}`}
            disabled={replyMutation.isPending}
            onChange={(event) => setReplyBody(event.target.value)}
          />
          <p>Saved as a draft until you submit the review.</p>
          {replyMutation.error instanceof Error ? (
            <span>{replyMutation.error.message}</span>
          ) : null}
          <div>
            <button
              className="btn-subtle btn-compact"
              type="button"
              disabled={replyMutation.isPending}
              onClick={() => {
                setIsReplying(false);
                setReplyBody('');
                replyMutation.reset();
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary btn-compact"
              type="submit"
              disabled={!replyBody.trim() || replyMutation.isPending}
            >
              {replyMutation.isPending
                ? <Loader2 size={12} className="animate-spin" />
                : <Reply size={12} />}
              Add reply
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

export function ReviewCommentEditForm({
  author,
  body,
  errorMessage,
  isSaving,
  onBodyChange,
  onCancel,
  onSubmit,
  compact = false
}: {
  author: string;
  body: string;
  errorMessage?: string;
  isSaving: boolean;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  compact?: boolean;
}): ReactElement {
  return (
    <form
      className="review-comment-edit-form"
      data-compact={compact}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        autoFocus
        rows={3}
        value={body}
        aria-label={`Edit ${author}'s review comment`}
        // Continue typing after the existing text, not before it.
        onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
        disabled={isSaving}
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            body.trim() &&
            !isSaving
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {errorMessage ? <span>{errorMessage}</span> : null}
      <div>
        <button className="btn-subtle btn-compact" type="button" disabled={isSaving} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary btn-compact" type="submit" disabled={!body.trim() || isSaving}>
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Save comment
        </button>
      </div>
    </form>
  );
}

export function ReviewCommentAvatar({
  comment
}: {
  comment: ReviewLineComment;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);

  return comment.authorAvatarUrl && !didAvatarFail ? (
    <img
      className="review-line-comment-avatar"
      src={comment.authorAvatarUrl}
      alt=""
      aria-hidden="true"
      onError={() => setDidAvatarFail(true)}
    />
  ) : (
    <span className="review-line-comment-avatar" aria-hidden="true">
      {comment.author.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function formatReviewLineSelection(
  selection: ReturnType<typeof normalizeReviewLineSelection>
): string {
  if (!selection) {
    return '';
  }
  return selection.startLine
    ? `${selection.startLine}-${selection.line}`
    : String(selection.line);
}

export function patchContainsLine(
  patch: string,
  targetLine: number,
  side: 'left' | 'right'
): boolean {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      if (side === 'right' && newLine === targetLine) {
        return true;
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      if (side === 'left' && oldLine === targetLine) {
        return true;
      }
      oldLine += 1;
      continue;
    }
    if (
      (side === 'left' && oldLine === targetLine) ||
      (side === 'right' && newLine === targetLine)
    ) {
      return true;
    }
    oldLine += 1;
    newLine += 1;
  }

  return false;
}

export function formatReviewCommentDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export const REVIEW_ROLE_LABELS: Record<string, string> = { anchor: 'Changed here', usage: 'Uses it', related: 'Related' };
