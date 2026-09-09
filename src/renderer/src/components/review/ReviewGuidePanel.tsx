import { useState, type ReactElement } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronsUp, Code2, Eye, RefreshCw, Sparkles, X } from 'lucide-react';
import { Tooltip } from 'radix-ui';

import type { GitReviewGuide, GitReviewGuideFile, GitReviewGuidePriority, GitReviewGuideSummary } from '@shared/types';
import { ReviewCommentBody } from './ReviewCommentBody';
import type { VisibleReviewUnit } from './reviewFilters';
import { guideSummaries, reviewGuideFileLabel, reviewGuidePriorityDescriptions, summaryIsVisible, visibleReviewGuideFiles } from './reviewGuidePresentation';
import { findingCounts, type ReviewGuideFinding } from './reviewGuideFindings';

export function ReviewGuidePriority({ priority, reason }: { priority: GitReviewGuidePriority; reason?: string }): ReactElement {
  return <span className="review-guide-priority" data-priority={priority} title={reason || reviewGuidePriorityDescriptions[priority]}>{priority}</span>;
}

export function ReviewFindingBadges({ findings }: { findings: readonly ReviewGuideFinding[] }): ReactElement {
  return <span className="review-finding-badges">{findingCounts(findings).map(({ severity, count }) =>
    <span className="review-finding-count" data-severity={severity} key={severity}><i aria-hidden="true" />{count} {severity}</span>
  )}</span>;
}

export function ReviewLayerTooltip({ title, description, findings, children, enabled }: {
  title: string;
  description: string;
  findings: readonly ReviewGuideFinding[];
  children: ReactElement;
  enabled: boolean;
}): ReactElement {
  if (!enabled) return children;
  return <Tooltip.Provider delayDuration={350}><Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="review-layer-tooltip" side="right" align="start" sideOffset={10} collisionPadding={12}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {findings.length ? <ReviewFindingBadges findings={findings} /> : null}
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

export function ReviewFindingDot({ findings }: { findings: readonly ReviewGuideFinding[] }): ReactElement | null {
  const counts = findingCounts(findings);
  if (!counts.length) return null;
  return <span className="review-layer-finding-dot" data-severity={counts[0]!.severity}>
    <span className="sr-only">{counts.map(({ count, severity }) => `${count} ${severity}`).join(', ')} findings</span>
  </span>;
}

export function ReviewGuideComplexity({ level }: { level: GitReviewGuideSummary['complexity'] }): ReactElement {
  return <span className="review-summary-complexity" data-level={level} title={`${level} change complexity`}><ChevronsUp size={12} aria-hidden="true" />{level}</span>;
}

export function ReviewGuidePanel({ guide, units, selectedUnit, findings, tab, rebuilding, disabled, onSelectUnit, onSelectFile, onSelectFinding, onTabChange, onClose, onRebuild }: {
  guide: GitReviewGuide;
  units: readonly VisibleReviewUnit[];
  selectedUnit?: VisibleReviewUnit;
  findings: readonly ReviewGuideFinding[];
  tab: 'summaries' | 'findings';
  rebuilding: boolean;
  disabled: boolean;
  onSelectUnit: (unitId: string) => void;
  onSelectFile: (file: GitReviewGuideFile) => void;
  onSelectFinding: (finding: ReviewGuideFinding) => void;
  onTabChange: (tab: 'summaries' | 'findings') => void;
  onClose: () => void;
  onRebuild: () => void;
}): ReactElement {
  const [complexity, setComplexity] = useState<'all' | GitReviewGuideSummary['complexity']>('all');
  const [expansions, setExpansions] = useState<Record<string, boolean>>({});
  const [readSummaries, setReadSummaries] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedSummary, setSelectedSummary] = useState<string>();
  const index = units.findIndex((unit) => unit.unit.id === selectedUnit?.unit.id);
  const layer = guide.units.find((unit) => unit.unitId === selectedUnit?.unit.id);
  const files = visibleReviewGuideFiles(selectedUnit, layer);
  const summaries = guideSummaries(layer);
  const visibleSummaries = summaries.filter((summary) => complexity === 'all' || summary.complexity === complexity);
  const guideFiles = guide.units.flatMap((unit) => unit.files);
  const summaryKey = (summary: GitReviewGuideSummary): string => `${layer?.unitId}:${summary.path}:${summary.side}:${summary.line}:${summary.endLine}`;

  return <aside className="review-guide-panel review-ai-brief" aria-label="AI brief">
    <header><strong><Sparkles size={13} /> AI brief</strong><button type="button" className="icon-btn icon-btn-compact" aria-label="Close AI brief" disabled={disabled} onClick={onClose}><X size={14} /></button></header>
    <div className="review-brief-intro">
      <div className="review-guide-position"><span>{index >= 0 ? `Layer ${index + 1} of ${units.length}` : 'No visible layers'}</span><span>{files.length} {files.length === 1 ? 'file' : 'files'}</span></div>
      {selectedUnit ? <h2>{layer?.title || selectedUnit.unit.title.replace(/^Changes in /u, '')}</h2> : null}
      {layer?.why ? <p>{layer.why}</p> : null}
      {layer?.what && layer.what !== layer.why ? <p>{layer.what}</p> : null}
      {layer?.dependsOn?.map((id) => {
        const prerequisite = guide.units.find((item) => item.unitId === id);
        if (!prerequisite) return null;
        const visible = units.some((unit) => unit.unit.id === id);
        return <button className="review-layer-dependency" key={id} disabled={disabled || !visible} title={visible ? 'Open prerequisite layer' : 'Layer hidden by review filters'} onClick={() => onSelectUnit(id)}>
          Read after: {prerequisite.title || 'Previous layer'} <ArrowRight size={11} />{visible ? null : ' · hidden'}
        </button>;
      })}
    </div>
    <div className="review-brief-tabs" aria-label="AI brief content">
      <button type="button" aria-pressed={tab === 'summaries'} onClick={() => onTabChange('summaries')}>Summaries <span>{summaries.length}</span></button>
      <button type="button" aria-pressed={tab === 'findings'} onClick={() => onTabChange('findings')}>Findings <span>{findings.length}</span></button>
    </div>
    {tab === 'summaries' ? <div className="review-complexity-filter"><span>Complexity</span><div className="segmented">{(['all', 'high', 'medium', 'low'] as const).map((level) =>
      <button type="button" key={level} aria-pressed={complexity === level} data-active={complexity === level} onClick={() => setComplexity(level)}>{level}</button>
    )}</div></div> : null}
    <div className="review-brief-scroll">
      {tab === 'summaries' ? <>
        {visibleSummaries.map((summary) => {
          const key = summaryKey(summary);
          const open = expansions[key] ?? summary.complexity !== 'low';
          const hidden = !summaryIsVisible(summary, selectedUnit);
          return <details className="review-summary-card" data-selected={selectedSummary === key} key={key} open={open}>
            <summary onClick={(event) => { event.preventDefault(); setExpansions((current) => ({ ...current, [key]: !open })); }}><ReviewGuideComplexity level={summary.complexity} /><span className="review-summary-preview">{summary.body}</span><ChevronDown size={12} /></summary>
            <ReviewCommentBody body={summary.body} compact />
            <div className="review-summary-location"><button type="button" className="review-summary-link" disabled={disabled} title={hidden ? 'Reveal this file and jump to code' : 'Jump to code'} onClick={() => {
              setSelectedSummary(key);
              setReadSummaries((current) => new Set([...current, key]));
              onSelectFile({ ...summary, priority: layer?.priority ?? 'review', reason: summary.body });
            }}><Code2 size={12} /><span>{reviewGuideFileLabel(summary.path, guideFiles)}:{summary.line}{summary.endLine !== summary.line ? `-${summary.endLine}` : ''}</span><ArrowRight size={11} /></button>{readSummaries.has(key) ? <Eye size={12} aria-label="Summary read" /> : null}</div>
            {hidden ? <small>Hidden by review filters. Open the location to reveal it.</small> : null}
          </details>;
        })}
        {!visibleSummaries.length ? <p className="review-brief-empty">{summaries.length ? `No ${complexity}-complexity summaries in this layer.` : layer?.summaries === undefined ? 'Rebuild this brief to generate range summaries.' : 'No range summaries available for this layer.'}</p> : null}
        {!summaries.length && files.length ? <div className="review-guide-file-links">{files.map((file) => <button type="button" key={file.path} disabled={disabled} onClick={() => onSelectFile(file)}>{reviewGuideFileLabel(file.path, guideFiles)} <ArrowRight size={12} /></button>)}</div> : null}
      </> : <>
        <p className="review-brief-findings-status">{findings.some(({ comment }) => comment.isResolved === undefined) ? 'Some resolution statuses are unavailable.' : 'Unresolved review findings'}</p>
        {findings.map((finding) => <article className="review-brief-finding" key={finding.comment.id}>
          <header><ReviewFindingBadges findings={[finding]} /><span>{finding.comment.author}</span></header>
          <ReviewCommentBody body={finding.comment.body} compact />
          <button type="button" className="review-summary-link" disabled={disabled} onClick={() => onSelectFinding(finding)}><Code2 size={12} /><span>{reviewGuideFileLabel(finding.comment.path, guideFiles)}{finding.comment.line ? `:${finding.comment.line}` : ''}</span><ArrowRight size={11} /> Jump to comment</button>
        </article>)}
        {!findings.length ? <p className="review-brief-empty">No current severity-labelled findings in this layer.</p> : null}
      </>}
    </div>
    <footer><span className="review-brief-read-count">{summaries.filter((summary) => readSummaries.has(summaryKey(summary))).length} / {summaries.length} summaries read</span>
      <div className="review-brief-navigation"><button type="button" className="icon-btn icon-btn-compact" aria-label="Previous layer" disabled={disabled || index <= 0} onClick={() => onSelectUnit(units[index - 1]!.unit.id)}><ArrowLeft size={13} /></button><button type="button" className="btn-subtle btn-compact" disabled={disabled || index < 0 || index >= units.length - 1} onClick={() => onSelectUnit(units[index + 1]!.unit.id)}>Next layer <ArrowRight size={13} /></button><button type="button" className="icon-btn icon-btn-compact" aria-label="Rebuild AI brief" title="Rebuild AI brief" disabled={disabled || rebuilding} onClick={onRebuild}><RefreshCw size={12} /></button></div>
      <small>Reading summaries does not mark code viewed.</small>
    </footer>
  </aside>;
}
