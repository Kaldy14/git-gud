import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import Store from 'electron-store';

import type { GitIdentity, GitProfile, RepoProfileState, WorkspaceState } from '@shared/types';

import { gitExecutor } from './git/exec';

type ProfileStoreShape = {
  profiles: GitProfile[];
  assignmentsByRepo: Record<string, StoredProfileAssignment>;
};

type StoredProfileAssignment = {
  profileId: string;
  baseline: LocalProfileConfig;
  applied: LocalProfileConfig;
  repositoryIdentity?: string;
};

const profileStore = new Store<ProfileStoreShape>({
  name: 'git-gud-profiles',
  ...testStoreDirectory('profiles'),
  clearInvalidConfig: true,
  defaults: {
    profiles: [],
    assignmentsByRepo: {}
  }
});

export function listProfiles(): GitProfile[] {
  const storedProfiles: unknown = profileStore.get('profiles', []);

  return normalizeStoredProfiles(storedProfiles);
}

export function normalizeStoredProfiles(storedProfiles: unknown): GitProfile[] {
  if (!Array.isArray(storedProfiles)) {
    return [];
  }

  return storedProfiles.filter(isGitProfile).map(normalizeProfile);
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

  return gitExecutor.transaction(repoPath, async () => {
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
  });
}

export async function getRepoProfileState(
  repoPath: string,
  assignedProfileId: string | undefined,
  remoteUrls: string[] = []
): Promise<RepoProfileState> {
  const profiles = listProfiles();
  const activeProfile = assignedProfileId ? profiles.find((profile) => profile.id === assignedProfileId) : undefined;
  const configuredIdentity = await readEffectiveIdentity(repoPath);
  const identityMatchesActiveProfile = activeProfile
    ? configuredIdentity.name === activeProfile.name && configuredIdentity.email === activeProfile.email
    : undefined;
  const effectiveIdentity = identityMatchesActiveProfile
    ? {
        ...configuredIdentity,
        source: 'profile' as const
      }
    : configuredIdentity;
  const suggestedProfile = activeProfile ? undefined : suggestProfileForRepository(repoPath, remoteUrls);

  return {
    profiles,
    activeProfile,
    suggestedProfile,
    effectiveIdentity,
    identityMatchesActiveProfile
  };
}

function suggestProfileForRepository(repoPath: string, remoteUrls: string[]): GitProfile | undefined {
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

  if (!profile) {
    return undefined;
  }

  return {
    GIT_AUTHOR_NAME: profile.name,
    GIT_AUTHOR_EMAIL: profile.email,
    GIT_COMMITTER_NAME: profile.name,
    GIT_COMMITTER_EMAIL: profile.email,
    ...(profile.ghConfigDir ? { GH_CONFIG_DIR: profile.ghConfigDir } : {})
  };
}

async function applyProfileToRepository(repoPath: string, profile: GitProfile): Promise<void> {
  const snapshot = await readLocalProfileConfig(repoPath);
  const existingAssignment = readStoredProfileAssignment(repoPath);
  const repositoryIdentity = await readRepositoryIdentity(repoPath);
  const canReuseBaseline = existingAssignment
    ? existingAssignment.repositoryIdentity
      ? existingAssignment.repositoryIdentity === repositoryIdentity
      : sameLocalProfileConfig(snapshot, existingAssignment.applied)
    : false;
  const baseline =
    existingAssignment && canReuseBaseline
      ? mergeProfileBaseline(snapshot, existingAssignment)
      : snapshot;

  try {
    await setLocalConfig(repoPath, 'user.name', profile.name);
    await setLocalConfig(repoPath, 'user.email', profile.email);
    await synchronizeOptionalLocalConfig(repoPath, 'user.signingkey', profile.signingKey);
    await synchronizeOptionalLocalConfig(
      repoPath,
      'core.sshCommand',
      profile.sshKeyPath ? createSshCommand(profile.sshKeyPath) : undefined
    );
    storeProfileAssignment(repoPath, {
      profileId: profile.id,
      baseline,
      applied: localConfigForProfile(profile),
      repositoryIdentity
    });
  } catch (error) {
    await restoreLocalProfileConfig(repoPath, snapshot);
    throw error;
  }
}

async function clearAssignedProfileFromRepository(
  repoPath: string,
  previouslyAssignedProfileId: string | undefined
): Promise<void> {
  const storedAssignment = readStoredProfileAssignment(repoPath);

  if (storedAssignment) {
    if (
      storedAssignment.repositoryIdentity &&
      storedAssignment.repositoryIdentity !== (await readRepositoryIdentity(repoPath))
    ) {
      deleteStoredProfileAssignment(repoPath);
      return;
    }

    await restoreProfileBaselineWhenUnchanged(repoPath, storedAssignment);
    deleteStoredProfileAssignment(repoPath);
    return;
  }

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
  const [name, email, authorIdent] = await Promise.all([
    readScopedConfig(repoPath, 'user.name'),
    readScopedConfig(repoPath, 'user.email'),
    readAuthorIdentity(repoPath)
  ]);

  if (authorIdent || name || email) {
    return {
      name: authorIdent?.name ?? name?.value,
      email: authorIdent?.email ?? email?.value,
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

type LocalProfileConfig = Record<(typeof profileConfigKeys)[number], string[]>;

const profileConfigKeys = ['user.name', 'user.email', 'user.signingkey', 'core.sshCommand'] as const;

async function readLocalProfileConfig(repoPath: string): Promise<LocalProfileConfig> {
  const entries = await Promise.all(
    profileConfigKeys.map(async (key) => {
      try {
        const result = await gitExecutor.run(['config', '--local', '--null', '--get-all', key], {
          cwd: repoPath,
          allowedExitCodes: [1]
        });
        const values = parseNulConfigValues(result.stdout);
        return [key, values] as const;
      } catch {
        return [key, []] as const;
      }
    })
  );

  return Object.fromEntries(entries) as LocalProfileConfig;
}

async function restoreLocalProfileConfig(repoPath: string, snapshot: LocalProfileConfig): Promise<void> {
  for (const key of profileConfigKeys) {
    await unsetLocalConfig(repoPath, key);

    for (const value of snapshot[key]) {
      await gitExecutor.run(['config', '--local', '--add', key, value], { cwd: repoPath, kind: 'mutation' });
    }
  }
}

async function restoreProfileBaselineWhenUnchanged(
  repoPath: string,
  assignment: StoredProfileAssignment
): Promise<void> {
  const current = await readLocalProfileConfig(repoPath);

  for (const key of profileConfigKeys) {
    if (!sameValues(current[key], assignment.applied[key])) {
      continue;
    }

    await unsetLocalConfig(repoPath, key);

    for (const value of assignment.baseline[key]) {
      await gitExecutor.run(['config', '--local', '--add', key, value], {
        cwd: repoPath,
        kind: 'mutation'
      });
    }
  }
}

function localConfigForProfile(profile: GitProfile): LocalProfileConfig {
  return {
    'user.name': [profile.name],
    'user.email': [profile.email],
    'user.signingkey': profile.signingKey ? [profile.signingKey] : [],
    'core.sshCommand': profile.sshKeyPath ? [createSshCommand(profile.sshKeyPath)] : []
  };
}

function readStoredProfileAssignment(repoPath: string): StoredProfileAssignment | undefined {
  const assignments: unknown = profileStore.get('assignmentsByRepo', {});

  if (!isRecord(assignments)) {
    return undefined;
  }

  const assignment = assignments[repoPath];
  return isStoredProfileAssignment(assignment) ? assignment : undefined;
}

function storeProfileAssignment(repoPath: string, assignment: StoredProfileAssignment): void {
  const assignments = profileStore.get('assignmentsByRepo', {});
  profileStore.set('assignmentsByRepo', {
    ...assignments,
    [repoPath]: assignment
  });
}

function deleteStoredProfileAssignment(repoPath: string): void {
  const assignments = profileStore.get('assignmentsByRepo', {});
  const nextAssignments = { ...assignments };
  delete nextAssignments[repoPath];
  profileStore.set('assignmentsByRepo', nextAssignments);
}

function isStoredProfileAssignment(value: unknown): value is StoredProfileAssignment {
  if (!isRecord(value) || typeof value.profileId !== 'string') {
    return false;
  }

  return (
    isLocalProfileConfig(value.baseline) &&
    isLocalProfileConfig(value.applied) &&
    isOptionalString(value.repositoryIdentity)
  );
}

function isLocalProfileConfig(value: unknown): value is LocalProfileConfig {
  return (
    isRecord(value) &&
    profileConfigKeys.every(
      (key) => Array.isArray(value[key]) && value[key].every((entry) => typeof entry === 'string')
    )
  );
}

function sameValues(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameLocalProfileConfig(first: LocalProfileConfig, second: LocalProfileConfig): boolean {
  return profileConfigKeys.every((key) => sameValues(first[key], second[key]));
}

function mergeProfileBaseline(
  snapshot: LocalProfileConfig,
  assignment: StoredProfileAssignment
): LocalProfileConfig {
  return Object.fromEntries(
    profileConfigKeys.map((key) => [
      key,
      sameValues(snapshot[key], assignment.applied[key]) ? assignment.baseline[key] : snapshot[key]
    ])
  ) as LocalProfileConfig;
}

async function readRepositoryIdentity(repoPath: string): Promise<string> {
  const result = await gitExecutor.run(['rev-parse', '--absolute-git-dir'], { cwd: repoPath });
  const gitDir = result.stdout.replace(/\r?\n$/, '');
  const metadata = await stat(gitDir);
  return `${metadata.dev}:${metadata.ino}:${metadata.birthtimeMs}`;
}

function parseNulConfigValues(output: string): string[] {
  if (!output) {
    return [];
  }

  const values = output.split('\0');

  if (values.at(-1) === '') {
    values.pop();
  }

  return values;
}

async function setLocalConfig(repoPath: string, key: string, value: string): Promise<void> {
  await gitExecutor.run(['config', '--local', '--replace-all', key, value], { cwd: repoPath, kind: 'mutation' });
}

async function synchronizeOptionalLocalConfig(repoPath: string, key: string, value: string | undefined): Promise<void> {
  if (value) {
    await setLocalConfig(repoPath, key, value);
    return;
  }

  await unsetLocalConfig(repoPath, key);
}

async function unsetLocalConfig(repoPath: string, key: string): Promise<void> {
  await gitExecutor.run(['config', '--local', '--unset-all', key], {
    cwd: repoPath,
    kind: 'mutation',
    allowedExitCodes: [5]
  });
}

async function readAuthorIdentity(repoPath: string): Promise<{ name: string; email: string } | undefined> {
  try {
    const result = await gitExecutor.run(['var', 'GIT_AUTHOR_IDENT'], { cwd: repoPath });
    const match = /^(.*) <([^<>]*)> \d+ [+-]\d{4}$/.exec(result.stdout.trim());

    if (!match?.[1] || match[2] === undefined) {
      return undefined;
    }

    return {
      name: match[1],
      email: match[2]
    };
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
    avatarColor: profile.avatarColor || '#5fd6c3',
    sshKeyPath: normalizeOptionalValue(profile.sshKeyPath),
    ghConfigDir: normalizeOptionalValue(profile.ghConfigDir),
    signingKey: normalizeOptionalValue(profile.signingKey),
    remoteUrlPatterns: profile.remoteUrlPatterns
      ?.map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0)
  };
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createSshCommand(sshKeyPath: string): string {
  return `ssh -o IdentitiesOnly=yes -i ${quoteShellArg(sshKeyPath)}`;
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isGitProfile(value: unknown): value is GitProfile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.email === 'string' &&
    value.email.trim().length > 0 &&
    typeof value.avatarColor === 'string' &&
    isOptionalString(value.sshKeyPath) &&
    isOptionalString(value.ghConfigDir) &&
    isOptionalString(value.signingKey) &&
    (value.remoteUrlPatterns === undefined ||
      (Array.isArray(value.remoteUrlPatterns) &&
        value.remoteUrlPatterns.every((pattern) => typeof pattern === 'string')))
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
