import { access } from 'node:fs/promises';
import path from 'node:path';

import { shell } from 'electron';

import { createCodexTaskDeepLink } from '@shared/codex';
import type { GitOperationResult, RepoTab } from '@shared/types';

type FileTab = Pick<RepoTab, 'path'>;
type CodexTab = Pick<RepoTab, 'path' | 'gitDir' | 'commonDir'>;

export async function openRepositoryFileInEditor(tab: FileTab, relativePath: string): Promise<GitOperationResult> {
  const targetPath = resolveRepositoryChildPath(tab.path, relativePath);
  await access(targetPath);
  const errorMessage = await shell.openPath(targetPath);

  if (errorMessage) {
    throw new Error('Unable to open file.');
  }

  return createSystemOperationResult(tab.path);
}

export async function revealRepositoryFileInFinder(tab: FileTab, relativePath: string): Promise<GitOperationResult> {
  const targetPath = resolveRepositoryChildPath(tab.path, relativePath);
  const revealPath = await findNearestExistingPath(targetPath, tab.path);
  shell.showItemInFolder(revealPath);

  return createSystemOperationResult(tab.path);
}

export async function openCodexTaskForRepository(tab: CodexTab, prompt: string): Promise<void> {
  if (!path.isAbsolute(tab.path)) {
    throw new Error('Codex workspace path must be absolute.');
  }

  const projectPath = resolveCodexProjectPath(tab);
  const taskPrompt = addCodexWorktreeContext(prompt, tab.path, projectPath);

  await Promise.all([access(tab.path), access(projectPath)]);
  await shell.openExternal(createCodexTaskDeepLink(projectPath, taskPrompt));
}

export function resolveCodexProjectPath(tab: CodexTab): string {
  const repositoryPath = path.resolve(tab.path);
  const gitDir = path.resolve(tab.gitDir);
  const commonDir = path.resolve(tab.commonDir);

  if (gitDir === commonDir || path.basename(commonDir) !== '.git') {
    return repositoryPath;
  }

  return path.dirname(commonDir);
}

export function addCodexWorktreeContext(prompt: string, worktreePath: string, projectPath: string): string {
  const normalizedWorktreePath = path.resolve(worktreePath);

  if (normalizedWorktreePath === path.resolve(projectPath)) {
    return prompt;
  }

  return [
    'Use the existing Git worktree below as the working directory for this task.',
    `Worktree: ${JSON.stringify(normalizedWorktreePath)}`,
    'Run all repository reads, edits, Git commands, and validation there. Do not create a new worktree or modify the primary checkout.',
    prompt
  ].join('\n\n');
}

function resolveRepositoryChildPath(repoPath: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('A repository-relative file path is required.');
  }

  const repoRoot = path.resolve(repoPath);
  const targetPath = path.resolve(repoRoot, relativePath);
  const repoRootPrefix = `${repoRoot}${path.sep}`;

  if (targetPath !== repoRoot && !targetPath.startsWith(repoRootPrefix)) {
    throw new Error('File path must stay inside the repository.');
  }

  return targetPath;
}

async function findNearestExistingPath(targetPath: string, repoPath: string): Promise<string> {
  const repoRoot = path.resolve(repoPath);
  let candidate = targetPath;

  while (candidate.startsWith(repoRoot)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(candidate);

      if (parent === candidate) {
        break;
      }

      candidate = parent;
    }
  }

  return repoRoot;
}

function createSystemOperationResult(repoPath: string): GitOperationResult {
  return {
    repoPath,
    happenedAt: new Date().toISOString()
  };
}
