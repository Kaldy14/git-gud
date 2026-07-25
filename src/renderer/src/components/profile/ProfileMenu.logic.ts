import type { GitHubCliAccount, GitProfile } from '@shared/types';

export type GitProfileDraft = {
  editingProfileId?: string;
  name: string;
  email: string;
  avatarColor: string;
  sshKeyPath: string;
  ghConfigDir: string;
  githubLogin: string;
  githubHost: string;
  signingKey: string;
  remoteUrlPatterns: string;
};

export function gitProfileFromDraft(
  draft: GitProfileDraft,
  githubAccount?: GitHubCliAccount,
  now = Date.now()
): GitProfile | undefined {
  const name = draft.name.trim();
  const email = draft.email.trim();

  if (!name || !email) {
    return undefined;
  }

  return {
    id: draft.editingProfileId ?? createProfileId(name, email, now),
    name,
    email,
    avatarColor: draft.avatarColor,
    sshKeyPath: draft.sshKeyPath.trim() || undefined,
    ghConfigDir: githubAccount?.configDir ?? (draft.ghConfigDir.trim() || undefined),
    githubLogin: githubAccount?.login ?? (draft.githubLogin.trim() || undefined),
    githubHost: githubAccount?.host ?? (draft.githubHost.trim() || undefined),
    signingKey: draft.signingKey.trim() || undefined,
    remoteUrlPatterns: draft.remoteUrlPatterns
      .split(/[\n,]+/)
      .map((pattern) => pattern.trim())
      .filter(Boolean)
  };
}

function createProfileId(name: string, email: string, now: number): string {
  const slug =
    (email || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile';

  return `${slug}-${now.toString(36)}`;
}
