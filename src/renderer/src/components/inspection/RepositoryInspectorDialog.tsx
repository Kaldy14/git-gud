import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileClock,
  FileSearch,
  GitCompareArrows,
  GitCommit,
  Loader2,
  SearchCode,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import type {
  GitComparison,
  GitFileBlame,
  GitFileHistory,
  GitRepositoryOverview
} from '@shared/types';

export type RepositoryInspectorMode = 'history' | 'blame' | 'compare';

export type RepositoryInspectorDialogProps = {
  repoPath: string;
  initialMode?: RepositoryInspectorMode;
  initialPath?: string;
  refs?: GitRepositoryOverview['refs'];
  onSelectCommit: (sha: string) => void;
  onClose: () => void;
};

type Loadable<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

const INSPECTOR_MODES: Array<{
  id: RepositoryInspectorMode;
  label: string;
  description: string;
  icon: ReactElement;
}> = [
  { id: 'history', label: 'File History', description: 'Commits that changed a path', icon: <FileClock size={14} /> },
  { id: 'blame', label: 'Blame', description: 'Line-by-line attribution', icon: <SearchCode size={14} /> },
  { id: 'compare', label: 'Compare', description: 'Refs, stats, and changed files', icon: <GitCompareArrows size={14} /> }
];

export function RepositoryInspectorDialog({
  repoPath,
  initialMode = 'history',
  initialPath = '',
  refs,
  onSelectCommit,
  onClose
}: RepositoryInspectorDialogProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const refSuggestionsId = useId();
  const initialRequestStartedRef = useRef(false);
  const [mode, setMode] = useState<RepositoryInspectorMode>(initialMode);
  const [path, setPath] = useState(initialPath);
  const [revision, setRevision] = useState('');
  const [base, setBase] = useState('HEAD~1');
  const [head, setHead] = useState('HEAD');
  const [history, setHistory] = useState<Loadable<GitFileHistory>>({ status: 'idle' });
  const [blame, setBlame] = useState<Loadable<GitFileBlame>>({ status: 'idle' });
  const [comparison, setComparison] = useState<Loadable<GitComparison>>({ status: 'idle' });
  const refSuggestions = referenceSuggestions(refs);

  useEffect(() => {
    if (initialRequestStartedRef.current || !initialPath.trim()) {
      return;
    }

    initialRequestStartedRef.current = true;

    if (initialMode === 'blame') {
      void loadBlame(initialPath, revision);
    } else if (initialMode === 'history') {
      void loadHistory(initialPath);
    }
    // Initial inspection intentionally runs only once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHistory(nextPath: string): Promise<void> {
    if (!nextPath.trim()) {
      setHistory({ status: 'error', message: 'Enter a repository-relative file path.' });
      return;
    }

    setHistory({ status: 'loading' });

    try {
      const data = await window.api.getFileHistory(repoPath, nextPath, 250);
      setHistory({ status: 'success', data });
    } catch (error) {
      setHistory({ status: 'error', message: errorMessage(error, 'Unable to load file history.') });
    }
  }

  async function loadBlame(nextPath: string, nextRevision: string): Promise<void> {
    if (!nextPath.trim()) {
      setBlame({ status: 'error', message: 'Enter a repository-relative file path.' });
      return;
    }

    setBlame({ status: 'loading' });

    try {
      const data = await window.api.getFileBlame(repoPath, nextPath, nextRevision.trim() || undefined);
      setBlame({ status: 'success', data });
    } catch (error) {
      setBlame({ status: 'error', message: errorMessage(error, 'Unable to load blame data.') });
    }
  }

  async function loadComparison(nextBase: string, nextHead: string): Promise<void> {
    const normalizedBase = nextBase.trim();
    const normalizedHead = nextHead.trim();

    if (!normalizedBase || !normalizedHead) {
      setComparison({ status: 'error', message: 'Enter both a base and a head reference.' });
      return;
    }

    if (normalizedBase === normalizedHead) {
      setComparison({ status: 'error', message: 'Base and head must be different references.' });
      return;
    }

    setComparison({ status: 'loading' });

    try {
      const data = await window.api.compareRefs(repoPath, normalizedBase, normalizedHead);
      setComparison({ status: 'success', data });
    } catch (error) {
      setComparison({ status: 'error', message: errorMessage(error, 'Unable to compare references.') });
    }
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="flex h-[min(760px,88vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
      onClose={onClose}
    >
      <header className="flex min-h-13 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2">
        <FileSearch size={17} className="shrink-0 text-[var(--accent-2)]" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--text-1)]">Repository Inspector</h2>
          <p id={descriptionId} className="mt-0.5 truncate text-[11px] text-[var(--text-3)]" title={repoPath}>
            {repoPath}
          </p>
        </div>
        <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close repository inspector">
          <X size={14} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[184px_minmax(0,1fr)] max-[700px]:grid-cols-1">
        <nav className="border-r border-[var(--border)] bg-[var(--bg-sidebar)] p-2 max-[700px]:border-b max-[700px]:border-r-0" aria-label="Inspection mode">
          <div className="grid gap-1 max-[700px]:grid-cols-3" role="tablist">
            {INSPECTOR_MODES.map((item, index) => (
              <button
                key={item.id}
                id={`${titleId}-${item.id}-tab`}
                className="flex min-w-0 items-start gap-2 rounded px-2.5 py-2 text-left text-xs text-[var(--text-2)] hover:bg-[var(--bg-hover)] data-[active=true]:bg-[var(--select-bg)] data-[active=true]:text-[var(--text-1)]"
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                aria-controls={`${titleId}-${item.id}-panel`}
                tabIndex={mode === item.id ? 0 : -1}
                data-active={mode === item.id}
                onClick={() => setMode(item.id)}
                onKeyDown={(event) => handleModeTabKeyDown(event, index, titleId, setMode)}
              >
                <span className="mt-0.5 shrink-0 text-[var(--accent-2)]">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block font-semibold">{item.label}</span>
                  <span className="mt-0.5 block leading-4 text-[10.5px] text-[var(--text-3)] max-[700px]:hidden">{item.description}</span>
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="min-h-0 min-w-0 overflow-hidden">
          {mode === 'history' ? (
            <HistoryPanel
              panelId={`${titleId}-history-panel`}
              tabId={`${titleId}-history-tab`}
              path={path}
              state={history}
              onChangePath={setPath}
              onLoad={() => void loadHistory(path)}
              onSelectCommit={(sha) => {
                onSelectCommit(sha);
                onClose();
              }}
            />
          ) : mode === 'blame' ? (
            <BlamePanel
              panelId={`${titleId}-blame-panel`}
              tabId={`${titleId}-blame-tab`}
              path={path}
              revision={revision}
              state={blame}
              refSuggestionsId={refSuggestionsId}
              onChangePath={setPath}
              onChangeRevision={setRevision}
              onLoad={() => void loadBlame(path, revision)}
              onSelectCommit={(sha) => {
                onSelectCommit(sha);
                onClose();
              }}
            />
          ) : (
            <ComparePanel
              panelId={`${titleId}-compare-panel`}
              tabId={`${titleId}-compare-tab`}
              base={base}
              head={head}
              state={comparison}
              refSuggestionsId={refSuggestionsId}
              onChangeBase={setBase}
              onChangeHead={setHead}
              onLoad={() => void loadComparison(base, head)}
            />
          )}
        </div>
      </div>

      <datalist id={refSuggestionsId}>
        {refSuggestions.map((ref) => <option key={ref} value={ref} />)}
      </datalist>
    </ModalSurface>
  );
}

type InspectorPanelProps = {
  panelId: string;
  tabId: string;
};

function HistoryPanel({
  panelId,
  tabId,
  path,
  state,
  onChangePath,
  onLoad,
  onSelectCommit
}: InspectorPanelProps & {
  path: string;
  state: Loadable<GitFileHistory>;
  onChangePath: (path: string) => void;
  onLoad: () => void;
  onSelectCommit: (sha: string) => void;
}): ReactElement {
  return (
    <section id={panelId} className="flex h-full min-h-0 flex-col" role="tabpanel" aria-labelledby={tabId}>
      <InspectorForm onSubmit={onLoad}>
        <InspectorField label="Repository-relative path" className="min-w-0 flex-1">
          <input className="inspector-input" value={path} autoFocus placeholder="src/components/App.tsx" onChange={(event) => onChangePath(event.target.value)} />
        </InspectorField>
        <InspectorSubmitButton isLoading={state.status === 'loading'} label="Load History" />
      </InspectorForm>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LoadableRegion state={state} idle="Enter a file path to trace its history." empty={state.status === 'success' && state.data.commits.length === 0 ? 'No commits changed this path.' : undefined}>
          {state.status === 'success' && state.data.commits.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {state.data.commits.map((commit) => (
                <button key={commit.sha} className="flex w-full min-w-0 items-center gap-3 rounded-none px-4 py-2.5 text-left hover:bg-[var(--bg-hover)]" type="button" onClick={() => onSelectCommit(commit.sha)}>
                  <GitCommit size={14} className="shrink-0 text-[var(--accent-2)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--text-1)]">{commit.subject}</span>
                    <span className="mt-1 block truncate text-[11px] text-[var(--text-3)]">{commit.author.name || 'Unknown author'} · {formatDate(commit.authoredAt ?? commit.author.date)}</span>
                  </span>
                  <span className="mono shrink-0 text-[11px] text-[var(--text-3)]">{commit.shortSha}</span>
                </button>
              ))}
            </div>
          ) : null}
        </LoadableRegion>
      </div>
    </section>
  );
}

function BlamePanel({
  panelId,
  tabId,
  path,
  revision,
  state,
  refSuggestionsId,
  onChangePath,
  onChangeRevision,
  onLoad,
  onSelectCommit
}: InspectorPanelProps & {
  path: string;
  revision: string;
  state: Loadable<GitFileBlame>;
  refSuggestionsId: string;
  onChangePath: (path: string) => void;
  onChangeRevision: (revision: string) => void;
  onLoad: () => void;
  onSelectCommit: (sha: string) => void;
}): ReactElement {
  return (
    <section id={panelId} className="flex h-full min-h-0 flex-col" role="tabpanel" aria-labelledby={tabId}>
      <InspectorForm onSubmit={onLoad}>
        <InspectorField label="Repository-relative path" className="min-w-[220px] flex-1">
          <input className="inspector-input" value={path} autoFocus placeholder="src/components/App.tsx" onChange={(event) => onChangePath(event.target.value)} />
        </InspectorField>
        <InspectorField label="Revision (optional)" className="w-44">
          <input className="inspector-input mono" value={revision} list={refSuggestionsId} placeholder="HEAD" onChange={(event) => onChangeRevision(event.target.value)} />
        </InspectorField>
        <InspectorSubmitButton isLoading={state.status === 'loading'} label="Load Blame" />
      </InspectorForm>
      <div className="min-h-0 flex-1 overflow-auto">
        <LoadableRegion state={state} idle="Enter a file path to inspect line attribution." empty={state.status === 'success' && state.data.lines.length === 0 ? 'No blame lines were returned.' : undefined}>
          {state.status === 'success' && state.data.lines.length > 0 ? (
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-[var(--bg-graph-header)] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-3)]">
                <tr><th className="w-14 border-b border-r border-[var(--border)] px-2 py-1.5 text-right">Line</th><th className="w-24 border-b border-r border-[var(--border)] px-2 py-1.5">Commit</th><th className="w-40 border-b border-r border-[var(--border)] px-2 py-1.5">Author</th><th className="border-b border-[var(--border)] px-3 py-1.5">Content</th></tr>
              </thead>
              <tbody>
                {state.data.lines.map((line) => (
                  <tr key={`${line.lineNumber}:${line.sha}`} className="group hover:bg-[var(--bg-hover)]">
                    <td className="mono border-r border-[var(--border)] px-2 py-1 text-right text-[var(--text-3)]">{line.lineNumber}</td>
                    <td className="border-r border-[var(--border)] px-2 py-1"><button className="mono text-[var(--accent-2)] hover:underline" type="button" title={line.summary} onClick={() => onSelectCommit(line.sha)}>{line.shortSha}</button></td>
                    <td className="max-w-40 truncate border-r border-[var(--border)] px-2 py-1 text-[var(--text-2)]" title={line.author.email}>{line.author.name || 'Unknown'}</td>
                    <td className="mono whitespace-pre px-3 py-1 text-[var(--text-1)]">{line.content || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </LoadableRegion>
      </div>
    </section>
  );
}

function ComparePanel({
  panelId,
  tabId,
  base,
  head,
  state,
  refSuggestionsId,
  onChangeBase,
  onChangeHead,
  onLoad
}: InspectorPanelProps & {
  base: string;
  head: string;
  state: Loadable<GitComparison>;
  refSuggestionsId: string;
  onChangeBase: (base: string) => void;
  onChangeHead: (head: string) => void;
  onLoad: () => void;
}): ReactElement {
  return (
    <section id={panelId} className="flex h-full min-h-0 flex-col" role="tabpanel" aria-labelledby={tabId}>
      <InspectorForm onSubmit={onLoad}>
        <InspectorField label="Base" className="min-w-[160px] flex-1"><input className="inspector-input mono" value={base} autoFocus list={refSuggestionsId} onChange={(event) => onChangeBase(event.target.value)} /></InspectorField>
        <span className="mb-1 self-end pb-2 text-[var(--text-3)]" aria-hidden="true">…</span>
        <InspectorField label="Head" className="min-w-[160px] flex-1"><input className="inspector-input mono" value={head} list={refSuggestionsId} onChange={(event) => onChangeHead(event.target.value)} /></InspectorField>
        <InspectorSubmitButton isLoading={state.status === 'loading'} label="Compare" />
      </InspectorForm>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LoadableRegion state={state} idle="Choose two references to compare commits and files." empty={state.status === 'success' && state.data.files.length === 0 ? 'The selected references have no file differences.' : undefined}>
          {state.status === 'success' ? (
            <>
              <div className="grid grid-cols-5 border-b border-[var(--border)] bg-[var(--bg-graph-header)] text-center text-[11px]">
                <ComparisonStat label="Ahead" value={state.data.ahead} />
                <ComparisonStat label="Behind" value={state.data.behind} />
                <ComparisonStat label="Files" value={state.data.stats.filesChanged} />
                <ComparisonStat label="Added" value={state.data.stats.additions} tone="success" />
                <ComparisonStat label="Deleted" value={state.data.stats.deletions} tone="danger" />
              </div>
              {state.data.files.length > 0 ? (
                <div className="divide-y divide-[var(--border)]">
                  {state.data.files.map((file) => (
                    <div key={`${file.path}:${file.status}`} className="flex min-w-0 items-center gap-3 px-4 py-2 text-xs hover:bg-[var(--bg-hover)]">
                      <span className="w-20 shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-center text-[10px] uppercase text-[var(--text-3)]">{file.status}</span>
                      <span className="min-w-0 flex-1 truncate text-[var(--text-2)]" title={file.path}>{file.path}</span>
                      {file.originalPath ? <span className="max-w-48 truncate text-[11px] text-[var(--text-3)]" title={file.originalPath}>from {file.originalPath}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </LoadableRegion>
      </div>
    </section>
  );
}

function InspectorForm({ children, onSubmit }: { children: ReactElement | ReactElement[]; onSubmit: () => void }): ReactElement {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return <form className="flex flex-wrap items-end gap-3 border-b border-[var(--border)] px-4 py-3" onSubmit={handleSubmit}>{children}</form>;
}

function InspectorField({ label, className, children }: { label: string; className: string; children: ReactElement }): ReactElement {
  return <label className={`block ${className}`}><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">{label}</span>{children}</label>;
}

function InspectorSubmitButton({ isLoading, label }: { isLoading: boolean; label: string }): ReactElement {
  return <button className="btn-accent h-8 shrink-0 text-xs" type="submit" disabled={isLoading}>{isLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{label}</button>;
}

function LoadableRegion<T>({
  state,
  idle,
  empty,
  children
}: {
  state: Loadable<T>;
  idle: string;
  empty?: string;
  children: ReactElement | null;
}): ReactElement {
  if (state.status === 'loading') {
    return <InspectorMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading repository data…" />;
  }

  if (state.status === 'error') {
    return <InspectorMessage icon={<AlertCircle size={15} />} label={state.message} tone="danger" />;
  }

  if (empty) {
    return <InspectorMessage icon={<FileSearch size={15} />} label={empty} />;
  }

  if (state.status === 'idle') {
    return <InspectorMessage icon={<FileSearch size={15} />} label={idle} />;
  }

  return <>{children}</>;
}

function InspectorMessage({ icon, label, tone = 'default' }: { icon: ReactElement; label: string; tone?: 'default' | 'danger' }): ReactElement {
  return <div className={`grid min-h-56 place-items-center px-8 text-center text-xs leading-5 ${tone === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--text-3)]'}`} role={tone === 'danger' ? 'alert' : 'status'}><span className="flex max-w-lg items-center gap-2">{icon}{label}</span></div>;
}

function ComparisonStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'danger' }): ReactElement {
  const valueClass = tone === 'success' ? 'text-[var(--success-text)]' : tone === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--text-1)]';
  return <div className="border-r border-[var(--border)] px-2 py-2.5 last:border-r-0"><span className={`block text-sm font-semibold tabular-nums ${valueClass}`}>{value.toLocaleString()}</span><span className="mt-0.5 block text-[10px] uppercase tracking-[0.06em] text-[var(--text-3)]">{label}</span></div>;
}

function referenceSuggestions(refs: GitRepositoryOverview['refs'] | undefined): string[] {
  const suggestions = new Set<string>(['HEAD']);

  for (const branch of refs?.localBranches ?? []) {
    suggestions.add(branch.name);
  }

  for (const branch of refs?.remoteBranches ?? []) {
    suggestions.add(branch.name);
  }

  for (const tag of refs?.tags ?? []) {
    suggestions.add(tag.name);
  }

  return [...suggestions];
}

function handleModeTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  titleId: string,
  setMode: (mode: RepositoryInspectorMode) => void
): void {
  let nextIndex: number | undefined;

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % INSPECTOR_MODES.length;
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + INSPECTOR_MODES.length) % INSPECTOR_MODES.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = INSPECTOR_MODES.length - 1;
  }

  if (typeof nextIndex !== 'number') {
    return;
  }

  const nextMode = INSPECTOR_MODES[nextIndex]?.id;

  if (!nextMode) {
    return;
  }

  event.preventDefault();
  setMode(nextMode);
  window.requestAnimationFrame(() => document.getElementById(`${titleId}-${nextMode}-tab`)?.focus());
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return 'Date unknown';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unknown' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
