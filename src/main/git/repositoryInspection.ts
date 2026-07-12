import type {
  GitComparison,
  GitFileBlame,
  GitFileBlameLine,
  GitFileHistory,
  GitFileHistoryCommit,
  RepoTab
} from '@shared/types';

import pathModule from 'node:path';

import { createProfileCommandEnv } from '../profiles';
import { GitCommandError, GitOutputLimitError, gitExecutor } from './exec';
import { parseNameStatus, parseShortStat } from './parsers/details';

type InspectionTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

export type RepositoryInspectionErrorCode =
  | 'INVALID_PATH'
  | 'INVALID_REF'
  | 'OUTPUT_TOO_LARGE'
  | 'INVALID_GIT_OUTPUT';

export class RepositoryInspectionError extends Error {
  readonly code: RepositoryInspectionErrorCode;

  constructor(code: RepositoryInspectionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryInspectionError';
    this.code = code;
  }
}

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 500;
const MAX_BLAME_OUTPUT_BYTES = 8 * 1024 * 1024;
const HISTORY_FIELD_COUNT = 6;
const HISTORY_FORMAT = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%s';
const SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const BLAME_HEADER_PATTERN = /^(\^?[0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/;

export async function loadFileHistory(
  tab: InspectionTab,
  path: string,
  requestedLimit = DEFAULT_HISTORY_LIMIT
): Promise<GitFileHistory> {
  assertSafeRelativePath(path);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const limit = normalizeHistoryLimit(requestedLimit);
  const result = await gitExecutor.run(
    [
      '--literal-pathspecs',
      'log',
      '--follow',
      '--find-renames',
      '-z',
      `--max-count=${limit}`,
      `--format=${HISTORY_FORMAT}`,
      '--',
      path
    ],
    { cwd: tab.path, env }
  );

  return {
    repoPath: tab.path,
    path,
    commits: parseFileHistory(result.stdout),
    loadedAt: new Date().toISOString()
  };
}

export async function loadFileBlame(
  tab: InspectionTab,
  path: string,
  revision = 'HEAD'
): Promise<GitFileBlame> {
  assertSafeRelativePath(path);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const verifiedRevision = await verifyCommit(tab.path, revision, 'Revision', env);

  try {
    const result = await gitExecutor.run(
      ['--literal-pathspecs', 'blame', '--line-porcelain', verifiedRevision.sha, '--', path],
      {
        cwd: tab.path,
        env,
        maxStdoutBytes: MAX_BLAME_OUTPUT_BYTES
      }
    );

    return {
      repoPath: tab.path,
      path,
      revision: verifiedRevision.sha,
      lines: parseBlame(result.stdout),
      loadedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      throw new RepositoryInspectionError(
        'OUTPUT_TOO_LARGE',
        `Blame output for "${path}" exceeds the 8 MiB inspection limit. Narrow the file or revision before retrying.`,
        { cause: error }
      );
    }

    throw error;
  }
}

export async function loadComparison(
  tab: InspectionTab,
  base: string,
  head: string
): Promise<GitComparison> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const [verifiedBase, verifiedHead] = await Promise.all([
    verifyCommit(tab.path, base, 'Base', env),
    verifyCommit(tab.path, head, 'Head', env)
  ]);
  const range = `${verifiedBase.sha}...${verifiedHead.sha}`;
  const [countsResult, filesResult, statsResult] = await Promise.all([
    gitExecutor.run(['rev-list', '--left-right', '--count', range], { cwd: tab.path, env }),
    gitExecutor.run(['diff', '--name-status', '-z', '--find-renames', range], { cwd: tab.path, env }),
    gitExecutor.run(['diff', '--shortstat', range], { cwd: tab.path, env })
  ]);
  const { ahead, behind } = parseAheadBehind(countsResult.stdout);

  return {
    repoPath: tab.path,
    base: verifiedBase.input,
    head: verifiedHead.input,
    ahead,
    behind,
    stats: parseShortStat(statsResult.stdout),
    files: parseNameStatus(filesResult.stdout),
    loadedAt: new Date().toISOString()
  };
}

function parseFileHistory(output: string): GitFileHistoryCommit[] {
  if (!output) {
    return [];
  }

  const fields = output.split('\0');

  if (fields.at(-1) === '') {
    fields.pop();
  }

  if (fields.length % HISTORY_FIELD_COUNT !== 0) {
    throw invalidGitOutput('Git returned malformed file history metadata.');
  }

  const commits: GitFileHistoryCommit[] = [];

  for (let index = 0; index < fields.length; index += HISTORY_FIELD_COUNT) {
    const sha = fields[index] ?? '';
    const shortSha = fields[index + 1] ?? '';
    const authorName = fields[index + 2] ?? '';
    const authorEmail = fields[index + 3] ?? '';
    const authoredAt = fields[index + 4] || undefined;
    const subject = fields[index + 5] ?? '';

    if (!SHA_PATTERN.test(sha) || !shortSha || !authorName) {
      throw invalidGitOutput('Git returned invalid file history metadata.');
    }

    commits.push({
      sha,
      shortSha,
      subject,
      author: {
        name: authorName,
        email: authorEmail || undefined,
        date: authoredAt
      },
      authoredAt
    });
  }

  return commits;
}

function parseBlame(output: string): GitFileBlameLine[] {
  if (!output) {
    return [];
  }

  const rawLines = output.split('\n');
  const blameLines: GitFileBlameLine[] = [];
  let index = 0;

  while (index < rawLines.length) {
    const header = rawLines[index];
    index += 1;

    if (header === '') {
      continue;
    }

    const headerMatch = BLAME_HEADER_PATTERN.exec(header);

    if (!headerMatch?.[1] || !headerMatch[2] || !headerMatch[3]) {
      throw invalidGitOutput('Git returned malformed blame line metadata.');
    }

    const sha = headerMatch[1].replace(/^\^/, '');
    const originalLineNumber = Number.parseInt(headerMatch[2], 10);
    const lineNumber = Number.parseInt(headerMatch[3], 10);
    const metadata = new Map<string, string>();
    let content: string | undefined;

    while (index < rawLines.length) {
      const line = rawLines[index] ?? '';
      index += 1;

      if (line.startsWith('\t')) {
        content = line.slice(1);
        break;
      }

      const separatorIndex = line.indexOf(' ');

      if (separatorIndex > 0) {
        metadata.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
      }
    }

    if (!SHA_PATTERN.test(sha) || content === undefined) {
      throw invalidGitOutput('Git returned incomplete blame metadata.');
    }

    const authorEmail = stripAngleBrackets(metadata.get('author-mail'));
    const authoredAt = unixSecondsToIso(metadata.get('author-time'));

    blameLines.push({
      lineNumber,
      originalLineNumber,
      sha,
      shortSha: sha.slice(0, 8),
      author: {
        name: metadata.get('author') || 'Unknown',
        email: authorEmail,
        date: authoredAt
      },
      summary: metadata.get('summary') || undefined,
      content
    });
  }

  return blameLines;
}

function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const fields = output.trim().split(/\s+/);
  const behind = Number.parseInt(fields[0] ?? '', 10);
  const ahead = Number.parseInt(fields[1] ?? '', 10);

  if (!Number.isSafeInteger(ahead) || ahead < 0 || !Number.isSafeInteger(behind) || behind < 0) {
    throw invalidGitOutput('Git returned malformed ahead/behind counts.');
  }

  return { ahead, behind };
}

async function verifyCommit(
  repoPath: string,
  value: string,
  label: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<{ input: string; sha: string }> {
  const input = value.trim();

  if (!input || input.startsWith('-') || input.includes('\0')) {
    throw new RepositoryInspectionError('INVALID_REF', `${label} must be a valid commit reference.`);
  }

  try {
    const result = await gitExecutor.run(
      ['rev-parse', '--verify', '--end-of-options', `${input}^{commit}`],
      { cwd: repoPath, env }
    );
    const sha = result.stdout.trim();

    if (!SHA_PATTERN.test(sha)) {
      throw invalidGitOutput(`Git returned an invalid object id for ${label.toLowerCase()}.`);
    }

    return { input, sha };
  } catch (error) {
    if (error instanceof RepositoryInspectionError) {
      throw error;
    }

    if (error instanceof GitCommandError) {
      throw new RepositoryInspectionError(
        'INVALID_REF',
        `${label} "${input}" does not resolve to a commit.`,
        { cause: error }
      );
    }

    throw error;
  }
}

function normalizeHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.floor(limit)));
}

function assertSafeRelativePath(path: string): void {
  const normalizedPath = pathModule.normalize(path);

  if (
    !path ||
    path.includes('\0') ||
    pathModule.isAbsolute(path) ||
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith(`..${pathModule.sep}`)
  ) {
    throw new RepositoryInspectionError('INVALID_PATH', 'A safe repository-relative file path is required.');
  }
}

function stripAngleBrackets(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
}

function unixSecondsToIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(seconds)) {
    return undefined;
  }

  return new Date(seconds * 1000).toISOString();
}

function invalidGitOutput(message: string): RepositoryInspectionError {
  return new RepositoryInspectionError('INVALID_GIT_OUTPUT', message);
}
