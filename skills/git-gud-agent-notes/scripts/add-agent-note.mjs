#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_NOTES_FILE_BYTES = 1_000_000;

try {
  const input = parseArguments(process.argv.slice(2));
  const note = await addAgentNote(input);

  if (input.json) {
    process.stdout.write(`${JSON.stringify(note)}\n`);
  } else {
    process.stdout.write(`Added Agent Note to ${note.path}:${note.line}.\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unable to add Agent Note.'}\n`);
  process.exitCode = 1;
}

async function addAgentNote(input) {
  const repositoryPath = path.resolve(input.repo);
  const repositoryRoot = await git(repositoryPath, ['rev-parse', '--show-toplevel']);
  const gitDirectory = await git(repositoryPath, ['rev-parse', '--absolute-git-dir']);
  const relativePath = normalizeRelativePath(input.file);
  const absolutePath = resolveRepositoryFile(repositoryRoot, relativePath);
  const contents = await readFile(absolutePath, 'utf8');
  const lines = contents.split(/\r?\n/u);
  const sourceLine = lines[input.newLine - 1];

  if (sourceLine === undefined) {
    throw new Error(`${relativePath}:${input.newLine} does not exist.`);
  }

  const anchor = sourceLine.trim();

  if (!anchor) {
    throw new Error('Agent Notes must attach to a non-blank added line.');
  }

  if (anchor.length > 500) {
    throw new Error('The target line is too long to use as an Agent Note anchor.');
  }

  if (!(await isAddedLine(repositoryRoot, relativePath, input.newLine))) {
    throw new Error(`${relativePath}:${input.newLine} is not an added line in the current diff.`);
  }

  const note = {
    id: randomUUID(),
    path: relativePath,
    line: input.newLine,
    anchor,
    summary: input.summary,
    ...(input.detail ? { detail: input.detail } : {}),
    author: input.author,
    createdAt: new Date().toISOString()
  };
  const serializedNote = `${JSON.stringify(note)}\n`;
  const notesPath = path.join(gitDirectory, 'git-gud-agent-notes.jsonl');
  const currentSize = await fileSize(notesPath);

  if (currentSize + Buffer.byteLength(serializedNote) > MAX_NOTES_FILE_BYTES) {
    throw new Error('Git Gud Agent Notes storage is full. Remove old notes before adding another.');
  }

  await appendFile(notesPath, serializedNote, { encoding: 'utf8', mode: 0o600 });
  return note;
}

function parseArguments(arguments_) {
  if (arguments_[0] === '--help' || arguments_[0] === '-h') {
    process.stdout.write(usage());
    process.exit(0);
  }

  if (arguments_[0] !== 'agent-note' || arguments_[1] !== 'add') {
    throw new Error(usage());
  }

  const values = new Map();
  let json = false;

  for (let index = 2; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === '--json') {
      json = true;
      continue;
    }

    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument ?? ''}`);
    }

    const value = arguments_[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }

    if (values.has(argument)) {
      throw new Error(`Duplicate option: ${argument}.`);
    }

    values.set(argument, value);
    index += 1;
  }

  for (const option of values.keys()) {
    if (!['--repo', '--file', '--new-line', '--summary', '--detail', '--author'].includes(option)) {
      throw new Error(`Unknown option: ${option}.`);
    }
  }

  const file = requiredValue(values, '--file');
  const newLineValue = requiredValue(values, '--new-line');
  const newLine = /^\d+$/u.test(newLineValue) ? Number.parseInt(newLineValue, 10) : Number.NaN;
  const summary = boundedText(requiredValue(values, '--summary'), 'Summary', 240);
  const detailValue = values.get('--detail');
  const authorValue = values.get('--author');

  if (!Number.isInteger(newLine) || newLine < 1 || newLine > 10_000_000) {
    throw new Error('--new-line must be a positive integer.');
  }

  return {
    repo: values.get('--repo') ?? process.cwd(),
    file,
    newLine,
    summary,
    detail: detailValue ? boundedText(detailValue, 'Detail', 1_000) : undefined,
    author: authorValue ? boundedText(authorValue, 'Author', 80) : 'Codex',
    json
  };
}

async function isAddedLine(repositoryRoot, relativePath, lineNumber) {
  const status = await git(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    relativePath
  ]);

  if (status.split(/\r?\n/u).some((line) => line.startsWith('?? '))) {
    return true;
  }

  try {
    await git(repositoryRoot, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    return true;
  }

  const diff = await git(repositoryRoot, [
    'diff',
    '--no-ext-diff',
    '--unified=0',
    'HEAD',
    '--',
    relativePath
  ]);

  return addedLineRanges(diff).some(
    ({ start, count }) => count > 0 && lineNumber >= start && lineNumber < start + count
  );
}

function addedLineRanges(diff) {
  const ranges = [];

  for (const line of diff.split(/\r?\n/u)) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);

    if (match) {
      ranges.push({
        start: Number.parseInt(match[1], 10),
        count: match[2] === undefined ? 1 : Number.parseInt(match[2], 10)
      });
    }
  }

  return ranges;
}

async function git(repositoryPath, arguments_) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...arguments_], {
      encoding: 'utf8',
      maxBuffer: 5_000_000
    });
    return stdout.trim();
  } catch (error) {
    const message = typeof error?.stderr === 'string' ? error.stderr.trim() : undefined;
    throw new Error(message || `Git command failed: git ${arguments_.join(' ')}`, { cause: error });
  }
}

function normalizeRelativePath(value) {
  if (!value || path.isAbsolute(value) || /^[a-z]:[\\/]/iu.test(value)) {
    throw new Error('--file must be a repository-relative path.');
  }

  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));

  if (
    normalized.length > 1_000 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('--file must stay inside the repository.');
  }

  return normalized;
}

function resolveRepositoryFile(repositoryRoot, relativePath) {
  const absolutePath = path.resolve(repositoryRoot, ...relativePath.split('/'));
  const rootPrefix = `${path.resolve(repositoryRoot)}${path.sep}`;

  if (!absolutePath.startsWith(rootPrefix)) {
    throw new Error('--file must stay inside the repository.');
  }

  return absolutePath;
}

function requiredValue(values, option) {
  const value = values.get(option);

  if (!value) {
    throw new Error(`Missing required option: ${option}.`);
  }

  return value;
}

function boundedText(value, label, maximumLength) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }

  if (normalized.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`);
  }

  return normalized;
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

function usage() {
  return [
    'Usage:',
    '  node add-agent-note.mjs agent-note add --repo <path> --file <relative-path> --new-line <line> --summary <text> [--detail <text>] [--author <name>] [--json]'
  ].join('\n');
}
