import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { prepareFileTreeInput } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { FolderTree, X } from 'lucide-react';

import { PanelExpandButton, PanelResizeHandle } from '../ui/panelResize';
import { usePanelResize } from '../ui/usePanelResize';
import { createReviewFileTreeEntries, reviewFileTreeCommonDirectory } from './reviewFileTree';
import type { VisibleReviewUnit } from './reviewFilters';
import { ReviewFileTreePathContextMenu } from './ReviewFilePathContextMenu';

export function ReviewFileTree({
  embedded = false, allFiles = false, hidden = false, minRemainingWidth = 560, repoPath, units, selectedPath, onSelectPath, onClose
}: {
  embedded?: boolean;
  allFiles?: boolean;
  hidden?: boolean;
  minRemainingWidth?: number;
  repoPath: string;
  units: readonly VisibleReviewUnit[];
  selectedPath?: string;
  onSelectPath: (path: string | undefined) => void;
  onClose?: () => void;
}): ReactElement {
  const { attachPanel, width, ...resize } = usePanelResize({
    storageKey: `git-gud:${allFiles ? 'pr-all-files' : 'review-file-tree'}-width:v1:${encodeURIComponent(repoPath)}`,
    defaultWidth: allFiles ? 340 : 260,
    expandedWidth: allFiles ? 520 : 460,
    minWidth: allFiles ? 240 : 180,
    maxWidth: allFiles ? 720 : 520,
    minRemainingWidth,
    edge: 'left'
  });
  const entries = useMemo(() => createReviewFileTreeEntries(units), [units]);
  const commonDirectory = embedded ? reviewFileTreeCommonDirectory(entries.map((entry) => entry.path)) : '';
  const treeEntries = useMemo(() => entries.map((entry) => ({
    ...entry, path: entry.path.slice(commonDirectory.length)
  })), [commonDirectory, entries]);
  const paths = useMemo(() => treeEntries.map((entry) => entry.path), [treeEntries]);
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths]);
  const treeSelectedPath = selectedPath?.startsWith(commonDirectory) ? selectedPath.slice(commonDirectory.length) : undefined;
  const syncingRef = useRef(false);
  const selectionRef = useRef({ pathSet, commonDirectory, onSelectPath });
  useEffect(() => { selectionRef.current = { pathSet, commonDirectory, onSelectPath }; }, [commonDirectory, onSelectPath, pathSet]);

  const { model } = useFileTree({
    preparedInput,
    gitStatus: treeEntries,
    initialExpansion: 'open',
    initialSelectedPaths: treeSelectedPath ? [treeSelectedPath] : [],
    onSelectionChange(selectedPaths) {
      if (syncingRef.current) return;
      const { pathSet: currentPaths, commonDirectory: prefix, onSelectPath: select } = selectionRef.current;
      const path = selectedPaths.find((candidate) => currentPaths.has(candidate));
      if (path) select(prefix + path);
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
      ${embedded ? `
        [data-file-tree-virtualized-wrapper], [data-file-tree-virtualized-root] { height: auto; }
        [data-file-tree-virtualized-scroll] { flex: none; max-height: clamp(150px, calc(100vh - 500px), 360px); }
        [data-file-tree-virtualized-list] { min-height: 0; }
      ` : ''}
    `
  });

  useEffect(() => {
    const selected = model.getSelectedPaths();
    if (selected.length === (treeSelectedPath ? 1 : 0) && selected[0] === treeSelectedPath) return;
    syncingRef.current = true;
    try {
      for (const path of selected) if (path !== treeSelectedPath) model.getItem(path)?.deselect();
      if (treeSelectedPath && pathSet.has(treeSelectedPath)) {
        model.getItem(treeSelectedPath)?.select();
        model.scrollToPath(treeSelectedPath, { focus: false });
      }
    } finally { syncingRef.current = false; }
  }, [model, pathSet, treeSelectedPath]);

  const style: CSSProperties & Record<'--review-file-tree-width', string> = {
    '--review-file-tree-width': `${width}px`
  };
  const label = allFiles ? 'all files' : 'review file tree';
  return (
    <aside ref={attachPanel} className="review-file-tree-panel" data-embedded={embedded} data-all-files={allFiles} hidden={hidden} style={embedded ? undefined : style} aria-label={allFiles ? 'All changed files' : 'Review files'}>
      {!embedded ? <>
        <PanelResizeHandle resize={resize} label={label} />
        <header><span><FolderTree size={13} />{allFiles ? 'All files' : 'Files'}<span className="badge-mini">{entries.length}</span></span>
          <PanelExpandButton resize={resize} label={label} />
          {onClose ? <button className="icon-btn icon-btn-compact" type="button" onClick={onClose} aria-label="Hide all files" title="Hide all files"><X size={14} /></button> : null}
        </header>
      </> : null}
      {commonDirectory ? <div className="review-file-tree-common-path" title={commonDirectory.slice(0, -1)}>{commonDirectory.slice(0, -1).split('/').join(' / ')}</div> : null}
      {allFiles ? <p className="review-all-files-summary">{entries.length} changed files · all review blocks</p> : null}
      <div className="review-file-tree-body">
        <FileTree className="review-file-tree" model={model}
          onPointerOverCapture={(event) => {
            const row = event.nativeEvent.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.itemPath !== undefined);
            if (row) row.title = commonDirectory + row.dataset.itemPath;
          }}
          onClickCapture={(event) => {
            const row = event.nativeEvent.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.itemType === 'file' && target.dataset.itemPath !== undefined);
            const path = row?.dataset.itemPath;
            if (path && pathSet.has(path) && model.getItem(path)?.isSelected()) onSelectPath(commonDirectory + path);
          }}
          renderContextMenu={(item, context) => <ReviewFileTreePathContextMenu item={{ ...item, path: commonDirectory + item.path }} context={context} />}
        />
      </div>
      {allFiles ? <footer className="review-all-files-footer">Includes files hidden by review filters.</footer> : null}
    </aside>
  );
}
