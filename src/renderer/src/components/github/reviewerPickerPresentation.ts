import type {
  GitHubPullRequestReviewer,
  GitHubPullRequestReviewerCandidate
} from '@shared/types';

export function mergeCurrentReviewerCandidates(
  candidates: GitHubPullRequestReviewerCandidate[],
  reviewers: GitHubPullRequestReviewer[]
): GitHubPullRequestReviewerCandidate[] {
  const merged = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  for (const reviewer of reviewers) {
    if (reviewer.state !== 'pending') {
      continue;
    }

    const [organization, slug, ...rest] = reviewer.author.split('/');
    const candidate = organization && slug && rest.length === 0
      ? {
          id: `team:${organization.toLowerCase()}/${slug.toLowerCase()}`,
          kind: 'team' as const,
          organization,
          slug,
          name: slug,
          avatarUrl: reviewer.authorAvatarUrl
        }
      : {
          id: `user:${reviewer.author.toLowerCase()}`,
          kind: 'user' as const,
          login: reviewer.author,
          avatarUrl: reviewer.authorAvatarUrl
        };
    merged.set(candidate.id, merged.get(candidate.id) ?? candidate);
  }

  return [...merged.values()];
}

export function filterReviewerCandidates(
  candidates: GitHubPullRequestReviewerCandidate[],
  reviewers: GitHubPullRequestReviewer[],
  author: string,
  query: string
): GitHubPullRequestReviewerCandidate[] {
  const normalizedQuery = query.trim().toLowerCase();

  return candidates
    .filter((candidate) =>
      candidate.kind === 'team' || candidate.login.toLowerCase() !== author.toLowerCase()
    )
    .filter((candidate) => {
      if (!normalizedQuery) {
        return true;
      }

      return [reviewerCandidateLabel(candidate), candidate.name]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .sort((left, right) => {
      const requestedOrder = Number(isCandidateRequested(right, reviewers)) -
        Number(isCandidateRequested(left, reviewers));
      return requestedOrder || reviewerCandidateLabel(left).localeCompare(
        reviewerCandidateLabel(right),
        undefined,
        { sensitivity: 'base' }
      );
    });
}

export function reviewerCandidateDescription(
  candidate: GitHubPullRequestReviewerCandidate,
  reviewer: GitHubPullRequestReviewer | undefined
): string {
  if (reviewer?.state === 'pending') {
    return 'Review requested';
  }
  if (reviewer?.state === 'approved') {
    return 'Approved';
  }
  if (reviewer?.state === 'changes-requested') {
    return 'Requested changes';
  }
  if (candidate.kind === 'team') {
    return candidate.name;
  }
  return candidate.name ?? 'Collaborator';
}

export function findCandidateReviewer(
  candidate: GitHubPullRequestReviewerCandidate,
  reviewers: GitHubPullRequestReviewer[]
): GitHubPullRequestReviewer | undefined {
  const label = reviewerCandidateLabel(candidate);
  return reviewers.find((reviewer) => reviewer.author.toLowerCase() === label.toLowerCase());
}

export function reviewerCandidateLabel(candidate: GitHubPullRequestReviewerCandidate): string {
  return candidate.kind === 'user'
    ? candidate.login
    : `${candidate.organization}/${candidate.slug}`;
}

function isCandidateRequested(
  candidate: GitHubPullRequestReviewerCandidate,
  reviewers: GitHubPullRequestReviewer[]
): boolean {
  return findCandidateReviewer(candidate, reviewers)?.state === 'pending';
}
