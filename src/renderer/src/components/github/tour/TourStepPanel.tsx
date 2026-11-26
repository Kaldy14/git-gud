import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleDotDashed, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import type { CodeReference } from '@shared/codeReference';
import type { PullRequestTourAttentionKind, PullRequestTourStop } from '@shared/pullRequestTour';
import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import { drawStroke, EASE_OUT, prefersReducedMotion } from '@renderer/lib/motion';
import type { ReviewScopeFileSummary } from '@renderer/components/review/ReviewView';

import { PullRequestLineStats } from '../PullRequestLineStats';
import { PullRequestRiskChip } from '../PullRequestRiskChip';
import { isAnchoredPoint } from './pullRequestTourWalk';
import { listTourSteps, plainTourText } from './tourText';

// The call's run-in head, as the old Guide wrote it.
const ATTENTION_LABELS: Record<PullRequestTourAttentionKind, string> = {
  tradeoff: 'Tradeoff to weigh.',
  contract: 'Contract to check.',
  product: 'Product call.',
  risk: 'Risk to judge.',
  accessibility: 'Accessibility call.'
};

export type TourProse = {
  resolve: (reference: CodeReference) => CodeReference | undefined;
  open: (reference: CodeReference) => void;
};

export type TourFinishCheck = { unreviewed: number[] };

/**
 * The Tour's left panel: the step's narrative (risk, title, summary, attention, numbered points, questions,
 * files) over a pinned foot with the step's terminal action. Collapsed, it is a slim strip that still shows
 * the step and keeps the action in reach.
 */
export function TourStepPanel({
  stop,
  step,
  count,
  reviewed,
  activePoint,
  files,
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
  files: readonly ReviewScopeFileSummary[];
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
  // Keep the selected point in view when the diff selects it.
  useEffect(() => {
    if (activePoint === null) return;
    pointsRef.current?.children[activePoint]?.scrollIntoView({ block: 'nearest' });
  }, [activePoint]);

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

        {stop.summary ? <TourText body={stop.summary} prose={prose} className="pr-tour-summary" /> : null}

        {stop.attention ? (
          // The copper run-in head is the first bold run of the note's first paragraph.
          <TourText body={`**${ATTENTION_LABELS[stop.attention.kind]}** ${stop.attention.note}`} prose={prose} className="pr-tour-attention" />
        ) : null}

        {stop.points.length ? (
          <ol ref={pointsRef} className="pr-tour-points" aria-label="Points">
            {stop.points.map((point, index) => {
              const anchored = isAnchoredPoint(point);
              const lines = anchored ? `:${point.start}${point.end !== null && point.end !== point.start ? `–${point.end}` : ''}` : '';
              const where = `${point.path}${lines}`;
              return (
                <li
                  key={index}
                  className="pr-tour-point"
                  data-active={activePoint === index || undefined}
                  data-anchored={anchored || undefined}
                  onClick={(event) => {
                    // Links inside the prose do their own thing; anywhere else on the card selects it.
                    if (!anchored || (event.target instanceof Element && event.target.closest('a, button:not(.pr-tour-point-key)'))) return;
                    onSelectPoint(index);
                  }}
                >
                  {anchored ? (
                    <button type="button" className="pr-guide-marker pr-tour-point-key" aria-pressed={activePoint === index}
                      aria-label={`Point ${index + 1}: show ${where} in the diff`} title={`Show ${where}`}
                      onClick={() => onSelectPoint(index)}>
                      {index + 1}
                    </button>
                  ) : (
                    <span className="pr-tour-point-key" data-text-only="" title="Not placed on a line">{index + 1}</span>
                  )}
                  <div className="pr-tour-point-body">
                    <TourText body={point.body} prose={prose} />
                    <span className="pr-tour-point-where" title={where}>{point.path.slice(point.path.lastIndexOf('/') + 1)}{lines}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {stop.questions.length ? (
          <section className="pr-tour-section" aria-labelledby="pr-tour-questions">
            <h3 id="pr-tour-questions" className="pr-tour-eyebrow">Questions to consider</h3>
            <ul className="pr-tour-questions">
              {stop.questions.map((question) => <li key={question}><TourText body={question} prose={prose} /></li>)}
            </ul>
          </section>
        ) : null}

        <details className="pr-tour-section pr-tour-files" open>
          <summary className="pr-tour-eyebrow">
            Files ({files.length})
            <ChevronRight size={14} aria-hidden="true" />
          </summary>
          {files.length ? (
            <ul>
              {files.map((file) => {
                const note = stop.files.find((owned) => owned.path === file.path)?.note;
                const slash = file.path.lastIndexOf('/');
                return (
                  <li key={file.path}>
                    <button type="button" className="pr-tour-file" data-hidden={file.hidden || undefined}
                      title={note ? `${file.path}\n${note}` : file.path} onClick={() => onOpenFile(file.path)}>
                      <span className="pr-tour-file-viewed" data-viewed={file.viewed || undefined}
                        aria-label={file.viewed ? 'Viewed' : 'Not viewed'} role="img">
                        {file.viewed ? <Check size={12} aria-hidden="true" /> : null}
                      </span>
                      <span className="pr-tour-file-path">
                        {/* The directory truncates from its start (CSS direction: rtl); the trailing
                            left-to-right mark keeps its last slash at the end instead of jumping to the front. */}
                        {slash >= 0 ? <span className="pr-tour-file-dir">{`${file.path.slice(0, slash + 1)}\u200e`}</span> : null}
                        <span className="pr-tour-file-name">{file.path.slice(slash + 1)}</span>
                      </span>
                      <PullRequestLineStats additions={file.additions} deletions={file.deletions} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="pr-tour-muted">This step&apos;s files are no longer in the diff.</p>}
        </details>
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
