import type { GitRemote } from '@shared/types';

export const AUTO_FETCH_STALE_AFTER_MS = 5 * 60 * 1000;
export type AutoFetchResult = 'skipped' | 'succeeded' | 'failed';

type RepositoryFetchState = {
  lastFetchedAt?: string;
  remotes: GitRemote[];
};

type AutoFetchRepositoryOptions = {
  loadRepository: () => Promise<RepositoryFetchState>;
  fetchRepository: () => Promise<boolean>;
  now?: number;
};

export async function autoFetchRepositoryOnTabActivation({
  loadRepository,
  fetchRepository,
  now = Date.now()
}: AutoFetchRepositoryOptions): Promise<AutoFetchResult> {
  const repository = await loadRepository();

  if (!shouldAutoFetchRepository(repository, now)) {
    return 'skipped';
  }

  return (await fetchRepository()) ? 'succeeded' : 'failed';
}

type CommonDirectoryRepository = {
  commonDir: string;
};

type AutoFetchRequest<TRepository> = {
  repository: TRepository;
  run: (repository: TRepository) => Promise<AutoFetchResult>;
};

export function createRepositoryAutoFetchCoordinator<
  TRepository extends CommonDirectoryRepository
>() {
  const inFlight = new Map<string, Promise<AutoFetchResult>>();
  const queued = new Map<string, AutoFetchRequest<TRepository>>();

  function schedule(
    repository: TRepository,
    run: (repository: TRepository) => Promise<AutoFetchResult>
  ): void {
    const commonDir = repository.commonDir;

    if (inFlight.has(commonDir)) {
      queued.set(commonDir, { repository, run });
      return;
    }

    const request = run(repository).catch((): AutoFetchResult => 'failed');
    inFlight.set(commonDir, request);
    void request.then((result) => {
      if (inFlight.get(commonDir) !== request) {
        return;
      }

      inFlight.delete(commonDir);
      const next = queued.get(commonDir);
      queued.delete(commonDir);

      if (next && result === 'failed') {
        schedule(next.repository, next.run);
      }
    });
  }

  return { schedule };
}

export function shouldAutoFetchRepository(
  repository: RepositoryFetchState,
  now = Date.now()
): boolean {
  if (repository.remotes.length === 0) {
    return false;
  }

  if (!repository.lastFetchedAt) {
    return true;
  }

  const lastFetchedAt = Date.parse(repository.lastFetchedAt);
  return Number.isNaN(lastFetchedAt) || now - lastFetchedAt >= AUTO_FETCH_STALE_AFTER_MS;
}
