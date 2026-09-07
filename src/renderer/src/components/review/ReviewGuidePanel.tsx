import type { ReactElement } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react';

import type { GitReviewGuide, GitReviewGuideFile, GitReviewGuidePriority } from '@shared/types';
import type { VisibleReviewUnit } from './reviewFilters';
import { reviewGuideFileLabel, reviewGuidePriorityDescriptions, visibleReviewGuideFiles } from './reviewGuidePresentation';

export function ReviewGuidePriority({ priority, reason }: {
  priority: GitReviewGuidePriority;
  reason?: string;
}): ReactElement {
  return <span className="review-guide-priority" data-priority={priority}
    title={reason || reviewGuidePriorityDescriptions[priority]}>{priority}</span>;
}

export function ReviewGuidePanel({
  guide, units, selectedUnit, ranked, hasUpdatedOrder, rebuilding, disabled, onSelectUnit, onSelectFile, onSetRanked, onClose, onRebuild
}: {
  guide: GitReviewGuide;
  units: readonly VisibleReviewUnit[];
  selectedUnit?: VisibleReviewUnit;
  ranked: boolean;
  hasUpdatedOrder: boolean;
  rebuilding: boolean;
  disabled: boolean;
  onSelectUnit: (unitId: string) => void;
  onSelectFile: (file: GitReviewGuideFile) => void;
  onSetRanked: (ranked: boolean) => void;
  onClose: () => void;
  onRebuild: () => void;
}): ReactElement {
  const index = units.findIndex((unit) => unit.unit.id === selectedUnit?.unit.id);
  const block = guide.units.find((unit) => unit.unitId === selectedUnit?.unit.id);
  const files = visibleReviewGuideFiles(selectedUnit, block);
  const guideFiles = guide.units.flatMap((unit) => unit.files);

  return (
    <aside className="review-guide-panel" aria-label="AI guide">
      <header>
        <strong>AI guide</strong>
        <button type="button" className="icon-btn icon-btn-compact" aria-label="Close AI guide" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="review-guide-panel-body">
        <div className="review-guide-position">
          <span>{index >= 0 ? `Block ${index + 1} of ${units.length}` : 'No visible blocks'}</span>
          {block ? <ReviewGuidePriority priority={block.priority} reason={block.why} /> : null}
        </div>
        {selectedUnit ? <h2>{selectedUnit.unit.title.replace(/^Changes in /u, '')}</h2> : null}
        {block?.why ? <p>{block.why}</p> : null}
        {block?.what && block.what !== block.why ? <p>{block.what}</p> : null}
        {files.length ? (
          <div className="review-guide-file-links" aria-label="Files in this block">
            {files.map((file) => <button key={file.path} type="button" disabled={disabled}
              title={`${file.path}${file.line ? `:${file.line}` : ''}\n${file.reason}`} onClick={() => onSelectFile(file)}>
              <span>{reviewGuideFileLabel(file.path, guideFiles)}{file.line ? `:${file.line}` : ''}</span>
              <ArrowRight size={12} />
            </button>)}
          </div>
        ) : <p>Reveal changes with the review filters to continue.</p>}
        <div className="review-guide-navigation">
          <button type="button" className="btn-subtle btn-compact" aria-label="Previous block"
            disabled={disabled || index <= 0} onClick={() => onSelectUnit(units[index - 1]!.unit.id)}><ArrowLeft size={13} /> Back</button>
          <button type="button" className="btn-primary btn-compact"
            disabled={disabled || index < 0 || index >= units.length - 1}
            onClick={() => onSelectUnit(units[index + 1]!.unit.id)}>Next block <ArrowRight size={13} /></button>
        </div>
        {index >= 0 && index === units.length - 1 ? <small>End of the guide.</small> : null}
      </div>
      <footer>
        <button type="button" className="btn-subtle btn-compact" disabled={disabled} onClick={() => onSetRanked(hasUpdatedOrder || !ranked)}>
          {hasUpdatedOrder ? 'Apply updated AI order' : ranked ? 'Use original order' : 'Apply AI order'}
        </button>
        <button type="button" className="icon-btn icon-btn-compact" aria-label="Rebuild AI guide" title="Rebuild AI guide" disabled={disabled || rebuilding} onClick={onRebuild}><RefreshCw size={12} /></button>
        <small>Navigation does not mark code viewed.</small>
      </footer>
    </aside>
  );
}
