import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GitProfile } from '@shared/types';

import { gitExecutor } from './git/exec';
import { commitChanges, stageFile } from './git/repositoryDetails';
import {
  assignProfileToRepository,
  createProfileCommandEnv,
  getRepoProfileState,
  normalizeStoredProfiles,
  saveProfile
} from './profiles';

describe('repository profiles', () => {
  it('skips malformed persisted profile records without breaking valid profiles', () => {
    const valid = profile('valid-persisted', {
      remoteUrlPatterns: ['github.com/example']
    });

    expect(
      normalizeStoredProfiles([
        valid,
        { ...valid, id: '   ' },
        { ...valid, name: '' },
        { ...valid, email: '' },
        { ...valid, sshKeyPath: 123 },
        { ...valid, ghConfigDir: [] },
        { ...valid, signingKey: false },
        { ...valid, remoteUrlPatterns: 'github.com/wrong-shape' },
        { ...valid, remoteUrlPatterns: ['valid', 123] },
        null
      ])
    ).toEqual([valid]);
  });

  it('switches profiles without retaining optional signing or SSH settings', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      const first = profile('first', {
        signingKey: 'ABC123',
        sshKeyPath: '/tmp/keys/work key'
      });
      const second = profile('second');
      saveProfile(first);
      saveProfile(second);

      await assignProfileToRepository(repoPath, first.id);
      expect(await localConfig(repoPath, 'user.signingkey')).toBe('ABC123');
      expect(await localConfig(repoPath, 'core.sshCommand')).toBe("ssh -o IdentitiesOnly=yes -i '/tmp/keys/work key'");

      await assignProfileToRepository(repoPath, second.id, first.id);

      expect(await localConfig(repoPath, 'user.name')).toBe(second.name);
      expect(await localConfig(repoPath, 'user.email')).toBe(second.email);
      expect(await localConfig(repoPath, 'user.signingkey')).toBeUndefined();
      expect(await localConfig(repoPath, 'core.sshCommand')).toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('reports the actual Git identity and flags drift from the assigned profile', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      const active = profile('identity');
      saveProfile(active);
      await assignProfileToRepository(repoPath, active.id);

      expect(await getRepoProfileState(repoPath, active.id)).toMatchObject({
        activeProfile: { id: active.id },
        effectiveIdentity: {
          name: active.name,
          email: active.email,
          source: 'profile'
        },
        identityMatchesActiveProfile: true
      });

      await gitExecutor.run(['config', '--local', 'user.email', 'external@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });

      expect(await getRepoProfileState(repoPath, active.id)).toMatchObject({
        effectiveIdentity: {
          name: active.name,
          email: 'external@example.test',
          source: 'repo-config'
        },
        identityMatchesActiveProfile: false
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('uses assigned identity variables for Git commands and only suggests matching profiles', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      const matchToken = `example-${Date.now()}.test`;
      const suggested = profile('suggested', {
        ghConfigDir: '/tmp/gh-profile',
        remoteUrlPatterns: [matchToken]
      });
      saveProfile(suggested);

      expect(createProfileCommandEnv(suggested.id)).toMatchObject({
        GIT_AUTHOR_NAME: suggested.name,
        GIT_AUTHOR_EMAIL: suggested.email,
        GIT_COMMITTER_NAME: suggested.name,
        GIT_COMMITTER_EMAIL: suggested.email,
        GH_CONFIG_DIR: '/tmp/gh-profile'
      });

      const state = await getRepoProfileState(repoPath, undefined, [`git@${matchToken}:owner/repo.git`]);
      expect(state.suggestedProfile?.id).toBe(suggested.id);
      expect(state.activeProfile).toBeUndefined();
      expect(await localConfig(repoPath, 'user.name')).toBe('Original User');
      expect(await localConfig(repoPath, 'user.email')).toBe('original@example.test');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('restores the pre-assignment config after the saved profile is edited', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      const assigned = profile('editable', {
        signingKey: 'OLD-SIGNING-KEY',
        sshKeyPath: '/tmp/keys/old'
      });
      saveProfile(assigned);
      await assignProfileToRepository(repoPath, assigned.id);

      saveProfile({
        ...assigned,
        name: 'Edited User',
        email: 'edited@example.test',
        signingKey: 'NEW-SIGNING-KEY',
        sshKeyPath: '/tmp/keys/new'
      });
      await assignProfileToRepository(repoPath, undefined, assigned.id);

      expect(await localConfig(repoPath, 'user.name')).toBe('Original User');
      expect(await localConfig(repoPath, 'user.email')).toBe('original@example.test');
      expect(await localConfig(repoPath, 'user.signingkey')).toBeUndefined();
      expect(await localConfig(repoPath, 'core.sshCommand')).toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('captures a new baseline when a repository is recreated at the same path', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      await gitExecutor.run(['config', '--local', 'user.name', 'Old Repository User'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.email', 'old-repository@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.signingkey', 'OLD-REPOSITORY-SIGNING-KEY'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      const oldAssignment = profile('old-repository');
      saveProfile(oldAssignment);
      await assignProfileToRepository(repoPath, oldAssignment.id);

      await rm(repoPath, { recursive: true, force: true });
      await createRepository(rootPath);
      await gitExecutor.run(['config', '--local', 'user.name', 'New Repository User'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.email', 'new-repository@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      const newAssignment = profile('new-repository');
      saveProfile(newAssignment);

      await assignProfileToRepository(repoPath, newAssignment.id, oldAssignment.id);
      await assignProfileToRepository(repoPath, undefined, newAssignment.id);

      expect(await localConfig(repoPath, 'user.name')).toBe('New Repository User');
      expect(await localConfig(repoPath, 'user.email')).toBe('new-repository@example.test');
      expect(await localConfig(repoPath, 'user.signingkey')).toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('leaves a recreated repository untouched when directly unassigning a stale profile', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      await gitExecutor.run(['config', '--local', 'user.name', 'Old Repository User'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.email', 'old-repository@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.signingkey', 'OLD-REPOSITORY-SIGNING-KEY'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      const staleAssignment = profile('stale-repository');
      saveProfile(staleAssignment);
      await assignProfileToRepository(repoPath, staleAssignment.id);

      await rm(repoPath, { recursive: true, force: true });
      await createRepository(rootPath);
      await gitExecutor.run(['config', '--local', 'user.name', 'Replacement Repository User'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.email', 'replacement-repository@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });

      await assignProfileToRepository(repoPath, undefined, staleAssignment.id);

      expect(await localConfig(repoPath, 'user.name')).toBe('Replacement Repository User');
      expect(await localConfig(repoPath, 'user.email')).toBe('replacement-repository@example.test');
      expect(await localConfig(repoPath, 'user.signingkey')).toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('merges the prior baseline per key when repository config partially drifts', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      await gitExecutor.run(['config', '--local', 'user.signingkey', 'ORIGINAL-SIGNING-KEY'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      const first = profile('partial-drift-first', { signingKey: 'FIRST-SIGNING-KEY' });
      const second = profile('partial-drift-second', { signingKey: 'SECOND-SIGNING-KEY' });
      saveProfile(first);
      saveProfile(second);
      await assignProfileToRepository(repoPath, first.id);
      await gitExecutor.run(['config', '--local', 'user.email', 'external-drift@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });

      await assignProfileToRepository(repoPath, second.id, first.id);
      await assignProfileToRepository(repoPath, undefined, second.id);

      expect(await localConfig(repoPath, 'user.name')).toBe('Original User');
      expect(await localConfig(repoPath, 'user.email')).toBe('external-drift@example.test');
      expect(await localConfig(repoPath, 'user.signingkey')).toBe('ORIGINAL-SIGNING-KEY');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('round-trips local config whitespace and embedded newlines exactly', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      const originalName = '  Original\nRepository User  ';
      await gitExecutor.run(['config', '--local', 'user.name', originalName], {
        cwd: repoPath,
        kind: 'mutation'
      });
      const before = await rawLocalConfig(repoPath, 'user.name');
      const assigned = profile('exact-config');
      saveProfile(assigned);

      await assignProfileToRepository(repoPath, assigned.id);
      await assignProfileToRepository(repoPath, undefined, assigned.id);

      expect(await rawLocalConfig(repoPath, 'user.name')).toBe(before);
      expect(before).toBe(`${originalName}\0`);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('commits with the assigned profile even when repository config has drifted', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-profiles-'));

    try {
      const repoPath = await createRepository(rootPath);
      const assigned = profile('commit-author');
      saveProfile(assigned);
      await assignProfileToRepository(repoPath, assigned.id);
      await gitExecutor.run(['config', '--local', 'user.name', 'Drifted User'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await gitExecutor.run(['config', '--local', 'user.email', 'drifted@example.test'], {
        cwd: repoPath,
        kind: 'mutation'
      });
      await writeFile(join(repoPath, 'profile-commit.txt'), 'profile commit\n');
      const tab = { path: repoPath, assignedProfileId: assigned.id };
      await stageFile(tab, 'profile-commit.txt');
      await commitChanges(tab, { message: 'profile identity', amend: false });

      const author = await gitExecutor.run(['log', '-1', '--format=%an%x00%ae'], { cwd: repoPath });
      expect(author.stdout.trim()).toBe(`${assigned.name}\0${assigned.email}`);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

function profile(
  suffix: string,
  overrides: Partial<Pick<GitProfile, 'signingKey' | 'sshKeyPath' | 'ghConfigDir' | 'remoteUrlPatterns'>> = {}
): GitProfile {
  const id = `profile-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    name: `${suffix} User`,
    email: `${suffix}@example.test`,
    avatarColor: '#5fd6c3',
    ...overrides
  };
}

async function createRepository(rootPath: string): Promise<string> {
  const repoPath = join(rootPath, 'repo');
  await mkdir(repoPath);
  await gitExecutor.run(['init'], { cwd: repoPath, kind: 'mutation' });
  await gitExecutor.run(['config', '--local', 'user.name', 'Original User'], { cwd: repoPath, kind: 'mutation' });
  await gitExecutor.run(['config', '--local', 'user.email', 'original@example.test'], {
    cwd: repoPath,
    kind: 'mutation'
  });
  return repoPath;
}

async function localConfig(repoPath: string, key: string): Promise<string | undefined> {
  const result = await gitExecutor.run(['config', '--local', '--get', key], {
    cwd: repoPath,
    allowedExitCodes: [1]
  });
  return result.stdout.trim() || undefined;
}

async function rawLocalConfig(repoPath: string, key: string): Promise<string> {
  const result = await gitExecutor.run(['config', '--local', '--null', '--get-all', key], {
    cwd: repoPath,
    allowedExitCodes: [1]
  });
  return result.stdout;
}
