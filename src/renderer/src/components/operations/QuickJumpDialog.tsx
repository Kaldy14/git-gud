import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, GitFork, Search, X } from 'lucide-react';

import type { GitRepositoryOverview, RepoTab } from '@shared/types';

type QuickJumpDialogProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  repositoryOverview?: GitRepositoryOverview;
  onClose: () => void;
  onActivateTab: (tabId: string) => void;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
};

type QuickJumpItem = {
  id: string;
  label: string;
  detail: string;
  kind: 'repo' | 'branch' | 'remote';
  scoreTarget: string;
  onSelect: () => void;
};

export function QuickJumpDialog({
  tabs,
  activeTabId,
  repositoryOverview,
  onClose,
  onActivateTab,
  onCheckoutBranch,
  onCheckoutRemoteBranch
}: QuickJumpDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(
    () => buildItems(tabs, activeTabId, repositoryOverview, onActivateTab, onCheckoutBranch, onCheckoutRemoteBranch),
    [activeTabId, onActivateTab, onCheckoutBranch, onCheckoutRemoteBranch, repositoryOverview, tabs]
  );
  const filteredItems = useMemo(() => filterItems(items, query), [items, query]);
  const activeItem = filteredItems[Math.min(activeIndex, Math.max(0, filteredItems.length - 1))];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => Math.min(filteredItems.length - 1, value + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => Math.max(0, value - 1));
      return;
    }

    if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      activeItem.onSelect();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/45 px-4 py-[12vh]">
      <div className="w-full max-w-[560px] overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/60">
        <div className="flex h-12 items-center gap-3 border-b border-[var(--border)] px-4">
          <Search size={16} className="text-[var(--accent-2)]" />
          <input
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
            value={query}
            autoFocus
            placeholder="Jump to repository or branch"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close jump dialog">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => (
              <button
                key={item.id}
                className="menu-row"
                type="button"
                style={index === activeIndex ? { background: 'var(--select-bg)', color: 'var(--text-1)' } : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  item.onSelect();
                  onClose();
                }}
              >
                {item.kind === 'repo' ? <GitFork size={14} className="text-[var(--accent-2)]" /> : <GitBranch size={14} />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-3)]">{item.detail}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-xs text-[var(--text-3)]">No matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildItems(
  tabs: RepoTab[],
  activeTabId: string | undefined,
  repositoryOverview: GitRepositoryOverview | undefined,
  onActivateTab: (tabId: string) => void,
  onCheckoutBranch: (name: string) => void,
  onCheckoutRemoteBranch: (name: string) => void
): QuickJumpItem[] {
  const repoItems = tabs.map((tab) => ({
    id: `repo:${tab.id}`,
    label: tab.name,
    detail: tab.id === activeTabId ? 'active repo' : 'repository',
    kind: 'repo' as const,
    scoreTarget: `${tab.name} ${tab.path}`,
    onSelect: () => onActivateTab(tab.id)
  }));
  const branchItems =
    repositoryOverview?.refs.localBranches.map((branch) => ({
      id: `branch:${branch.fullName}`,
      label: branch.name,
      detail: branch.current ? 'current branch' : 'local branch',
      kind: 'branch' as const,
      scoreTarget: `${branch.name} ${branch.fullName}`,
      onSelect: () => onCheckoutBranch(branch.name)
    })) ?? [];
  const remoteItems =
    repositoryOverview?.refs.remoteBranches.map((branch) => ({
      id: `remote:${branch.fullName}`,
      label: branch.name,
      detail: branch.remote,
      kind: 'remote' as const,
      scoreTarget: `${branch.name} ${branch.fullName}`,
      onSelect: () => onCheckoutRemoteBranch(branch.name)
    })) ?? [];

  return [...repoItems, ...branchItems, ...remoteItems];
}

function filterItems(items: QuickJumpItem[], query: string): QuickJumpItem[] {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return items.slice(0, 18);
  }

  return items
    .map((item) => ({ item, score: fuzzyScore(normalizedQuery, normalizeSearch(item.scoreTarget)) }))
    .filter((entry) => entry.score >= 0)
    .sort((first, second) => second.score - first.score || first.item.label.localeCompare(second.item.label))
    .slice(0, 18)
    .map((entry) => entry.item);
}

function fuzzyScore(query: string, target: string): number {
  let queryIndex = 0;
  let score = 0;

  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] !== query[queryIndex]) {
      continue;
    }

    score += index === queryIndex ? 4 : 1;
    queryIndex += 1;
  }

  return queryIndex === query.length ? score - target.length * 0.01 : -1;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
