import type { GitHubPullRequestSummary, GitReviewChunk } from './types';

/** Path-only kinds for a pull request's line breakdown (no patch needed, so the inbox can use it). */
export type ChangeKind = 'code' | 'tests' | 'docs' | 'config' | 'generated';

export type FileLineStat = {
  path: string;
  additions: number;
  deletions: number;
};

export type LineBreakdownRow = {
  /** `unlisted` holds whatever GitHub's totals cover beyond the files it returned. */
  kind: ChangeKind | 'unlisted';
  label: string;
  files: number;
  additions: number;
  deletions: number;
};

const KIND_LABELS: Record<LineBreakdownRow['kind'], string> = {
  code: 'Code',
  tests: 'Tests',
  docs: 'Docs',
  config: 'Config',
  generated: 'Generated',
  unlisted: 'Unlisted'
};

const KIND_ORDER: LineBreakdownRow['kind'][] = ['code', 'tests', 'docs', 'config', 'generated', 'unlisted'];

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'go.sum',
  'gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'flake.lock',
  'podfile.lock',
  'package.resolved'
]);

const DOC_EXTENSIONS = /\.(?:md|mdx|markdown|rst|adoc|asciidoc)$/;
const DOC_BASENAMES = /^(?:readme|changelog|contributing|license|licence|authors|notice|security)(?:\.[^/]*)?$/;
const CONFIG_EXTENSIONS = /\.(?:json|jsonc|json5|ya?ml|toml|ini|cfg|conf|properties|editorconfig|env)$/;
const CONFIG_BASENAMES = /^(?:dockerfile|containerfile|makefile|justfile|procfile|caddyfile|codeowners)(?:\.[^/]*)?$/;
const CONFIG_MODULES = /[._-]config\.[cm]?[jt]s$|^\.[^/]+rc\.[cm]?[jt]s$/;

function normalizePath(filePath: string): { segments: string[]; basename: string } {
  const segments = filePath.replaceAll('\\', '/').toLowerCase().split('/');
  return { segments, basename: segments.at(-1) ?? '' };
}

/** Shared with the Code tab's review plan so both views agree on what a test is. */
export function categorizeReviewPath(filePath: string): GitReviewChunk['category'] {
  const { segments, basename } = normalizePath(filePath);

  if (
    segments.some((segment) => segment === 'test' || segment === 'tests' || segment === '__tests__') ||
    /(?:^|[._])tests?(?:[._])/.test(basename)
  ) {
    return 'test';
  }

  if (
    segments.some((segment) => segment === 'spec' || segment === 'specs' || segment === '__specs__') ||
    /(?:^|[._])specs?(?:[._])/.test(basename)
  ) {
    return 'spec';
  }

  return 'source';
}

/** Shared with the Code tab's "Generated artifacts" section. */
export function isGeneratedReviewPath(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll('\\', '/').toLowerCase();
  const { segments, basename } = normalizePath(filePath);

  return (
    segments.some((segment) => segment === 'generated' || segment === '__generated__') ||
    /(?:^|[._-])generated(?:[._-]|$)/.test(basename) ||
    /\/(?:gql|graphql)\/sdk\.[^/]+$/.test(normalizedPath) ||
    /\/migrations\/meta\/\d+_snapshot\.json$/.test(normalizedPath) ||
    basename === 'schema.generated.graphql'
  );
}

export function classifyChangedPath(filePath: string): ChangeKind {
  const { segments, basename } = normalizePath(filePath);
  const directories = segments.slice(0, -1);

  if (isGeneratedReviewPath(filePath) || LOCKFILES.has(basename) || basename.endsWith('.min.js')) {
    return 'generated';
  }

  if (
    categorizeReviewPath(filePath) !== 'source' ||
    directories.some((segment) => segment === '__snapshots__' || segment === 'e2e' || segment === 'fixtures') ||
    basename.endsWith('.snap')
  ) {
    return 'tests';
  }

  if (DOC_EXTENSIONS.test(basename) || DOC_BASENAMES.test(basename) || directories.some((segment) => segment === 'docs' || segment === 'doc')) {
    return 'docs';
  }

  if (
    CONFIG_EXTENSIONS.test(basename) ||
    CONFIG_BASENAMES.test(basename) ||
    CONFIG_MODULES.test(basename) ||
    // Dotfiles and dot-directories (.github/, .gitignore, .env.example) are tooling, not runtime code.
    segments.some((segment) => segment.startsWith('.'))
  ) {
    return 'config';
  }

  return 'code';
}

/**
 * Groups changed lines by kind. GitHub caps the inbox's per-file list, so any lines its totals
 * cover beyond the listed files become an `unlisted` row rather than being silently dropped.
 */
export function summarizeLineBreakdown(
  files: readonly FileLineStat[],
  totals: { additions: number; deletions: number; changedFiles: number }
): LineBreakdownRow[] {
  const rows = new Map<LineBreakdownRow['kind'], LineBreakdownRow>();
  const add = (kind: LineBreakdownRow['kind'], fileCount: number, additions: number, deletions: number): void => {
    const row = rows.get(kind) ?? { kind, label: KIND_LABELS[kind], files: 0, additions: 0, deletions: 0 };
    row.files += fileCount;
    row.additions += additions;
    row.deletions += deletions;
    rows.set(kind, row);
  };

  for (const file of files) {
    add(classifyChangedPath(file.path), 1, file.additions, file.deletions);
  }

  const listedAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const listedDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const unlistedFiles = Math.max(0, totals.changedFiles - files.length);

  if (unlistedFiles > 0) {
    add(
      'unlisted',
      unlistedFiles,
      Math.max(0, totals.additions - listedAdditions),
      Math.max(0, totals.deletions - listedDeletions)
    );
  }

  return KIND_ORDER.flatMap((kind) => {
    const row = rows.get(kind);
    return row ? [row] : [];
  });
}

/**
 * Uses the detail's full file list when present, otherwise the inbox's capped `fileLineStats`.
 * Undefined when GitHub returned no per-file counts.
 */
export function pullRequestLineBreakdown(
  pullRequest: Pick<GitHubPullRequestSummary, 'additions' | 'deletions' | 'changedFiles' | 'fileLineStats'> & {
    files?: readonly FileLineStat[];
  }
): LineBreakdownRow[] | undefined {
  const files = pullRequest.files ?? pullRequest.fileLineStats;
  return files ? summarizeLineBreakdown(files, pullRequest) : undefined;
}
