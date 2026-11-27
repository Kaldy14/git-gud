import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleDotDashed, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import type { CodeReference } from '@shared/codeReference';
import type { PullRequestTourAttentionKind, PullRequestTourPoint, PullRequestTourStop } from '@shared/pullRequestTour';
import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import { drawStroke, EASE_OUT, prefersReducedMotion } from '@renderer/lib/motion';
import type { ReviewScopeFileSummary } from '@renderer/components/review/ReviewView';

import { InlineCodeText } from '../overview/overviewParts';
import { PullRequestRiskChip } from '../PullRequestRiskChip';
import { isAnchoredPoint } from './pullRequestTourWalk';
import { TourFlow } from './TourFlow';
import { tourPointPosition, type TourFileStat } from './tourVisuals';
import { listTourSteps, plainTourText } from './tourText';

// The call's eyebrow above its one sentence.
const ATTENTION_LABELS: Record<PullRequestTourAttentionKind, string> = {
  tradeoff: 'Tradeoff to weigh',
  contract: 'Contract to check',
  product: 'Product call',
  risk: 'Risk to judge',
  accessibility: 'Accessibility call'
};

export type TourProse = {
  resolve: (reference: CodeReference) => CodeReference | undefined;
  open: (reference: CodeReference) => void;
};

export type TourFinishCheck = { unreviewed: number[] };

/**
 * The Tour's left panel, made to be scanned rather than read: risk, title, before/now, the one call to make,
 * the step's footprint (its files as bars with its points placed on them) and one headline per point, over a
 * pinned foot with the step's terminal action. Each point's sentence is beside its lines in the diff.
 * Collapsed, the panel is a slim strip that still shows the step and keeps the action in reach.
 */
export function TourStepPanel({
  stop,
  step,
  count,
  reviewed,
  activePoint,
  takePointReveal,
  files,
  stats,
  banner,
  riskMuted,
  prose,
  collapsed,
  finishCheck,
  headingRef,
  onToggleCollapsed,
  onSelectPoint,
  onOpenFile,
  onAdvance,
  onToggleReviewed,
  onFinishAnyway,
  onGo
}: {
  stop: PullRequestTourStop;
  step: number;
  count: number;
  reviewed: boolean;
  activePoint: number | null;
  // True once after the diff selected the point, so the list scrolls to it.
  takePointReveal: () => boolean;
  files: readonly ReviewScopeFileSummary[];
  stats: ReadonlyMap<string, TourFileStat>;
  banner?: ReactNode;
  // The tour was written before the latest push.
  riskMuted: boolean;
  prose: TourProse;
  collapsed: boolean;
  finishCheck?: TourFinishCheck;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onToggleCollapsed: () => void;
  onSelectPoint: (point: number) => void;
  onOpenFile: (path: string) => void;
  // Reviewed & next, or Finish review on the last step.
  onAdvance: () => void;
  onToggleReviewed: () => void;
  onFinishAnyway: () => void;
  onGo: (step: number) => void;
}): ReactElement {
  const isLast = step === count - 1;
  const title = plainTourText(stop.title);
  const pointsRef = useRef<HTMLOListElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A new step starts reading from the top, and arrives from the side it was reached from (next from the
  // right, previous from the left). Before paint, so the new step is never shown at rest first.
  const shown = useRef({ step, reviewed });
  const stepRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const from = shown.current.step;
    bodyRef.current?.scrollTo({ top: 0 });
    const content = stepRef.current;
    if (!content || from === step || prefersReducedMotion()) return;
    const entrance = content.animate(
      [{ opacity: 0, transform: `translateX(${step > from ? 12 : -12}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: EASE_OUT }
    );
    // A quick second step replaces the first's motion instead of stacking on it. The diff beside it
    // changes at once: the landing highlight on the step's first point says where to look.
    return () => entrance.cancel();
  }, [step]);
  // Marking this step reviewed draws its check (before paint, so it never shows complete first); arriving
  // on a step that already was does not.
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { step, reviewed };
    if (reviewed && !before.reviewed && before.step === step) drawStroke(stepRef.current?.querySelector('.pr-tour-reviewed > svg'));
  }, [step, reviewed]);
  // Keep the selected point in view when the diff moved the selection from one point to another. The first
  // selection on a step (landing, or the diff settling after a step change) leaves the step read from the top.
  const previousPointRef = useRef(activePoint);
  useEffect(() => {
    const previous = previousPointRef.current;
    previousPointRef.current = activePoint;
    const reveal = takePointReveal();
    if (activePoint === null || previous === null || !reveal) return;
    pointsRef.current?.children[activePoint]?.scrollIntoView({ block: 'nearest' });
  }, [activePoint, takePointReveal]);

  const action = isLast ? 'Finish review' : reviewed ? 'Mark unreviewed' : 'Reviewed & next';
  const actionButton = (iconOnly: boolean) => (
    <button
      type="button"
      className={`${isLast || !reviewed ? 'btn-primary' : 'btn-subtle'} btn-regular pr-tour-action`}
      aria-keyshortcuts={isLast || !reviewed ? 'R' : undefined}
      aria-label={iconOnly ? action : undefined}
      title={isLast || !reviewed ? `${action} (R)` : action}
      onClick={isLast || !reviewed ? onAdvance : onToggleReviewed}
    >
      <Check size={14} aria-hidden="true" />
      {iconOnly ? null : action}
    </button>
  );

  if (collapsed) {
    return (
      <div className="pr-tour-panel" data-collapsed="">
        <button type="button" className="icon-btn icon-btn-compact" aria-label="Show the step" title="Show the step"
          aria-expanded={false} onClick={onToggleCollapsed}>
          <PanelLeftOpen size={14} aria-hidden="true" />
        </button>
        <span className="pr-tour-strip-step" aria-hidden="true">{step + 1}/{count}</span>
        <h2 ref={headingRef} tabIndex={-1} className="pr-tour-strip-title" title={title}>
          <span className="sr-only">Step {step + 1} of {count}: </span>{title}
        </h2>
        <span className="pr-tour-strip-foot">
          {reviewed && !isLast ? (
            <button type="button" className="btn-primary btn-regular pr-tour-action" aria-label="Next step" title="Next step (→)" onClick={() => onGo(step + 1)}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : actionButton(true)}
        </span>
      </div>
    );
  }

  return (
    <div className="pr-tour-panel">
      <div ref={bodyRef} className="pr-tour-panel-body">
        <div ref={stepRef} className="pr-tour-panel-step">
        {banner}
        <header className="pr-tour-step-head">
          <div className="pr-tour-step-eyebrow">
            {stop.risk ? <PullRequestRiskChip risk={stop.risk} muted={riskMuted} /> : null}
            {stop.kind === 'mechanical' ? <span className="pr-tour-kind">Mechanical</span> : null}
            {reviewed ? <span className="pr-tour-reviewed"><Check size={12} aria-hidden="true" />Reviewed</span> : null}
            <button type="button" className="icon-btn icon-btn-compact pr-tour-collapse" aria-label="Hide the step panel"
              title="Hide the step panel" aria-expanded onClick={onToggleCollapsed}>
              <PanelLeftClose size={14} aria-hidden="true" />
            </button>
          </div>
          <h2 ref={headingRef} id="pr-tour-step-heading" tabIndex={-1} className="pr-tour-step-title">
            <span className="sr-only">Step {step + 1} of {count}: </span>{title}
          </h2>
        </header>

        {stop.change ? (
          <>
            <dl className="pr-tour-change pr-tour-inline">
              <dt className="pr-tour-eyebrow" data-side="before">Before</dt>
              <dd data-side="before"><InlineCodeText text={stop.change.before} /></dd>
              <dt className="pr-tour-eyebrow" data-side="after">Now</dt>
              <dd data-side="after"><InlineCodeText text={stop.change.after} /></dd>
            </dl>
            {stop.summary ? (
              <details className="pr-tour-why">
                <summary>Why it matters<ChevronRight size={12} aria-hidden="true" /></summary>
                <TourText body={stop.summary} prose={prose} className="pr-tour-summary" />
              </details>
            ) : null}
          </>
        ) : stop.summary ? <TourText body={stop.summary} prose={prose} className="pr-tour-summary" /> : null}

        {stop.attention ? (
          <div className="pr-tour-attention pr-tour-inline">
            <span className="pr-tour-eyebrow">{ATTENTION_LABELS[stop.attention.kind]}</span>
            <span><InlineCodeText text={stop.attention.note} /></span>
          </div>
        ) : null}

        {stop.flow ? (
          <TourFlow flow={stop.flow} points={stop.points} inDiff={(path) => stats.has(path)} activePoint={activePoint}
            onSelectPoint={onSelectPoint} onOpenFile={onOpenFile} />
        ) : null}

        <TourFootprint stop={stop} files={files} stats={stats} activePoint={activePoint} onSelectPoint={onSelectPoint} onOpenFile={onOpenFile} />

        {stop.points.length ? (
          <ol ref={pointsRef} className="pr-tour-points" aria-label="Points">
            {stop.points.map((point, index) => {
              const anchored = isAnchoredPoint(point);
              const where = `${point.path}${anchored ? `:${lineRange(point)}` : ''}`;
              return (
                <li key={index} className="pr-tour-point pr-tour-inline" data-active={activePoint === index || undefined}>
                  {anchored ? (
                    <button type="button" className="pr-tour-point-button" aria-pressed={activePoint === index}
                      aria-label={`Point ${index + 1}: ${plainTourText(point.label)}. Show ${where} in the diff`}
                      title={`${plainTourText(point.body)}\n${where}`} onClick={() => onSelectPoint(index)}>
                      <span className="pr-guide-marker pr-tour-point-key" aria-hidden="true">{index + 1}</span>
                      <span><InlineCodeText text={point.label} /></span>
                      <span className="pr-tour-point-lines" aria-hidden="true">{lineRange(point)}</span>
                    </button>
                  ) : (
                    // Not placed on a line, so the diff has no mark: the sentence stays here.
                    <div className="pr-tour-point-text">
                      <span className="pr-tour-point-key" data-text-only="" title="Not placed on a line">{index + 1}</span>
                      <div>
                        <strong><InlineCodeText text={point.label} /></strong>
                        <TourText body={point.body} prose={prose} />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : null}
        </div>
      </div>

      <footer className="pr-tour-foot">
        {finishCheck ? (
          <div className="pr-tour-finish-check" role="alert">
            <p><AlertTriangle size={14} aria-hidden="true" />{listTourSteps(finishCheck.unreviewed)} {finishCheck.unreviewed.length === 1 ? 'is' : 'are'} not reviewed yet.</p>
            <div>
              <button type="button" className="btn-subtle btn-compact" onClick={() => onGo(finishCheck.unreviewed[0]!)}>
                Go to step {finishCheck.unreviewed[0]! + 1}
              </button>
              <button type="button" className="btn-primary btn-compact" onClick={onFinishAnyway}>Finish anyway</button>
            </div>
          </div>
        ) : null}
        <div className="pr-tour-foot-actions">
          {reviewed ? (
            <button type="button" className="btn-subtle btn-regular" onClick={onToggleReviewed}>Mark unreviewed</button>
          ) : null}
          {/* A step that is already reviewed leads with moving on; undoing it is the quieter button. */}
          {reviewed && !isLast ? (
            <button type="button" className="btn-primary btn-regular pr-tour-action" title="Next step (→)" onClick={() => onGo(step + 1)}>
              Next step
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : actionButton(false)}
        </div>
      </footer>
    </div>
  );
}

function lineRange(point: PullRequestTourPoint): string {
  return point.end !== null && point.end !== point.start ? `${point.start}–${point.end}` : String(point.start);
}

/**
 * The step's files as bars: length is the file's changed lines against the step's largest file, split into
 * added and removed; each placed point is a copper number where its lines fall in the file. The name opens
 * the file; the numbers are a pointer shortcut (keyboard users have the points list below).
 */
function TourFootprint({ stop, files, stats, activePoint, onSelectPoint, onOpenFile }: {
  stop: PullRequestTourStop;
  files: readonly ReviewScopeFileSummary[];
  stats: ReadonlyMap<string, TourFileStat>;
  activePoint: number | null;
  onSelectPoint: (point: number) => void;
  onOpenFile: (path: string) => void;
}): ReactElement {
  if (!files.length) return <p className="pr-tour-muted">This step&apos;s files are no longer in the diff.</p>;
  const largest = Math.max(1, ...files.map((file) => file.additions + file.deletions));
  return (
    <ul className="pr-tour-footprint" aria-label={`Files (${files.length})`}>
      {files.map((file) => {
        const note = stop.files.find((owned) => owned.path === file.path)?.note;
        const lines = file.additions + file.deletions;
        const width = lines ? Math.max(6, (lines / largest) * 100) : 0;
        const viewed = file.viewed ? 'viewed' : 'not viewed';
        return (
          <li key={file.path} className="pr-tour-footprint-row" data-hidden={file.hidden || undefined}>
            <button type="button" className="pr-tour-footprint-name" onClick={() => onOpenFile(file.path)}
              title={[file.path, note].filter(Boolean).join('\n')}
              aria-label={`${file.path}, ${file.additions} added, ${file.deletions} removed, ${viewed}`}>
              {file.path.slice(file.path.lastIndexOf('/') + 1)}
            </button>
            <span className="pr-tour-footprint-track" aria-hidden="true">
              <span className="pr-tour-footprint-bar" style={{ width: `${width}%` }}>
                <i data-kind="added" style={{ flexGrow: file.additions }} />
                <i data-kind="deleted" style={{ flexGrow: file.deletions }} />
              </span>
              {stop.points.map((point, index) => {
                const position = point.path === file.path ? tourPointPosition(point, stats.get(file.path)) : null;
                return position === null ? null : (
                  <button key={index} type="button" tabIndex={-1} className="pr-guide-marker"
                    data-active={activePoint === index || undefined}
                    style={{ left: `${position * width}%` }} title={plainTourText(point.label)}
                    onClick={() => onSelectPoint(index)}>
                    {index + 1}
                  </button>
                );
              })}
            </span>
            <span className="pr-tour-file-viewed" data-viewed={file.viewed || undefined} aria-hidden="true">
              {file.viewed ? <Check size={12} aria-hidden="true" /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tour prose through the same markdown path the old Guide used: inline code naming a changed file is a link. */
function TourText({ body, prose, className }: { body: string; prose: TourProse; className?: string }): ReactElement {
  return (
    <div className={className}>
      <ReviewCommentBody body={body} compact onOpenFile={prose.open} resolveCodeReference={prose.resolve} fileLinkTarget="the diff" />
    </div>
  );
}

/** The stale / rewriting / failed note above a usable tour. */
export function TourBanner({ tone, children, action }: { tone: 'info' | 'warning'; children: ReactNode; action?: ReactNode }): ReactElement {
  return (
    <div className="pr-tour-banner" data-tone={tone} role="status">
      {tone === 'info' ? <CircleDotDashed size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
      <span>{children}</span>
      {action}
    </div>
  );
}

// The selected point's mark in the diff gets the selection fill; marks are found by their number.
export function ActivePointStyle({ marker }: { marker: number }): ReactElement {
  return <style>{`.pr-diff-pane[data-diff-tab="tour"] .review-guide-inline-note[data-guide-marker="${marker}"] { background: var(--select-row-focused); }`}</style>;
}
