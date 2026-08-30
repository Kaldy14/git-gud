import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getAgentNotesFilePath,
  loadAgentNotes,
  parseAgentNotesDocument
} from './agentNotes';

describe('Agent Notes storage', () => {
  it('reads valid JSONL notes, normalizes paths, and keeps the latest duplicate id', () => {
    const document = [
      JSON.stringify({
        id: 'task-1-contract',
        path: 'src\\main\\system.ts',
        line: 42,
        anchor: 'return prompt;',
        summary: 'Keep the project root stable.',
        author: 'Codex',
        createdAt: '2026-08-30T10:00:00.000Z'
      }),
      '{not-json}',
      JSON.stringify({
        id: 'task-1-contract',
        path: 'src/main/system.ts',
        line: 43,
        anchor: 'return taskPrompt;',
        summary: 'Keep the project root stable after adding note context.',
        detail: 'The worktree remains execution context.',
        author: 'Codex',
        createdAt: '2026-08-30T10:01:00.000Z'
      })
    ].join('\n');

    expect(parseAgentNotesDocument(document)).toEqual([
      {
        id: 'task-1-contract',
        path: 'src/main/system.ts',
        line: 43,
        anchor: 'return taskPrompt;',
        summary: 'Keep the project root stable after adding note context.',
        detail: 'The worktree remains execution context.',
        author: 'Codex',
        createdAt: '2026-08-30T10:01:00.000Z'
      }
    ]);
  });

  it('rejects unsafe paths and incomplete notes', () => {
    const document = [
      JSON.stringify({
        id: 'outside',
        path: '../secret.ts',
        line: 1,
        anchor: 'secret',
        summary: 'Outside the repository.',
        createdAt: '2026-08-30T10:00:00.000Z'
      }),
      JSON.stringify({
        id: 'missing-anchor',
        path: 'src/main.ts',
        line: 1,
        summary: 'Missing its code anchor.',
        createdAt: '2026-08-30T10:00:00.000Z'
      })
    ].join('\n');

    expect(parseAgentNotesDocument(document)).toEqual([]);
  });

  it('uses the worktree Git directory and treats a missing file as no notes', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'git-gud-agent-notes-'));

    try {
      expect(getAgentNotesFilePath({ gitDir })).toBe(join(gitDir, 'git-gud-agent-notes.jsonl'));
      await expect(loadAgentNotes({ gitDir })).resolves.toEqual([]);
    } finally {
      await rm(gitDir, { recursive: true, force: true });
    }
  });
});
