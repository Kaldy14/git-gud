import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveReviewTypeDefinition, type ReviewTypeDefinitionFileContext } from './reviewTypeDefinition';

const temporaryDirectories: string[] = [];

describe('review TypeScript definition resolution', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ['interface', 'interface ReviewTarget {\n  enabled: boolean;\n}\n\nconst value: ReviewTarget = { enabled: true };'],
    ['type', 'type ReviewTarget = {\n  enabled: boolean;\n};\n\nconst value: ReviewTarget = { enabled: true };']
  ])('returns the full same-file %s declaration', async (declarationKind, contents) => {
    const result = resolve('src/review.ts', contents, contents, 5, 13);

    expect(result).toMatchObject({
      name: 'ReviewTarget',
      path: 'src/review.ts',
      kind: 'definition',
      declarationKind,
      startLine: 1,
      startCharacter: 0
    });
    expect(result?.snippet).toContain('ReviewTarget');
    expect(result?.snippet).toContain('enabled: boolean');
  });

  it('resolves an imported declaration from another review context', async () => {
    const files: ReviewTypeDefinitionFileContext[] = [
      {
        path: 'src/model.ts',
        source: 'commit',
        oldContents: 'export interface User { id: string; }',
        newContents: 'export interface User { id: string; name: string; }'
      },
      {
        path: 'src/view.ts',
        source: 'commit',
        oldContents: "import type { User } from './model';\nexport const render = (user: User) => user.id;",
        newContents: "import type { User } from './model';\nexport const render = (user: User) => user.name;"
      }
    ];

    const result = resolveReviewTypeDefinition({
      filePath: 'src/view.ts',
      source: 'commit',
      side: 'new',
      line: 2,
      character: 29,
      files
    });

    expect(result).toMatchObject({
      name: 'User',
      path: 'src/model.ts',
      declarationKind: 'interface',
      startLine: 1
    });
    expect(result?.snippet).toBe('export interface User { id: string; name: string; }');
  });

  it('resolves usages to definitions in unchanged repository files', () => {
    const repoPath = createProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@models/*': ['src/models/*'] },
          target: 'ES2022'
        }
      }),
      'src/models/user.ts': 'export interface User { name: string; }',
      'src/view.ts': "import type { User } from '@models/user';\nexport const label = (user: User) => user.name;"
    });
    const viewContents = "import type { User } from '@models/user';\nexport const label = (user: User) => user.name;";

    const result = resolveReviewTypeDefinition({
      repoPath,
      source: 'unstaged',
      filePath: 'src/view.ts',
      side: 'new',
      line: 2,
      character: 42,
      files: [{ path: 'src/view.ts', source: 'unstaged', oldContents: viewContents, newContents: viewContents }]
    });

    expect(result).toMatchObject({
      name: 'name',
      path: 'src/models/user.ts',
      declarationKind: 'property',
      startLine: 1
    });
    expect(result?.snippet).toContain('name: string');
  });

  it('uses reviewed contents before the working-tree copy', () => {
    const repoPath = createProject({
      'src/model.ts': 'export interface User { oldName: string; }',
      'src/view.ts': "import type { User } from './model';\nexport const label = (user: User) => user.newName;"
    });
    const reviewedModel = 'export interface User { newName: string; }';
    const viewContents = "import type { User } from './model';\nexport const label = (user: User) => user.newName;";

    const result = resolveReviewTypeDefinition({
      repoPath,
      source: 'unstaged',
      filePath: 'src/view.ts',
      side: 'new',
      line: 2,
      character: 42,
      files: [
        { path: 'src/model.ts', source: 'unstaged', oldContents: '', newContents: reviewedModel },
        { path: 'src/view.ts', source: 'unstaged', oldContents: viewContents, newContents: viewContents }
      ]
    });

    expect(result?.path).toBe('src/model.ts');
    expect(result?.snippet).toContain('newName: string');
  });

  it('loads unchanged dependencies from the reviewed commit instead of the checkout', () => {
    const viewContents = "import type { User } from './model';\nexport const label = (user: User) => user.reviewedName;";
    const repoPath = createProject({
      'src/model.ts': 'export interface User { reviewedName: string; }',
      'src/view.ts': viewContents
    });
    git(repoPath, ['init']);
    git(repoPath, ['add', '.']);
    git(repoPath, ['-c', 'user.name=Git Gud', '-c', 'user.email=git-gud@example.com', 'commit', '-m', 'reviewed']);
    const reviewedSha = git(repoPath, ['rev-parse', 'HEAD']);
    writeFileSync(join(repoPath, 'src/model.ts'), 'export interface User { checkoutName: string; }');

    const result = resolveReviewTypeDefinition({
      repoPath,
      target: { kind: 'commit', sha: reviewedSha },
      source: 'commit',
      filePath: 'src/view.ts',
      side: 'new',
      line: 2,
      character: 42,
      files: [{
        path: 'src/view.ts',
        source: 'commit',
        oldContents: viewContents,
        newContents: viewContents
      }]
    });

    expect(result?.path).toBe('src/model.ts');
    expect(result?.snippet).toContain('reviewedName: string');
    expect(result?.snippet).not.toContain('checkoutName');
  });

  it('loads unchanged staged dependencies from the index instead of the worktree', () => {
    const viewContents = "import type { User } from './model';\nexport const label = (user: User) => user.stagedName;";
    const repoPath = createProject({
      'src/model.ts': 'export interface User { originalName: string; }',
      'src/view.ts': viewContents
    });
    git(repoPath, ['init']);
    git(repoPath, ['add', '.']);
    git(repoPath, ['-c', 'user.name=Git Gud', '-c', 'user.email=git-gud@example.com', 'commit', '-m', 'base']);
    writeFileSync(join(repoPath, 'src/model.ts'), 'export interface User { stagedName: string; }');
    git(repoPath, ['add', 'src/model.ts']);
    writeFileSync(join(repoPath, 'src/model.ts'), 'export interface User { workingName: string; }');

    const result = resolveReviewTypeDefinition({
      repoPath,
      target: { kind: 'wip', scope: 'all' },
      source: 'staged',
      filePath: 'src/view.ts',
      side: 'new',
      line: 2,
      character: 42,
      files: [{
        path: 'src/view.ts',
        source: 'staged',
        oldContents: viewContents,
        newContents: viewContents
      }]
    });

    expect(result?.path).toBe('src/model.ts');
    expect(result?.snippet).toContain('stagedName: string');
    expect(result?.snippet).not.toContain('workingName');
  });

  it('uses contents from the requested review side', async () => {
    const oldContents = 'interface OldShape { oldValue: string; }\nconst value: OldShape = { oldValue: "" };';
    const newContents = 'interface NewShape { newValue: string; }\nconst value: NewShape = { newValue: "" };';
    const files: ReviewTypeDefinitionFileContext[] = [
      { path: 'src/value.ts', source: 'commit', oldContents, newContents }
    ];

    const oldResult = resolveReviewTypeDefinition({
      filePath: 'src/value.ts',
      source: 'commit',
      side: 'old',
      line: 2,
      character: 13,
      files
    });
    const newResult = resolveReviewTypeDefinition({
      filePath: 'src/value.ts',
      source: 'commit',
      side: 'new',
      line: 2,
      character: 13,
      files
    });

    expect(oldResult?.name).toBe('OldShape');
    expect(oldResult?.snippet).toContain('oldValue');
    expect(newResult?.name).toBe('NewShape');
    expect(newResult?.snippet).toContain('newValue');
  });

  it('uses the clicked staged or unstaged snapshot when both share a path', () => {
    const stagedContents = 'interface StagedShape { staged: true; }\nconst value: StagedShape = { staged: true };';
    const unstagedContents = 'interface WorkingShape { working: true; }\nconst value: WorkingShape = { working: true };';
    const files: ReviewTypeDefinitionFileContext[] = [
      {
        path: 'src/shared.ts',
        source: 'staged',
        oldContents: stagedContents,
        newContents: stagedContents
      },
      {
        path: 'src/shared.ts',
        source: 'unstaged',
        oldContents: unstagedContents,
        newContents: unstagedContents
      }
    ];

    const staged = resolveReviewTypeDefinition({
      filePath: 'src/shared.ts',
      source: 'staged',
      side: 'new',
      line: 2,
      character: 13,
      files
    });
    const unstaged = resolveReviewTypeDefinition({
      filePath: 'src/shared.ts',
      source: 'unstaged',
      side: 'new',
      line: 2,
      character: 13,
      files
    });

    expect(staged?.name).toBe('StagedShape');
    expect(unstaged?.name).toBe('WorkingShape');
  });

  it('returns undefined for an unresolved token', async () => {
    const contents = 'const value = missingSymbol;';

    expect(resolve('src/value.ts', contents, contents, 1, 15)).toBeUndefined();
  });

  it('does not report an unresolved import alias as a clickable definition', () => {
    const contents = "import type { Missing } from './missing';\nconst value: Missing = {};";

    expect(resolve('src/value.ts', contents, contents, 2, 13)).toBeUndefined();
  });

  it('rejects paths outside the authorized review snapshot', () => {
    const contents = 'interface Outside { value: string }\nconst item: Outside = { value: "" };';

    expect(resolve('../outside.ts', contents, contents, 2, 12)).toBeUndefined();
  });

  it('resolves context-only GitHub review snapshots without a local checkout', () => {
    const contents = 'interface RemoteShape { value: string; }\nconst item: RemoteShape = { value: "" };';

    const result = resolveReviewTypeDefinition({
      filePath: 'src/remote.ts',
      source: 'commit',
      side: 'new',
      line: 2,
      character: 12,
      files: [{ path: 'src/remote.ts', source: 'commit', oldContents: contents, newContents: contents }]
    });

    expect(result).toMatchObject({
      name: 'RemoteShape',
      path: 'src/remote.ts',
      declarationKind: 'interface'
    });
  });
});

function resolve(
  filePath: string,
  oldContents: string,
  newContents: string,
  line: number,
  character: number
) {
  return resolveReviewTypeDefinition({
    filePath,
    source: 'commit',
    side: 'new',
    line,
    character,
    files: [{ path: filePath, source: 'commit', oldContents, newContents }]
  });
}

function createProject(files: Readonly<Record<string, string>>): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'git-gud-type-definitions-'));
  temporaryDirectories.push(repoPath);

  for (const [path, contents] of Object.entries(files)) {
    const segments = path.split('/');
    mkdirSync(join(repoPath, ...segments.slice(0, -1)), { recursive: true });
    writeFileSync(join(repoPath, ...segments), contents);
  }

  return repoPath;
}

function git(repoPath: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}
