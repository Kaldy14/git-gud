import { constants } from 'node:fs';
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app } from 'electron';

import type { CodexAgentNotesSkillState } from '@shared/types';

const SKILL_NAME = 'git-gud-agent-notes';
const MANAGED_MARKER = '.git-gud-managed.json';
const MANAGED_FILES = [
  MANAGED_MARKER,
  'SKILL.md',
  path.join('agents', 'openai.yaml'),
  path.join('scripts', 'add-agent-note.mjs')
] as const;

export type CodexAgentNotesSkillLocations = {
  bundledSkillPath: string;
  skillsRoot: string;
};

export async function getCodexAgentNotesSkillState(): Promise<CodexAgentNotesSkillState> {
  return inspectCodexAgentNotesSkill(defaultSkillLocations());
}

export async function installCodexAgentNotesSkill(): Promise<CodexAgentNotesSkillState> {
  return installManagedSkill(defaultSkillLocations());
}

export async function removeCodexAgentNotesSkill(): Promise<CodexAgentNotesSkillState> {
  return removeManagedSkill(defaultSkillLocations());
}

export async function inspectCodexAgentNotesSkill(
  locations: CodexAgentNotesSkillLocations
): Promise<CodexAgentNotesSkillState> {
  await assertBundledSkill(locations.bundledSkillPath);
  const installPath = skillInstallPath(locations);
  const installedEntry = await pathEntry(installPath);

  if (!installedEntry) {
    return { status: 'not-installed', installPath };
  }

  if (!installedEntry.isDirectory() || installedEntry.isSymbolicLink()) {
    return {
      status: 'conflict',
      installPath,
      message: 'Another file already uses the Git Gud Agent Notes skill path.'
    };
  }

  if (!(await isManagedSkill(installPath))) {
    return {
      status: 'conflict',
      installPath,
      message: 'An unmanaged skill already uses this name. Git Gud left it untouched.'
    };
  }

  const current = await managedFilesMatch(locations.bundledSkillPath, installPath);
  return {
    status: current ? 'installed' : 'update-available',
    installPath
  };
}

export async function installManagedSkill(
  locations: CodexAgentNotesSkillLocations
): Promise<CodexAgentNotesSkillState> {
  const state = await inspectCodexAgentNotesSkill(locations);

  if (state.status === 'conflict') {
    throw new Error(state.message);
  }

  if (state.status === 'installed') {
    return state;
  }

  await mkdir(locations.skillsRoot, { recursive: true });
  const installPath = skillInstallPath(locations);
  const temporaryPath = path.join(locations.skillsRoot, `.${SKILL_NAME}-${randomUUID()}`);
  const backupPath = path.join(locations.skillsRoot, `.${SKILL_NAME}-backup-${randomUUID()}`);
  let movedExistingSkill = false;

  try {
    await cp(locations.bundledSkillPath, temporaryPath, {
      recursive: true,
      force: false,
      errorOnExist: true
    });
    await chmod(path.join(temporaryPath, 'scripts', 'add-agent-note.mjs'), 0o755);

    if (state.status === 'update-available') {
      await rename(installPath, backupPath);
      movedExistingSkill = true;
    }

    await rename(temporaryPath, installPath);

    if (movedExistingSkill) {
      await rm(backupPath, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });

    if (movedExistingSkill && !(await pathEntry(installPath))) {
      await rename(backupPath, installPath);
    }

    throw error;
  }

  return inspectCodexAgentNotesSkill(locations);
}

export async function removeManagedSkill(
  locations: CodexAgentNotesSkillLocations
): Promise<CodexAgentNotesSkillState> {
  const state = await inspectCodexAgentNotesSkill(locations);

  if (state.status === 'not-installed') {
    return state;
  }

  if (state.status === 'conflict') {
    throw new Error(state.message);
  }

  await rm(skillInstallPath(locations), { recursive: true, force: false });
  return inspectCodexAgentNotesSkill(locations);
}

function defaultSkillLocations(): CodexAgentNotesSkillLocations {
  return {
    bundledSkillPath: path.join(app.getAppPath(), 'skills', SKILL_NAME),
    skillsRoot: path.join(homedir(), '.agents', 'skills')
  };
}

function skillInstallPath(locations: CodexAgentNotesSkillLocations): string {
  return path.join(locations.skillsRoot, SKILL_NAME);
}

async function assertBundledSkill(bundledSkillPath: string): Promise<void> {
  try {
    await Promise.all(
      MANAGED_FILES.map((relativePath) =>
        access(path.join(bundledSkillPath, relativePath), constants.R_OK)
      )
    );
  } catch {
    throw new Error('Git Gud could not find its bundled Agent Notes skill.');
  }
}

async function isManagedSkill(installPath: string): Promise<boolean> {
  try {
    const marker: unknown = JSON.parse(
      await readFile(path.join(installPath, MANAGED_MARKER), 'utf8')
    );

    return Boolean(
      marker &&
      typeof marker === 'object' &&
      'owner' in marker &&
      marker.owner === 'git-gud' &&
      'integration' in marker &&
      marker.integration === 'agent-notes'
    );
  } catch {
    return false;
  }
}

async function managedFilesMatch(sourcePath: string, installPath: string): Promise<boolean> {
  try {
    const comparisons = await Promise.all(
      MANAGED_FILES.map(async (relativePath) => {
        const [source, installed] = await Promise.all([
          readFile(path.join(sourcePath, relativePath)),
          readFile(path.join(installPath, relativePath))
        ]);
        return source.equals(installed);
      })
    );
    return comparisons.every(Boolean);
  } catch {
    return false;
  }
}

async function pathEntry(targetPath: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
