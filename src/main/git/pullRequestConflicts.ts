import type {
  GitHubPullRequestConflictDetails,
  GitHubPullRequestConflictInput,
  RepoTab
} from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { gitExecutor } from './exec';

type PullRequestConflictTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

export async function loadPullRequestConflictDetails(
  tab: PullRequestConflictTab,
  input: GitHubPullRequestConflictInput
): Promise<GitHubPullRequestConflictDetails> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const revisionsAvailable = await Promise.all(
    [input.baseSha, input.headSha].map(async (sha) => {
      const result = await gitExecutor.run(
        ['cat-file', '-e', `${sha}^{commit}`],
        {
          cwd: tab.path,
          env,
          allowedExitCodes: [0, 1, 128]
        }
      );
      return result.exitCode === 0;
    })
  );

  if (revisionsAvailable.includes(false)) {
    return {
      files: [],
      unavailableReason: 'The base or head revision is not available in this local checkout.'
    };
  }

  try {
    const result = await gitExecutor.run(
      [
        'merge-tree',
        '--write-tree',
        '--name-only',
        '--no-messages',
        '-z',
        input.baseSha,
        input.headSha
      ],
      {
        cwd: tab.path,
        env,
        allowedExitCodes: [0, 1],
        maxStdoutBytes: 2 * 1024 * 1024
      }
    );

    return {
      files: result.exitCode === 1
        ? parseMergeTreeConflictPaths(result.stdout)
        : []
    };
  } catch {
    return {
      files: [],
      unavailableReason: 'Git could not calculate the conflicting files in this local checkout.'
    };
  }
}

export function parseMergeTreeConflictPaths(output: string): string[] {
  const [, ...paths] = output.split('\0');
  return [...new Set(paths.filter(Boolean))];
}
