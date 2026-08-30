import { access, cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectCodexAgentNotesSkill,
  installManagedSkill,
  removeManagedSkill,
  type CodexAgentNotesSkillLocations
} from './codexAgentNotes';

const temporaryDirectories: string[] = [];
const sourceSkillPath = path.resolve('skills/git-gud-agent-notes');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const { rm } = await import('node:fs/promises');
      await rm(directory, { recursive: true, force: true });
    })
  );
});

describe('Codex Agent Notes skill integration', () => {
  it('installs, detects updates, refreshes, and removes the managed skill', async () => {
    const locations = await createLocations();

    await expect(inspectCodexAgentNotesSkill(locations)).resolves.toMatchObject({
      status: 'not-installed'
    });

    const installed = await installManagedSkill(locations);
    expect(installed.status).toBe('installed');
    await expect(access(path.join(installed.installPath, 'SKILL.md'))).resolves.toBeUndefined();
    await expect(access(path.join(installed.installPath, 'scripts', 'add-agent-note.mjs'))).resolves.toBeUndefined();

    await writeFile(path.join(installed.installPath, 'SKILL.md'), 'changed locally\n');
    await expect(inspectCodexAgentNotesSkill(locations)).resolves.toMatchObject({
      status: 'update-available'
    });

    await expect(installManagedSkill(locations)).resolves.toMatchObject({ status: 'installed' });
    expect(await readFile(path.join(installed.installPath, 'SKILL.md'), 'utf8')).toBe(
      await readFile(path.join(locations.bundledSkillPath, 'SKILL.md'), 'utf8')
    );

    await expect(removeManagedSkill(locations)).resolves.toMatchObject({
      status: 'not-installed'
    });
  });

  it('does not overwrite an unmanaged skill with the same name', async () => {
    const locations = await createLocations();
    const installPath = path.join(locations.skillsRoot, 'git-gud-agent-notes');
    await mkdir(installPath, { recursive: true });
    await writeFile(path.join(installPath, 'SKILL.md'), 'user-owned\n');

    await expect(inspectCodexAgentNotesSkill(locations)).resolves.toMatchObject({
      status: 'conflict'
    });
    await expect(installManagedSkill(locations)).rejects.toThrow('unmanaged skill');
    expect(await readFile(path.join(installPath, 'SKILL.md'), 'utf8')).toBe('user-owned\n');
  });
});

async function createLocations(): Promise<CodexAgentNotesSkillLocations> {
  const directory = await mkdtemp(path.join(tmpdir(), 'git-gud-codex-skill-'));
  temporaryDirectories.push(directory);
  const bundledSkillPath = path.join(directory, 'bundled', 'git-gud-agent-notes');
  await cp(sourceSkillPath, bundledSkillPath, { recursive: true });

  return {
    bundledSkillPath,
    skillsRoot: path.join(directory, 'home', '.agents', 'skills')
  };
}
