import Store from 'electron-store';

import type { GitIdentity, GitProfile, RepoProfileState, WorkspaceState } from '@shared/types';

import { gitExecutor } from './git/exec';
import { assignWorkspaceProfile } from './store';

type ProfileStoreShape = {
  profiles: GitProfile[];
};

const profileStore = new Store<ProfileStoreShape>({
  name: 'git-gud-profiles',
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
  profileId: string | undefined
): Promise<WorkspaceState> {
  if (!profileId) {
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

async function applyProfileToRepository(repoPath: string, profile: GitProfile): Promise<void> {
  await gitExecutor.run(['config', 'user.name', profile.name], { cwd: repoPath, kind: 'mutation' });
  await gitExecutor.run(['config', 'user.email', profile.email], { cwd: repoPath, kind: 'mutation' });

  if (profile.signingKey) {
    await gitExecutor.run(['config', 'user.signingkey', profile.signingKey], { cwd: repoPath, kind: 'mutation' });
  }

  if (profile.sshKeyPath) {
    await gitExecutor.run(['config', 'core.sshCommand', `ssh -i ${quoteShellArg(profile.sshKeyPath)}`], {
      cwd: repoPath,
      kind: 'mutation'
    });
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
