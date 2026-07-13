import type { ReactElement } from 'react';
import { FolderGit2, FolderOpen, GitCommitVertical } from 'lucide-react';

import type { RecentRepository } from '@shared/types';

type StartPageProps = {
  isLoading: boolean;
  recentRepos: RecentRepository[];
  onOpenRepository: () => void;
  onOpenRecentRepository: (repoPath: string) => void;
};

export function StartPage({
  isLoading,
  recentRepos,
  onOpenRepository,
  onOpenRecentRepository
}: StartPageProps): ReactElement {
  return (
    <section className="grid min-w-0 flex-1 place-items-center overflow-y-auto bg-[var(--bg-graph)] px-8 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <div
            className="mb-5 grid h-16 w-16 place-items-center rounded-2xl shadow-lg shadow-black/40"
            style={{ background: 'linear-gradient(135deg, var(--accent-2), var(--accent))' }}
          >
            <GitCommitVertical size={32} className="text-[var(--avatar-fg)]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-1)]">Git Gud</h1>
          <p className="mt-1.5 text-[13px] text-[var(--text-2)]">
            {isLoading ? 'Restoring your workspace…' : 'A fast, local-first Git client for macOS.'}
          </p>
          <button className="btn-primary mt-6" type="button" onClick={onOpenRepository}>
            <FolderOpen size={15} />
            Open repository
          </button>
        </div>

        {recentRepos.length > 0 ? (
          <div className="mt-10">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
              Recent repositories
            </p>
            <div className="space-y-1.5">
              {recentRepos.slice(0, 6).map((repo) => (
                <button
                  key={repo.path}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-2)]"
                  type="button"
                  title={repo.path}
                  onClick={() => onOpenRecentRepository(repo.path)}
                >
                  <FolderGit2 size={16} className="shrink-0 text-[var(--accent-2)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[var(--text-1)]">{repo.name}</span>
                    <span className="block truncate text-[11px] text-[var(--text-3)]">{repo.path}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--text-3)]">{formatRelative(repo.lastOpenedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
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
