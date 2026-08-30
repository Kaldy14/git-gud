import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const writerPath = path.resolve('skills/git-gud-agent-notes/scripts/add-agent-note.mjs');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Git Gud Agent Notes skill writer', () => {
  it('writes a validated note for an added line with an automatically captured anchor', async () => {
    const repositoryPath = await createRepository();
    await writeFile(path.join(repositoryPath, 'example.ts'), 'export const stable = true;\nexport const added = "review me";\n');

    const { stdout } = await runWriter(repositoryPath, [
      '--file', 'example.ts',
      '--new-line', '2',
      '--summary', 'Keep the new value compatible with stored tasks.',
      '--detail', 'Older records only contain the stable field.',
      '--json'
    ]);
    const note = JSON.parse(stdout);
    const gitDirectory = await git(repositoryPath, ['rev-parse', '--absolute-git-dir']);
    const storedNote = JSON.parse(
      (await readFile(path.join(gitDirectory, 'git-gud-agent-notes.jsonl'), 'utf8')).trim()
    );

    expect(note).toMatchObject({
      path: 'example.ts',
      line: 2,
      anchor: 'export const added = "review me";',
      summary: 'Keep the new value compatible with stored tasks.',
      detail: 'Older records only contain the stable field.',
      author: 'Codex'
    });
    expect(storedNote).toEqual(note);
  });

  it('supports untracked files and stores notes in a linked worktree Git directory', async () => {
    const repositoryPath = await createRepository();
    const worktreePath = path.join(path.dirname(repositoryPath), 'linked-worktree');
    await git(repositoryPath, ['worktree', 'add', '-b', 'feature/notes', worktreePath]);
    await writeFile(path.join(worktreePath, 'new-file.ts'), 'export const worktreeOnly = true;\n');

    await runWriter(worktreePath, [
      '--file', 'new-file.ts',
      '--new-line', '1',
      '--summary', 'This file belongs to the isolated worktree.'
    ]);

    const worktreeGitDirectory = await git(worktreePath, ['rev-parse', '--absolute-git-dir']);
    const note = JSON.parse(
      (await readFile(path.join(worktreeGitDirectory, 'git-gud-agent-notes.jsonl'), 'utf8')).trim()
    );
    expect(note.path).toBe('new-file.ts');
    expect(note.anchor).toBe('export const worktreeOnly = true;');
  });

  it('rejects unchanged and blank target lines', async () => {
    const repositoryPath = await createRepository();
    await writeFile(path.join(repositoryPath, 'example.ts'), 'export const stable = true;\n\nexport const added = true;\n');

    await expect(runWriter(repositoryPath, [
      '--file', 'example.ts',
      '--new-line', '1',
      '--summary', 'This should be rejected.'
    ])).rejects.toMatchObject({ stderr: expect.stringContaining('is not an added line') });

    await expect(runWriter(repositoryPath, [
      '--file', 'example.ts',
      '--new-line', '2',
      '--summary', 'This should also be rejected.'
    ])).rejects.toMatchObject({ stderr: expect.stringContaining('non-blank added line') });
  });
});

async function createRepository(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'git-gud-agent-note-writer-'));
  temporaryDirectories.push(temporaryRoot);
  const repositoryPath = path.join(temporaryRoot, 'repository');
  await mkdir(repositoryPath);
  await git(repositoryPath, ['init']);
  await git(repositoryPath, ['config', 'user.name', 'Git Gud Test']);
  await git(repositoryPath, ['config', 'user.email', 'git-gud@example.test']);
  await writeFile(path.join(repositoryPath, 'example.ts'), 'export const stable = true;\n');
  await git(repositoryPath, ['add', 'example.ts']);
  await git(repositoryPath, ['commit', '-m', 'Initial commit']);
  return repositoryPath;
}

function runWriter(repositoryPath: string, arguments_: string[]) {
  return execFileAsync(process.execPath, [
    writerPath,
    'agent-note',
    'add',
    '--repo',
    repositoryPath,
    ...arguments_
  ], { encoding: 'utf8' });
}

async function git(repositoryPath: string, arguments_: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...arguments_], {
    encoding: 'utf8'
  });
  return stdout.trim();
}
