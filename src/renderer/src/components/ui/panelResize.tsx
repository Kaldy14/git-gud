import type { ReactElement } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { usePanelResize } from './usePanelResize';

export function PanelResizeHandle({ resize, label }: {
  resize: Pick<ReturnType<typeof usePanelResize>, 'separatorProps'>;
  label: string;
}): ReactElement {
  return <div {...resize.separatorProps} className="panel-resize-handle" aria-label={`Resize ${label}`} title="Drag to resize. Double-click to reset." />;
}

export function PanelExpandButton({ resize, label }: {
  resize: Pick<ReturnType<typeof usePanelResize>, 'isExpanded' | 'toggleExpanded'>;
  label: string;
}): ReactElement {
  const title = `${resize.isExpanded ? 'Restore' : 'Expand'} ${label}`;
  return (
    <button className="icon-btn icon-btn-compact panel-expand-button" type="button" aria-label={title} title={title} aria-pressed={resize.isExpanded} onClick={resize.toggleExpanded}>
      <ArrowLeftRight size={14} />
    </button>
  );
}
