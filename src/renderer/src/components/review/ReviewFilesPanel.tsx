import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { prepareFileTreeInput } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { FolderTree } from 'lucide-react';

import { PanelExpandButton, PanelResizeHandle } from '../ui/panelResize';
import { usePanelResize } from '../ui/usePanelResize';
import { createReviewFileTreeEntries } from './reviewFileTree';
import type { VisibleReviewUnit } from './reviewFilters';
import { ReviewFileTreePathContextMenu } from './ReviewFilePathContextMenu';

/** The standard review's file tree panel (local branch, commit and WIP reviews). */
export function ReviewFileTree({
  repoPath, units, selectedPath, onSelectPath
}: {
  repoPath: string;
  units: readonly VisibleReviewUnit[];
  selectedPath?: string;
  onSelectPath: (path: string | undefined) => void;
}): ReactElement {
  const { attachPanel, width, ...resize } = usePanelResize({
    storageKey: `git-gud:review-file-tree-width:v1:${encodeURIComponent(repoPath)}`,
    defaultWidth: 260,
    expandedWidth: 460,
    minWidth: 180,
    maxWidth: 520,
    minRemainingWidth: 560,
    edge: 'left'
  });
  const entries = useMemo(() => createReviewFileTreeEntries(units), [units]);
  const paths = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths]);
  const syncingRef = useRef(false);
  const selectionRef = useRef({ pathSet, onSelectPath });
  useEffect(() => { selectionRef.current = { pathSet, onSelectPath }; }, [onSelectPath, pathSet]);

  const { model } = useFileTree({
    preparedInput,
    gitStatus: entries,
    initialExpansion: 'open',
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange(selectedPaths) {
      if (syncingRef.current) return;
      const { pathSet: currentPaths, onSelectPath: select } = selectionRef.current;
      const path = selectedPaths.find((candidate) => currentPaths.has(candidate));
      if (path) select(path);
    },
    search: false,
    unsafeCSS: `
      :host {
        --trees-selected-bg-override: var(--select-bg);
        --trees-border-color-override: var(--border);
        --trees-fg-override: var(--text-2);
        --trees-muted-fg-override: var(--text-3);
        --trees-bg-override: transparent;
        --trees-hover-bg-override: var(--bg-hover);
        /* Use the diff's file-status colors instead of the tree's default cyan. */
        --trees-git-modified-color-override: var(--accent-2);
        --trees-git-added-color-override: var(--success-text);
        --trees-git-deleted-color-override: var(--danger-text);
        --trees-padding-inline-override: 2px;
        --trees-item-padding-x-override: 4px;
        --trees-font-family-override: var(--font-ui);
        --trees-font-size-override: 12px;
        --trees-level-gap-override: 10px;
      }
      /* Use native ellipsis with a reserved suffix lane, without painted fade masks. */
      [data-item-section="content"] { flex: 1 1 auto; }
      [data-item-section="spacing"], [data-item-section="git"] { flex-shrink: 0; }
      [data-item-section="git"] { margin-left: 6px; }
      [data-item-section="decoration"]:empty { display: none; }
      [data-truncate-grid] { display: block; }
      [data-truncate-container] { height: auto; margin: 0; }
      [data-truncate-content="overflow"], [data-truncate-marker-cell], [data-truncate-fill] { display: none; }
      [data-truncate-content="visible"] { overflow: hidden; text-overflow: ellipsis; direction: ltr; }
      [data-truncate-group-container="middle"] { display: flex; min-width: 0; }
      [data-truncate-group-container="middle"] > :first-child { flex: 0 1 auto; min-width: 0; }
      [data-truncate-group-container="middle"] > :last-child { flex: 0 0 auto; }
    `
  });

  useEffect(() => {
    const selected = model.getSelectedPaths();
    if (selected.length === (selectedPath ? 1 : 0) && selected[0] === selectedPath) return;
    syncingRef.current = true;
    try {
      for (const path of selected) if (path !== selectedPath) model.getItem(path)?.deselect();
      if (selectedPath && pathSet.has(selectedPath)) {
        model.getItem(selectedPath)?.select();
        model.scrollToPath(selectedPath, { focus: false });
      }
    } finally { syncingRef.current = false; }
  }, [model, pathSet, selectedPath]);

  const style: CSSProperties & Record<'--review-file-tree-width', string> = {
    '--review-file-tree-width': `${width}px`
  };
  const label = 'review file tree';
  return (
    <aside ref={attachPanel} className="review-file-tree-panel" style={style} aria-label="Review files">
      <PanelResizeHandle resize={resize} label={label} />
      <header><span><FolderTree size={14} />Files<span className="badge-mini">{entries.length}</span></span>
        <PanelExpandButton resize={resize} label={label} />
      </header>
      <div className="review-file-tree-body">
        <FileTree className="review-file-tree" model={model}
          onPointerOverCapture={(event) => {
            const row = event.nativeEvent.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.itemPath !== undefined);
            if (!row) return;
            const status = entries.find((entry) => entry.path === row.dataset.itemPath)?.status;
            const description = status ? REVIEW_FILE_STATUS_DESCRIPTIONS[status] : undefined;
            row.title = row.dataset.itemPath + (description ? ` · ${description}` : '');
            const badge = row.querySelector<HTMLElement>('[data-item-section="git"] > span');
            if (badge && description) badge.title = description;
          }}
          onClickCapture={(event) => {
            const row = event.nativeEvent.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.itemType === 'file' && target.dataset.itemPath !== undefined);
            const path = row?.dataset.itemPath;
            if (path && pathSet.has(path) && model.getItem(path)?.isSelected()) onSelectPath(path);
          }}
          renderContextMenu={(item, context) => <ReviewFileTreePathContextMenu item={{ ...item, path: item.path }} context={context} />}
        />
      </div>
    </aside>
  );
}

const REVIEW_FILE_STATUS_DESCRIPTIONS = {
  added: 'A · Added file',
  modified: 'M · Modified file',
  deleted: 'D · Deleted file',
  renamed: 'R · Renamed or moved file',
  untracked: 'U · Untracked file',
  ignored: 'Ignored file'
};
