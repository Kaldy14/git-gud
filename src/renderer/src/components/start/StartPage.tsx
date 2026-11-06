import type { CSSProperties, FormEvent, ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CloudDownload,
  FolderGit2,
  FolderOpen,
  Globe2,
  PlusSquare,
  Search
} from 'lucide-react';

import type { RepositoryCloneInput, RepositoryInitializeInput } from '@shared/ipc';
import type { RecentRepository } from '@shared/types';
import {
  cloneDirectoryNameFromSource,
  cloneMissingInputHint,
  createMissingInputHint,
  filterRecentRepositories,
  githubCloneUrl
} from './startPageHelpers';
import { abbreviateHomePath } from '@renderer/lib/displayPath';

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
    <section className="start-page" data-testid="repository-start-page">
      {mode === 'home' ? (
        <div
          className="start-page-home"
          style={{ '--start-recent-rows': recentRepos.length } as CSSProperties}
        >
          <div>
            <h1 className="start-title">Start</h1>
            <div className="start-actions">
              <RepositoryAction
                icon={<FolderOpen size={15} />}
                title="Open…"
                description="Choose an existing Git repository on this Mac."
                shortcut="⌘O"
                disabled={busy}
                onClick={() => void handleOpenRepository()}
              />
              <RepositoryAction
                icon={<CloudDownload size={15} />}
                title="Clone…"
                description="Clone with a URL or from GitHub.com."
                disabled={busy}
                onClick={() => setMode('clone')}
              />
              <RepositoryAction
                icon={<PlusSquare size={15} />}
                title="Create…"
                description="Initialize a new local Git repository."
                disabled={busy}
                onClick={() => setMode('initialize')}
              />
            </div>
            <p className="start-drop-hint">Or drop a repository folder anywhere in this window.</p>
          </div>

          <div>
            <div className="start-recent-header">
              <h2 className="start-recent-title">Recent</h2>
              {recentRepos.length > 0 ? (
                <span className="start-recent-count">
                  {filteredRepos.length} {filteredRepos.length === 1 ? 'repository' : 'repositories'}
                </span>
              ) : null}
            </div>

            {recentRepos.length > 0 ? (
              <div className="start-search">
                <Search size={14} />
                <input
                  className="form-input"
                  type="search"
                  value={search}
                  placeholder="Search repositories"
                  aria-label="Search repositories"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            ) : null}

            {filteredRepos.length > 0 ? (
              <div className="start-recent-list" data-testid="recent-repositories">
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.path}
                    className="start-recent-row"
                    type="button"
                    title={repo.path}
                    disabled={busy}
                    onClick={() => void handleOpenRecent(repo.path)}
                  >
                    <FolderGit2 size={16} className="start-recent-icon" aria-hidden="true" />
                    <span className="start-recent-text">
                      <span className="start-recent-name">{repo.name}</span>
                      <span className="start-recent-path">{abbreviateHomePath(repo.path)}</span>
                    </span>
                    <span className="start-recent-age">{formatRelative(repo.lastOpenedAt)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="start-empty">
                <p className="start-empty-title">
                  {recentRepos.length === 0 ? 'No recent repositories yet' : 'No repositories match your search'}
                </p>
                <p className="start-empty-hint">
                  {recentRepos.length === 0
                    ? 'Repositories you open will appear here.'
                    : 'Try a repository name or part of its path.'}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : mode === 'initialize' ? (
        <RepositoryFormHeader
          title="Create a repository"
          description="Create a new Git repository on this Mac. No remote service is required."
          onBack={() => setMode('home')}
        >
          <form className="start-form" onSubmit={(event) => void handleInitialize(event)}>
            <FormRow label="Name" htmlFor="repository-name">
              <input
                id="repository-name"
                className="form-input"
                value={repositoryName}
                placeholder="my-project"
                autoFocus
                disabled={busy}
                onChange={(event) => setRepositoryName(event.target.value)}
              />
            </FormRow>
            <FormRow label="Location" htmlFor="initialize-parent">
              <DirectoryField
                id="initialize-parent"
                value={initializeParent}
                disabled={busy}
                onChange={setInitializeParent}
                onBrowse={() => void chooseParent(setInitializeParent)}
              />
            </FormRow>
            {initializeParent.trim() ? (
              <FormRow label="Full path">
                <output className="start-path-preview">{joinDisplayPath(initializeParent, repositoryName)}</output>
              </FormRow>
            ) : null}
            <FormRow label="Default branch" htmlFor="default-branch">
              <input
                id="default-branch"
                className="form-input"
                value={defaultBranch}
                disabled={busy}
                onChange={(event) => setDefaultBranch(event.target.value)}
              />
            </FormRow>
            <FormActions
              busy={busy}
              disabled={!initializeIsValid}
              missingHint={createMissingInputHint(repositoryName, initializeParent, defaultBranch)}
              submitLabel="Create repository"
              onCancel={() => setMode('home')}
            />
          </form>
        </RepositoryFormHeader>
      ) : (
        <RepositoryFormHeader
          title="Clone a repository"
          description="Clone directly from any Git URL or use a GitHub.com owner/repository name."
          onBack={() => setMode('home')}
        >
          <form className="start-form" onSubmit={(event) => void handleClone(event)}>
            <div className="segmented segmented--fill" role="group" aria-label="Clone source">
              <SourceOption
                active={cloneSource === 'url'}
                icon={<CloudDownload size={14} />}
                label="Clone with URL"
                onClick={() => setCloneSource('url')}
              />
              <SourceOption
                active={cloneSource === 'github'}
                icon={<Globe2 size={14} />}
                label="GitHub.com"
                onClick={() => setCloneSource('github')}
              />
            </div>
            <FormRow
              label={cloneSource === 'github' ? 'Repository' : 'URL'}
              htmlFor="clone-source"
              hint={cloneSource === 'github' ? 'Use owner/repository or a GitHub.com URL.' : undefined}
            >
              <input
                id="clone-source"
                className="form-input"
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
              label="Folder name"
              htmlFor="clone-directory-name"
              hint="Optional. Git will infer it from the repository when left blank."
            >
              <input
                id="clone-directory-name"
                className="form-input"
                value={cloneDirectoryName}
                placeholder={cloneDirectoryNameFromSource(normalizedCloneUrl) || 'repository'}
                disabled={busy}
                onChange={(event) => setCloneDirectoryName(event.target.value)}
              />
            </FormRow>
            <FormActions
              busy={busy}
              disabled={!cloneIsValid}
              missingHint={cloneMissingInputHint(cloneSource, normalizedCloneUrl, cloneValue, cloneParent)}
              submitLabel="Clone repository"
              onCancel={() => setMode('home')}
            />
          </form>
        </RepositoryFormHeader>
      )}
    </section>
  );
}

function RepositoryAction({
  icon,
  title,
  description,
  shortcut,
  disabled,
  onClick
}: {
  icon: ReactElement;
  title: string;
  description: string;
  shortcut?: string;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  // A compact row: the description moves to the tooltip and accessible description.
  return (
    <button className="start-action" type="button" title={description} disabled={disabled} onClick={onClick}>
      <span className="start-action-icon">{icon}</span>
      <span className="start-action-title">{title}</span>
      <span className="sr-only">{description}</span>
      {shortcut ? <kbd className="start-action-shortcut">{shortcut}</kbd> : null}
    </button>
  );
}

function RepositoryFormHeader({
  title,
  description,
  onBack,
  children
}: {
  title: string;
  description: string;
  onBack: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="start-form-view">
      <button className="start-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} />
        Repositories
      </button>
      <h1 className="start-title">{title}</h1>
      <p className="start-form-description">{description}</p>
      {children}
    </div>
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
    <div className="start-field">
      <label htmlFor={htmlFor} className="start-field-label">
        {label}
      </label>
      {children}
      {hint ? <p className="start-field-hint">{hint}</p> : null}
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
    <div className="start-directory-field">
      <input
        id={id}
        className="form-input min-w-0 flex-1"
        value={value}
        placeholder="/Users/you/Projects"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button className="btn-subtle h-[34px] shrink-0 text-xs" type="button" disabled={disabled} onClick={onBrowse}>
        <FolderOpen size={14} />
        Browse
      </button>
    </div>
  );
}

function FormActions({
  busy,
  disabled,
  missingHint,
  submitLabel,
  onCancel
}: {
  busy: boolean;
  disabled: boolean;
  missingHint?: string;
  submitLabel: string;
  onCancel: () => void;
}): ReactElement {
  return (
    <div className="start-form-actions">
      {missingHint ? <p className="start-field-hint start-form-missing" role="status">{missingHint}</p> : null}
      <button className="btn-subtle btn-regular" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button className="btn-primary" type="submit" disabled={disabled || busy}>
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
    <button type="button" aria-pressed={active} data-active={active} onClick={onClick}>
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
