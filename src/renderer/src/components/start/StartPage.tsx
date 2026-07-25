import type { FormEvent, ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CloudDownload,
  FolderGit2,
  FolderOpen,
  Globe2,
  HardDrive,
  PlusSquare,
  Search
} from 'lucide-react';

import type { RepositoryCloneInput, RepositoryInitializeInput } from '@shared/ipc';
import type { RecentRepository } from '@shared/types';
import {
  cloneDirectoryNameFromSource,
  filterRecentRepositories,
  githubCloneUrl
} from './startPageHelpers';

type StartPageMode = 'home' | 'clone' | 'initialize';
type CloneSource = 'url' | 'github';

type StartPageProps = {
  isLoading: boolean;
  recentRepos: RecentRepository[];
  onOpenRepository: () => Promise<boolean>;
  onOpenRecentRepository: (repoPath: string) => Promise<boolean>;
  onChooseParentDirectory: () => Promise<string | undefined>;
  onInitializeRepository: (input: RepositoryInitializeInput) => Promise<boolean>;
  onCloneRepository: (input: RepositoryCloneInput) => Promise<boolean>;
};

export function StartPage({
  isLoading,
  recentRepos,
  onOpenRepository,
  onOpenRecentRepository,
  onChooseParentDirectory,
  onInitializeRepository,
  onCloneRepository
}: StartPageProps): ReactElement {
  const [mode, setMode] = useState<StartPageMode>('home');
  const [search, setSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [repositoryName, setRepositoryName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [initializeParent, setInitializeParent] = useState('');
  const [cloneSource, setCloneSource] = useState<CloneSource>('url');
  const [cloneValue, setCloneValue] = useState('');
  const [cloneDirectoryName, setCloneDirectoryName] = useState('');
  const [cloneParent, setCloneParent] = useState('');
  const filteredRepos = useMemo(
    () => filterRecentRepositories(recentRepos, search),
    [recentRepos, search]
  );
  const normalizedCloneUrl =
    cloneSource === 'github' ? githubCloneUrl(cloneValue) : cloneValue.trim() || undefined;
  const initializeIsValid =
    repositoryName.trim().length > 0 &&
    initializeParent.trim().length > 0 &&
    defaultBranch.trim().length > 0;
  const cloneIsValid = Boolean(normalizedCloneUrl && cloneParent.trim());
  const busy = isLoading || isSubmitting;

  async function chooseParent(setParent: (value: string) => void): Promise<void> {
    const selectedDirectory = await onChooseParentDirectory();

    if (selectedDirectory) {
      setParent(selectedDirectory);
    }
  }

  async function handleOpenRepository(): Promise<void> {
    setIsSubmitting(true);
    const opened = await onOpenRepository();

    if (!opened) {
      setIsSubmitting(false);
    }
  }

  async function handleOpenRecent(repoPath: string): Promise<void> {
    setIsSubmitting(true);
    const opened = await onOpenRecentRepository(repoPath);

    if (!opened) {
      setIsSubmitting(false);
    }
  }

  async function handleInitialize(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!initializeIsValid || busy) {
      return;
    }

    setIsSubmitting(true);
    const initialized = await onInitializeRepository({
      parentDirectory: initializeParent.trim(),
      name: repositoryName.trim(),
      defaultBranch: defaultBranch.trim()
    });

    if (!initialized) {
      setIsSubmitting(false);
    }
  }

  async function handleClone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!cloneIsValid || !normalizedCloneUrl || busy) {
      return;
    }

    setIsSubmitting(true);
    const cloned = await onCloneRepository({
      parentDirectory: cloneParent.trim(),
      sourceUrl: normalizedCloneUrl,
      directoryName: cloneDirectoryName.trim() || undefined
    });

    if (!cloned) {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      className="min-w-0 flex-1 overflow-y-auto bg-[var(--bg-graph)] px-8 py-10"
      data-testid="repository-start-page"
    >
      <div className={`mx-auto w-full ${mode === 'home' ? 'max-w-4xl' : 'max-w-5xl'}`}>
        {mode === 'home' ? (
          <>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-2)]">
                New Tab
              </p>
              <h1 className="mt-1 text-[30px] font-semibold tracking-tight text-[var(--text-1)]">
                Repositories
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[var(--text-3)]">
                Open something local, bring down a remote project, or start a new repository.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <RepositoryAction
                icon={<FolderOpen size={23} />}
                title="Open"
                description="Choose an existing Git repository on this Mac."
                disabled={busy}
                onClick={() => void handleOpenRepository()}
              />
              <RepositoryAction
                icon={<CloudDownload size={23} />}
                title="Clone"
                description="Clone with a URL or from GitHub.com."
                disabled={busy}
                onClick={() => setMode('clone')}
              />
              <RepositoryAction
                icon={<PlusSquare size={23} />}
                title="Create"
                description="Initialize a new local Git repository."
                disabled={busy}
                onClick={() => setMode('initialize')}
              />
            </div>

            <div className="relative mt-5">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]"
              />
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] pl-10 pr-3 text-[13px] text-[var(--text-1)] outline-none transition placeholder:text-[var(--text-3)] focus:border-[var(--accent-2)]"
                type="search"
                value={search}
                placeholder="Search repositories"
                aria-label="Search repositories"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                <h2 className="text-[15px] font-semibold text-[var(--text-1)]">Recent</h2>
                {recentRepos.length > 0 ? (
                  <span className="text-[11px] text-[var(--text-3)]">
                    {filteredRepos.length} {filteredRepos.length === 1 ? 'repository' : 'repositories'}
                  </span>
                ) : null}
              </div>

              {filteredRepos.length > 0 ? (
                <div className="divide-y divide-[var(--border)]" data-testid="recent-repositories">
                  {filteredRepos.map((repo) => (
                    <button
                      key={repo.path}
                      className="group flex w-full min-w-0 items-center gap-3 px-2 py-3 text-left transition hover:bg-[var(--bg-surface)]"
                      type="button"
                      title={repo.path}
                      disabled={busy}
                      onClick={() => void handleOpenRecent(repo.path)}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent-2)] transition group-hover:border-[var(--border-strong)]">
                        <FolderGit2 size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[var(--text-1)]">
                          {repo.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
                          {repo.path}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--text-3)]">
                        {formatRelative(repo.lastOpenedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-20 place-items-center rounded-b-md border-x border-b border-[var(--border)] bg-[var(--bg-app)] px-6 text-center">
                  <div>
                    <HardDrive size={20} className="mx-auto text-[var(--text-3)]" />
                    <p className="mt-2 text-[13px] font-medium text-[var(--text-2)]">
                      {recentRepos.length === 0 ? 'No recent repositories yet' : 'No repositories match your search'}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-3)]">
                      {recentRepos.length === 0
                        ? 'Repositories you open will appear here.'
                        : 'Try a repository name or part of its path.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : mode === 'initialize' ? (
          <RepositoryFormHeader
            eyebrow="Local only"
            title="Initialize a repository"
            description="Create a new Git repository on this Mac. No remote service is required."
            onBack={() => setMode('home')}
          >
            <form className="mt-8 max-w-3xl" onSubmit={(event) => void handleInitialize(event)}>
              <FormRow label="Name" htmlFor="repository-name">
                <input
                  id="repository-name"
                  className="repository-start-input"
                  value={repositoryName}
                  placeholder="my-project"
                  autoFocus
                  disabled={busy}
                  onChange={(event) => setRepositoryName(event.target.value)}
                />
              </FormRow>
              <FormRow label="Initialize in" htmlFor="initialize-parent">
                <DirectoryField
                  id="initialize-parent"
                  value={initializeParent}
                  disabled={busy}
                  onChange={setInitializeParent}
                  onBrowse={() => void chooseParent(setInitializeParent)}
                />
              </FormRow>
              <FormRow label="Full path">
                <output className="block min-h-10 break-all rounded-md border border-transparent px-3 py-2.5 font-mono text-[12px] text-[var(--text-2)]">
                  {joinDisplayPath(initializeParent, repositoryName) || 'Choose a location and enter a name'}
                </output>
              </FormRow>
              <FormRow label="Default branch" htmlFor="default-branch">
                <input
                  id="default-branch"
                  className="repository-start-input"
                  value={defaultBranch}
                  disabled={busy}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                />
              </FormRow>
              <FormActions
                busy={busy}
                disabled={!initializeIsValid}
                submitLabel="Create repository"
                onCancel={() => setMode('home')}
              />
            </form>
          </RepositoryFormHeader>
        ) : (
          <RepositoryFormHeader
            eyebrow="Remote repository"
            title="Clone a repository"
            description="Clone directly from any Git URL or use a GitHub.com owner/repository name."
            onBack={() => setMode('home')}
          >
            <form className="mt-8 max-w-3xl" onSubmit={(event) => void handleClone(event)}>
              <div
                className="mb-7 grid grid-cols-2 rounded-md border border-[var(--border)] bg-[var(--bg-field)] p-1"
                aria-label="Clone source"
              >
                <SourceOption
                  active={cloneSource === 'url'}
                  icon={<CloudDownload size={15} />}
                  label="Clone with URL"
                  onClick={() => setCloneSource('url')}
                />
                <SourceOption
                  active={cloneSource === 'github'}
                  icon={<Globe2 size={15} />}
                  label="GitHub.com"
                  onClick={() => setCloneSource('github')}
                />
              </div>
              <FormRow label="Clone into" htmlFor="clone-parent">
                <DirectoryField
                  id="clone-parent"
                  value={cloneParent}
                  disabled={busy}
                  onChange={setCloneParent}
                  onBrowse={() => void chooseParent(setCloneParent)}
                />
              </FormRow>
              <FormRow
                label={cloneSource === 'github' ? 'Repository' : 'URL'}
                htmlFor="clone-source"
                hint={cloneSource === 'github' ? 'Use owner/repository or a GitHub.com URL.' : undefined}
              >
                <input
                  id="clone-source"
                  className="repository-start-input"
                  value={cloneValue}
                  placeholder={
                    cloneSource === 'github'
                      ? 'openai/openai-node'
                      : 'https://github.com/owner/repository.git'
                  }
                  autoFocus
                  disabled={busy}
                  onChange={(event) => setCloneValue(event.target.value)}
                />
              </FormRow>
              <FormRow
                label="Folder name"
                htmlFor="clone-directory-name"
                hint="Optional. Git will infer it from the repository when left blank."
              >
                <input
                  id="clone-directory-name"
                  className="repository-start-input"
                  value={cloneDirectoryName}
                  placeholder={cloneDirectoryNameFromSource(normalizedCloneUrl) || 'repository'}
                  disabled={busy}
                  onChange={(event) => setCloneDirectoryName(event.target.value)}
                />
              </FormRow>
              <FormActions
                busy={busy}
                disabled={!cloneIsValid}
                submitLabel="Clone repository"
                onCancel={() => setMode('home')}
              />
            </form>
          </RepositoryFormHeader>
        )}
      </div>
    </section>
  );
}

function RepositoryAction({
  icon,
  title,
  description,
  disabled,
  onClick
}: {
  icon: ReactElement;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className="group flex h-16 w-44 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 text-left shadow-sm transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-2)] disabled:opacity-60"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-field)] text-[var(--accent-2)] transition group-hover:border-[var(--accent)]">
        {icon}
      </span>
      <span>
        <span className="block text-[16px] font-semibold text-[var(--text-1)]">{title}</span>
        <span className="sr-only">{description}</span>
      </span>
    </button>
  );
}

function RepositoryFormHeader({
  eyebrow,
  title,
  description,
  onBack,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  onBack: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <>
      <button className="btn-subtle h-8" type="button" onClick={onBack}>
        <ArrowLeft size={14} />
        Repositories
      </button>
      <div className="mt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-2)]">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight text-[var(--text-1)]">{title}</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[var(--text-3)]">{description}</p>
      </div>
      {children}
    </>
  );
}

function FormRow({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="mb-5 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start">
      <div className="pt-2.5 sm:text-right">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-[var(--text-2)]">
          {label}
        </label>
        {hint ? <p className="mt-1 text-[10px] leading-4 text-[var(--text-3)]">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function DirectoryField({
  id,
  value,
  disabled,
  onChange,
  onBrowse
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onBrowse: () => void;
}): ReactElement {
  return (
    <div className="flex gap-2">
      <input
        id={id}
        className="repository-start-input min-w-0 flex-1"
        value={value}
        placeholder="/Users/you/Projects"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button className="btn-subtle h-10 shrink-0" type="button" disabled={disabled} onClick={onBrowse}>
        <FolderOpen size={14} />
        Browse
      </button>
    </div>
  );
}

function FormActions({
  busy,
  disabled,
  submitLabel,
  onCancel
}: {
  busy: boolean;
  disabled: boolean;
  submitLabel: string;
  onCancel: () => void;
}): ReactElement {
  return (
    <div className="mt-8 flex justify-end gap-2 border-t border-[var(--border)] pt-5">
      <button className="btn-subtle h-9" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button className="btn-primary h-9" type="submit" disabled={disabled || busy}>
        {busy ? 'Working…' : submitLabel}
      </button>
    </div>
  );
}

function SourceOption({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className="flex h-9 items-center justify-center gap-2 rounded text-[12px] font-semibold transition"
      style={{
        background: active ? 'var(--control-active-bg)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--control-active-border)' : 'none',
        color: active ? 'var(--text-1)' : 'var(--text-3)'
      }}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function joinDisplayPath(parentDirectory: string, name: string): string {
  const normalizedParent = parentDirectory.trim().replace(/\/+$/u, '');
  const normalizedName = name.trim();

  if (!normalizedParent) {
    return '';
  }

  return normalizedName ? `${normalizedParent}/${normalizedName}` : `${normalizedParent}/`;
}

function formatRelative(isoDate: string): string {
  const elapsedMs = Date.now() - new Date(isoDate).getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '';
  }

  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 30) {
    return `${days}d ago`;
  }

  return new Date(isoDate).toLocaleDateString();
}
