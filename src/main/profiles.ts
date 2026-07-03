import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';

import type { GitIdentity, GitProfile, RepoProfileState, WorkspaceState } from '@shared/types';

import { gitExecutor } from './git/exec';

type ProfileStoreShape = {
  profiles: GitProfile[];
};

const profileStore = new Store<ProfileStoreShape>({
  name: 'git-gud-profiles',
  ...testStoreDirectory('profiles'),
  defaults: {
    profiles: []
  }
});

export function listProfiles(): GitProfile[] {
  return profileStore.get('profiles', []);
}

export function saveProfile(profile: GitProfile): GitProfile[] {
  const normalizedProfile = normalizeProfile(profile);
  const profiles = listProfiles();
  const existingIndex = profiles.findIndex((candidate) => candidate.id === normalizedProfile.id);
  const nextProfiles =
    existingIndex === -1
      ? [...profiles, normalizedProfile]
      : profiles.map((candidate) => (candidate.id === normalizedProfile.id ? normalizedProfile : candidate));

  profileStore.set('profiles', nextProfiles);
  return nextProfiles;
}

export async function assignProfileToRepository(
  repoPath: string,
  profileId: string | undefined,
  previouslyAssignedProfileId?: string
): Promise<WorkspaceState> {
  const { assignWorkspaceProfile } = await import('./store');

  if (!profileId) {
    await clearAssignedProfileFromRepository(repoPath, previouslyAssignedProfileId);
    return assignWorkspaceProfile(repoPath, undefined);
  }

  const profile = listProfiles().find((candidate) => candidate.id === profileId);

  if (!profile) {
    throw new Error(`Profile ${profileId} does not exist.`);
  }

  await applyProfileToRepository(repoPath, profile);
  return assignWorkspaceProfile(repoPath, profile.id);
}

export async function getRepoProfileState(
  repoPath: string,
  assignedProfileId: string | undefined
): Promise<RepoProfileState> {
  const profiles = listProfiles();
  const activeProfile = assignedProfileId ? profiles.find((profile) => profile.id === assignedProfileId) : undefined;
  const effectiveIdentity = activeProfile
    ? {
        name: activeProfile.name,
        email: activeProfile.email,
        source: 'profile' as const
      }
    : await readEffectiveIdentity(repoPath);

  return {
    profiles,
    activeProfile,
    effectiveIdentity
  };
}

export function suggestProfileForRepository(repoPath: string, remoteUrls: string[]): GitProfile | undefined {
  const profiles = listProfiles();

  return profiles.find((profile) => {
    const patterns = profile.remoteUrlPatterns ?? [];
    return patterns.some((pattern) => repoPath.includes(pattern) || remoteUrls.some((url) => url.includes(pattern)));
  });
}

export function createProfileCommandEnv(assignedProfileId: string | undefined): NodeJS.ProcessEnv | undefined {
  if (!assignedProfileId) {
    return undefined;
  }

  const profile = listProfiles().find((candidate) => candidate.id === assignedProfileId);

  if (!profile?.ghConfigDir) {
    return undefined;
  }

  return {
    GH_CONFIG_DIR: profile.ghConfigDir
  };
}

async function applyProfileToRepository(repoPath: string, profile: GitProfile): Promise<void> {
  await gitExecutor.run(['config', 'user.name', profile.name], { cwd: repoPath, kind: 'mutation' });
  await gitExecutor.run(['config', 'user.email', profile.email], { cwd: repoPath, kind: 'mutation' });

  if (profile.signingKey) {
    await gitExecutor.run(['config', 'user.signingkey', profile.signingKey], { cwd: repoPath, kind: 'mutation' });
  }

  if (profile.sshKeyPath) {
    await gitExecutor.run(['config', 'core.sshCommand', createSshCommand(profile.sshKeyPath)], {
      cwd: repoPath,
      kind: 'mutation'
    });
  }
}

async function clearAssignedProfileFromRepository(
  repoPath: string,
  previouslyAssignedProfileId: string | undefined
): Promise<void> {
  const profile = previouslyAssignedProfileId
    ? listProfiles().find((candidate) => candidate.id === previouslyAssignedProfileId)
    : undefined;

  if (!profile) {
    return;
  }

  await unsetLocalConfigIfProfileValue(repoPath, 'user.name', profile.name);
  await unsetLocalConfigIfProfileValue(repoPath, 'user.email', profile.email);

  if (profile.signingKey) {
    await unsetLocalConfigIfProfileValue(repoPath, 'user.signingkey', profile.signingKey);
  }

  if (profile.sshKeyPath) {
    await unsetLocalConfigIfProfileValue(repoPath, 'core.sshCommand', createSshCommand(profile.sshKeyPath));
  }
}

async function readEffectiveIdentity(repoPath: string): Promise<GitIdentity> {
  const name = await readScopedConfig(repoPath, 'user.name');
  const email = await readScopedConfig(repoPath, 'user.email');

  if (name || email) {
    return {
      name: name?.value,
      email: email?.value,
      source: selectIdentitySource(name?.scope ?? email?.scope)
    };
  }

  return {
    source: 'unknown'
  };
}

async function readScopedConfig(repoPath: string, key: string): Promise<{ scope: string; value: string } | undefined> {
  try {
    const result = await gitExecutor.run(['config', '--show-scope', '--get', key], { cwd: repoPath });
    const value = result.stdout.trim();
    const [scope, configValue] = value.split('\t', 2);

    if (!scope || !configValue) {
      return undefined;
    }

    return {
      scope,
      value: configValue
    };
  } catch {
    return undefined;
  }
}

async function readLocalConfig(repoPath: string, key: string): Promise<string | undefined> {
  try {
    const result = await gitExecutor.run(['config', '--local', '--get', key], { cwd: repoPath });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function unsetLocalConfigIfProfileValue(repoPath: string, key: string, profileValue: string): Promise<void> {
  const currentValue = await readLocalConfig(repoPath, key);

  if (currentValue !== profileValue) {
    return;
  }

  await gitExecutor.run(['config', '--local', '--unset-all', key], {
    cwd: repoPath,
    kind: 'mutation',
    allowedExitCodes: [5]
  });
}

function selectIdentitySource(scope: string | undefined): GitIdentity['source'] {
  return scope === 'local' || scope === 'worktree' || scope === 'command' ? 'repo-config' : 'global-config';
}

function normalizeProfile(profile: GitProfile): GitProfile {
  const id = profile.id.trim();
  const name = profile.name.trim();
  const email = profile.email.trim();

  if (!id) {
    throw new Error('Profile id is required.');
  }

  if (!name || !email) {
    throw new Error('Profile name and email are required.');
  }

  return {
    ...profile,
    id,
    name,
    email,
    avatarColor: profile.avatarColor || '#5fd6c3'
  };
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createSshCommand(sshKeyPath: string): string {
  return `ssh -i ${quoteShellArg(sshKeyPath)}`;
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
