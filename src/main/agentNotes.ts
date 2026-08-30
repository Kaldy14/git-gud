import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { GitAgentNote, RepoTab } from '@shared/types';

const AGENT_NOTES_FILE_NAME = 'git-gud-agent-notes.jsonl';
const MAX_AGENT_NOTES_FILE_BYTES = 1_000_000;
const MAX_AGENT_NOTES = 200;

type AgentNotesTab = Pick<RepoTab, 'gitDir'>;

export function getAgentNotesFilePath(tab: AgentNotesTab): string {
  return path.join(tab.gitDir, AGENT_NOTES_FILE_NAME);
}

export async function loadAgentNotes(tab: AgentNotesTab): Promise<GitAgentNote[]> {
  const filePath = getAgentNotesFilePath(tab);

  try {
    const fileStats = await stat(filePath);

    if (fileStats.size > MAX_AGENT_NOTES_FILE_BYTES) {
      throw new Error('Agent Notes file is too large.');
    }

    return parseAgentNotesDocument(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

export function parseAgentNotesDocument(document: string): GitAgentNote[] {
  const notesById = new Map<string, GitAgentNote>();

  for (const line of document.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const note = parseAgentNoteLine(line);

    if (note) {
      notesById.set(note.id, note);
    }
  }

  return [...notesById.values()]
    .slice(-MAX_AGENT_NOTES)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function parseAgentNoteLine(line: string): GitAgentNote | undefined {
  try {
    const value: unknown = JSON.parse(line);

    if (!isRecord(value)) {
      return undefined;
    }

    const id = readBoundedString(value.id, 160);
    const notePath = normalizeAgentNotePath(readBoundedString(value.path, 1_000));
    const lineNumber = readPositiveInteger(value.line);
    const anchor = readBoundedString(value.anchor, 500)?.trim();
    const summary = readBoundedString(value.summary, 240)?.trim();
    const detail = readBoundedString(value.detail, 1_000)?.trim();
    const author = readBoundedString(value.author, 80)?.trim() || 'Agent';
    const createdAt = readIsoDate(value.createdAt);

    if (!id || !notePath || !lineNumber || !anchor || !summary || !createdAt) {
      return undefined;
    }

    return {
      id,
      path: notePath,
      line: lineNumber,
      anchor,
      summary,
      ...(detail ? { detail } : {}),
      author,
      createdAt
    };
  } catch {
    return undefined;
  }
}

function normalizeAgentNotePath(value: string | undefined): string | undefined {
  if (!value || path.isAbsolute(value) || /^[a-z]:[\\/]/iu.test(value)) {
    return undefined;
  }

  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  return normalized;
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 && value <= 10_000_000
    ? value
    : undefined;
}

function readIsoDate(value: unknown): string | undefined {
  const date = readBoundedString(value, 64);

  return date && Number.isFinite(Date.parse(date)) ? date : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
