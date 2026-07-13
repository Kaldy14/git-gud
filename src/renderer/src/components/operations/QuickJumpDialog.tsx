import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';
import {
  Archive,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitFork,
  Search,
  TerminalSquare,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import type { CommitGraphRow, GitRepositoryOverview, RepoTab } from '@shared/types';

export type PaletteAction = {
  id: string;
  label: string;
  category: string;
  detail?: string;
  keywords?: string[];
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => Promise<void> | void;
};

export type QuickJumpDialogProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  repositoryOverview?: GitRepositoryOverview;
  graphRows?: CommitGraphRow[];
  paletteActions?: readonly PaletteAction[];
  isOperationBusy?: boolean;
  onClose: () => void;
  onActivateTab: (tabId: string) => void;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onSelectCommit?: (sha: string) => void;
  onOpenRepositoryPath?: (repoPath: string) => void;
};

type QuickJumpItem = {
  id: string;
  label: string;
  detail: string;
  category: string;
  scoreTarget: string;
  icon: ReactNode;
  disabled: boolean;
  disabledReason?: string;
  onSelect: () => Promise<void> | void;
};

const MAX_RESULTS = 36;

export function QuickJumpDialog({
  tabs,
  activeTabId,
  repositoryOverview,
  graphRows = [],
  paletteActions = [],
  isOperationBusy = false,
  onClose,
  onActivateTab,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onSelectCommit,
  onOpenRepositoryPath
}: QuickJumpDialogProps): ReactElement {
  const titleId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(
    () =>
      buildItems({
        tabs,
        activeTabId,
        repositoryOverview,
        graphRows,
        paletteActions,
        isOperationBusy,
        onActivateTab,
        onCheckoutBranch,
        onCheckoutRemoteBranch,
        onSelectCommit,
        onOpenRepositoryPath
      }),
    [
      activeTabId,
      graphRows,
      isOperationBusy,
      onActivateTab,
      onCheckoutBranch,
      onCheckoutRemoteBranch,
      onOpenRepositoryPath,
      onSelectCommit,
      paletteActions,
      repositoryOverview,
      tabs
    ]
  );
  const filteredItems = useMemo(() => filterItems(items, query), [items, query]);
  const activeItemIndex = nearestEnabledIndex(filteredItems, activeIndex, 1);
  const activeItem = filteredItems[activeItemIndex];

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(nextEnabledIndex(filteredItems, activeItemIndex, 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(nextEnabledIndex(filteredItems, activeItemIndex, -1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(nearestEnabledIndex(filteredItems, 0, 1));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(nearestEnabledIndex(filteredItems, filteredItems.length - 1, -1));
      return;
    }

    if (event.key === 'Enter' && activeItem && !activeItem.disabled) {
      event.preventDefault();
      void activeItem.onSelect();
      onClose();
    }
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      className="w-full max-w-[680px] overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/60"
      backdropClassName="fixed inset-0 z-50 grid place-items-start justify-center bg-black/45 px-4 py-[10vh]"
      onClose={onClose}
    >
      <h2 id={titleId} className="sr-only">Command palette</h2>
      <div className="flex h-12 items-center gap-3 border-b border-[var(--border)] px-4">
        <Search size={16} className="text-[var(--accent-2)]" />
        <input
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          value={query}
          data-modal-initial-focus="true"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={resultsId}
          aria-expanded="true"
          aria-activedescendant={activeItem ? `${resultsId}-${safeDomId(activeItem.id)}` : undefined}
          placeholder="Search commands, commits, branches, stashes, and worktrees"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)] sm:inline">Esc</span>
        <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close command palette">
          <X size={14} />
        </button>
      </div>
      <div id={resultsId} className="max-h-[min(520px,68vh)] overflow-y-auto p-1.5" role="listbox" aria-label="Command palette results">
        {filteredItems.length > 0 ? (
          filteredItems.map((item, index) => (
            <button
              key={item.id}
              id={`${resultsId}-${safeDomId(item.id)}`}
              className="menu-row grid grid-cols-[20px_minmax(0,1fr)_104px]"
              type="button"
              role="option"
              aria-selected={index === activeItemIndex}
              aria-disabled={item.disabled}
              tabIndex={-1}
              disabled={item.disabled}
              title={item.disabledReason ?? item.detail}
              style={index === activeItemIndex ? { background: 'var(--select-bg)', color: 'var(--text-1)' } : undefined}
              onMouseEnter={() => {
                if (!item.disabled) {
                  setActiveIndex(index);
                }
              }}
              onClick={() => {
                void item.onSelect();
                onClose();
              }}
            >
              <span className="grid place-items-center text-[var(--text-3)]">{item.icon}</span>
              <span className="min-w-0">
                <span className="block truncate">{item.label}</span>
                {item.detail ? <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">{item.detail}</span> : null}
              </span>
              <span className="self-center truncate text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                {item.category}
              </span>
            </button>
          ))
        ) : (
          <div className="px-3 py-10 text-center text-xs leading-5 text-[var(--text-3)]">
            No commands or repository items match <span className="text-[var(--text-2)]">{query}</span>.
          </div>
        )}
      </div>
      <footer className="flex h-8 items-center justify-between border-t border-[var(--border)] px-3 text-[10.5px] text-[var(--text-3)]">
        <span>{filteredItems.length} results</span>
        <span>↑↓ Navigate · Enter Run</span>
      </footer>
    </ModalSurface>
  );
}

type BuildItemsInput = Pick<
  QuickJumpDialogProps,
  | 'tabs'
  | 'activeTabId'
  | 'repositoryOverview'
  | 'graphRows'
  | 'paletteActions'
  | 'isOperationBusy'
  | 'onActivateTab'
  | 'onCheckoutBranch'
  | 'onCheckoutRemoteBranch'
  | 'onSelectCommit'
  | 'onOpenRepositoryPath'
>;

function buildItems({
  tabs,
  activeTabId,
  repositoryOverview,
  graphRows = [],
  paletteActions = [],
  isOperationBusy = false,
  onActivateTab,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onSelectCommit,
  onOpenRepositoryPath
}: BuildItemsInput): QuickJumpItem[] {
  const actionItems = paletteActions.map((action) => ({
    id: `action:${action.id}`,
    label: action.label,
    detail: action.disabledReason ?? action.detail ?? '',
    category: action.category,
    scoreTarget: [action.label, action.detail, action.category, ...(action.keywords ?? [])].filter(Boolean).join(' '),
    icon: action.icon ?? <TerminalSquare size={14} />,
    disabled: action.disabled ?? false,
    disabledReason: action.disabledReason,
    onSelect: action.onSelect
  }));
  const repoItems = tabs.map((tab) => ({
    id: `repo:${tab.id}`,
    label: tab.name,
    detail: tab.id === activeTabId ? 'Active repository' : tab.path,
    category: 'Repositories',
    scoreTarget: `${tab.name} ${tab.path} repository`,
    icon: <GitFork size={14} className="text-[var(--accent-2)]" />,
    disabled: false,
    onSelect: () => onActivateTab(tab.id)
  }));
  const branchItems =
    repositoryOverview?.refs.localBranches.map((branch) => ({
      id: `branch:${branch.fullName}`,
      label: branch.name,
      detail: branch.current ? 'Current branch' : formatAheadBehind(branch.ahead, branch.behind),
      category: 'Branches',
      scoreTarget: `${branch.name} ${branch.fullName} local branch`,
      icon: <GitBranch size={14} />,
      disabled: branch.current || isOperationBusy,
      disabledReason: branch.current ? 'Already checked out' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: () => onCheckoutBranch(branch.name)
    })) ?? [];
  const remoteItems =
    repositoryOverview?.refs.remoteBranches.map((branch) => ({
      id: `remote:${branch.fullName}`,
      label: branch.name,
      detail: branch.remote,
      category: 'Remote branches',
      scoreTarget: `${branch.name} ${branch.fullName} ${branch.remote} remote branch`,
      icon: <GitBranch size={14} />,
      disabled: isOperationBusy,
      disabledReason: isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: () => onCheckoutRemoteBranch(branch.name)
    })) ?? [];
  const worktreeItems =
    repositoryOverview?.worktrees.map((worktree) => {
      const matchingTab = tabs.find((tab) => tab.path === worktree.path);
      const canOpen = Boolean(matchingTab || onOpenRepositoryPath);

      return {
        id: `worktree:${worktree.path}`,
        label: worktree.branch ?? worktree.path,
        detail: worktree.current ? 'Current worktree' : worktree.path,
        category: 'Worktrees',
        scoreTarget: `${worktree.branch ?? ''} ${worktree.path} worktree`,
        icon: <FolderGit2 size={14} />,
        disabled: !canOpen,
        disabledReason: canOpen ? undefined : 'No open-worktree action is connected',
        onSelect: () => {
          if (matchingTab) {
            onActivateTab(matchingTab.id);
          } else {
            onOpenRepositoryPath?.(worktree.path);
          }
        }
      };
    }) ?? [];
  const historyItems = graphRows.flatMap((row) => {
    if (row.node.kind === 'wip') {
      return [];
    }

    const isStash = row.node.kind === 'stash';
    const stashSelector = row.refs?.find((ref) => ref.kind === 'stash')?.label;

    return [
      {
        id: `${isStash ? 'stash' : 'commit'}:${row.sha}`,
        label: row.subject,
        detail: isStash ? (stashSelector ?? row.sha.slice(0, 7)) : `${row.sha.slice(0, 7)} · ${row.author.name} · ${row.dateLabel}`,
        category: isStash ? 'Stashes' : 'Commits',
        scoreTarget: `${row.subject} ${row.sha} ${row.author.name} ${row.author.email ?? ''} ${stashSelector ?? ''}`,
        icon: isStash ? <Archive size={14} /> : <GitCommit size={14} />,
        disabled: !onSelectCommit,
        disabledReason: onSelectCommit ? undefined : 'No history selection action is connected',
        onSelect: () => onSelectCommit?.(row.sha)
      }
    ];
  });

  return [...actionItems, ...repoItems, ...branchItems, ...remoteItems, ...worktreeItems, ...historyItems];
}

function filterItems(items: QuickJumpItem[], query: string): QuickJumpItem[] {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return items.slice(0, MAX_RESULTS);
  }

  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(normalizedQuery, normalizeSearch(item.scoreTarget)) }))
    .filter((entry) => entry.score >= 0)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.item);
}

function fuzzyScore(query: string, target: string): number {
  if (!query) {
    return 0;
  }

  const directIndex = target.indexOf(query);

  if (directIndex !== -1) {
    return 100 - directIndex - target.length * 0.001;
  }

  let queryIndex = 0;
  let score = 0;
  let lastMatch = -2;

  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] !== query[queryIndex]) {
      continue;
    }

    const boundaryBonus = index === 0 || /[\s/_-]/.test(target[index - 1] ?? '') ? 4 : 0;
    const contiguousBonus = index === lastMatch + 1 ? 3 : 0;
    score += 1 + boundaryBonus + contiguousBonus;
    lastMatch = index;
    queryIndex += 1;
  }

  return queryIndex === query.length ? score - target.length * 0.001 : -1;
}

function nextEnabledIndex(items: QuickJumpItem[], currentIndex: number, direction: 1 | -1): number {
  if (items.length === 0) {
    return 0;
  }

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (currentIndex + direction * offset + items.length) % items.length;

    if (!items[index]?.disabled) {
      return index;
    }
  }

  return currentIndex;
}

function nearestEnabledIndex(items: QuickJumpItem[], preferredIndex: number, direction: 1 | -1): number {
  if (items.length === 0) {
    return 0;
  }

  const clampedIndex = Math.min(items.length - 1, Math.max(0, preferredIndex));

  if (!items[clampedIndex]?.disabled) {
    return clampedIndex;
  }

  for (let offset = 1; offset < items.length; offset += 1) {
    const index = clampedIndex + direction * offset;

    if (index >= 0 && index < items.length && !items[index]?.disabled) {
      return index;
    }
  }

  return clampedIndex;
}

function formatAheadBehind(ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) {
    return 'Local branch';
  }

  return `${ahead} ahead · ${behind} behind`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function safeDomId(value: string): string {
  return value.replace(/[^\dA-Za-z_-]/g, '-');
}
