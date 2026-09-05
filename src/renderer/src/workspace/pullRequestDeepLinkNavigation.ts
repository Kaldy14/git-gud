import { pullRequestDeepLinkTargetKey, type PullRequestDeepLinkTarget } from '@shared/pullRequestDeepLink';
import type {
  GitHubPullRequestInbox,
  GitHubPullRequestSummary,
  GitProfile
} from '@shared/types';

export { pullRequestDeepLinkTargetKey } from '@shared/pullRequestDeepLink';

export function profilesForPullRequestDeepLink(
  target: PullRequestDeepLinkTarget,
  profiles: readonly GitProfile[],
  activeProfileId: string | undefined
): GitProfile[] {
  const matchingProfiles = profiles.filter(
    (profile) =>
      Boolean(profile.ghConfigDir && profile.githubLogin) &&
      (profile.githubHost || 'github.com').toLowerCase() ===
        target.host.toLowerCase()
  );

  const activeProfile = matchingProfiles.find(
    (profile) => profile.id === activeProfileId
  );

  return activeProfile
    ? [
        activeProfile,
        ...matchingProfiles.filter((profile) => profile.id !== activeProfile.id)
      ]
    : matchingProfiles;
}

export function findPullRequestForDeepLink(
  target: PullRequestDeepLinkTarget,
  inbox: GitHubPullRequestInbox
): GitHubPullRequestSummary | undefined {
  if (inbox.host.toLowerCase() !== target.host.toLowerCase()) {
    return undefined;
  }

  return inbox.pullRequests.find(
    (pullRequest) =>
      pullRequest.owner.toLowerCase() === target.owner.toLowerCase() &&
      pullRequest.repository.toLowerCase() === target.repository.toLowerCase() &&
      pullRequest.number === target.number
  );
}

export function appendPullRequestDeepLinkTarget(
  targets: readonly PullRequestDeepLinkTarget[],
  target: PullRequestDeepLinkTarget
): PullRequestDeepLinkTarget[] {
  const key = pullRequestDeepLinkTargetKey(target);

  return targets.some((candidate) => pullRequestDeepLinkTargetKey(candidate) === key)
    ? [...targets]
    : [...targets, target];
}
