import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, UserRoundPlus, X } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { useGitHubPullRequestReviewerCandidates } from '@renderer/queries/github';
import type {
  GitHubPullRequestDetail,
  GitHubPullRequestReviewerCandidate
} from '@shared/types';

import { PullRequestReviewerAvatars } from './PullRequestReviewerAvatars';
import {
  filterReviewerCandidates,
  findCandidateReviewer,
  mergeCurrentReviewerCandidates,
  reviewerCandidateDescription,
  reviewerCandidateLabel
} from './reviewerPickerPresentation';

type ReviewerNotice = { tone: 'success' | 'danger'; message: string };

export function PullRequestReviewerPicker({
  detail,
  onReviewersChanged,
  onNotice
}: {
  detail: GitHubPullRequestDetail;
  onReviewersChanged: () => Promise<void>;
  onNotice: (notice: ReviewerNotice) => void;
}): ReactElement {
  const canManageReviewers = detail.state === undefined || detail.state === 'open';
  const hasReviewers = detail.reviewers.length > 0;
  const triggerLabel = canManageReviewers
    ? hasReviewers ? 'Manage reviewers' : 'Add reviewer'
    : 'Reviewers';
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const locator = {
    profileId: detail.profileId,
    owner: detail.owner,
    repository: detail.repository,
    number: detail.number
  };
  const candidatesQuery = useGitHubPullRequestReviewerCandidates(locator, isOpen);
  const candidates = useMemo(
    () => filterReviewerCandidates(
      mergeCurrentReviewerCandidates(candidatesQuery.data ?? [], detail.reviewers),
      detail.reviewers,
      detail.author,
      query
    ),
    [candidatesQuery.data, detail.author, detail.reviewers, query]
  );
  const mutation = useMutation({
    mutationFn: async ({
      candidate,
      requested
    }: {
      candidate: GitHubPullRequestReviewerCandidate;
      requested: boolean;
    }) => window.api.updateGitHubPullRequestReviewer({
      ...locator,
      reviewer: candidate.kind === 'user'
        ? { kind: 'user', login: candidate.login }
        : { kind: 'team', slug: candidate.slug },
      requested
    }),
    onSuccess: async (result) => {
      await onReviewersChanged();
      onNotice({ tone: 'success', message: result.message });
    },
    onError: (error) => {
      onNotice({
        tone: 'danger',
        message: error instanceof Error
          ? error.message
          : 'GitHub could not update the review request.'
      });
    }
  });

  return (
    <PopoverPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setQuery('');
        }
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          className="pr-reviewer-picker-trigger"
          type="button"
          disabled={!canManageReviewers}
          aria-label={triggerLabel}
          title={canManageReviewers ? triggerLabel : 'Closed pull requests cannot request reviewers'}
        >
          {hasReviewers ? (
            <PullRequestReviewerAvatars reviewers={detail.reviewers} />
          ) : (
            <>
              <UserRoundPlus size={14} aria-hidden="true" />
              <span className="pr-reviewer-picker-trigger-label">
                {canManageReviewers ? 'Add reviewer' : 'No reviewers'}
              </span>
            </>
          )}
          <ChevronDown size={10} aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="pr-reviewer-picker"
          align="end"
          sideOffset={7}
          collisionPadding={10}
          aria-label="Manage pull request reviewers"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLInputElement>('.pr-reviewer-picker-search input')?.focus();
          }}
        >
          <header>
            <strong>Reviewers</strong>
            <PopoverPrimitive.Close asChild>
              <button type="button" aria-label="Close reviewer picker" title="Close">
                <X size={12} />
              </button>
            </PopoverPrimitive.Close>
          </header>
          <label className="pr-reviewer-picker-search">
            <Search size={12} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people or teams"
              aria-label="Search people or teams"
            />
          </label>
          <div className="pr-reviewer-picker-list" role="listbox" aria-label="Reviewer candidates">
            {candidatesQuery.isLoading ? (
              <ReviewerPickerMessage icon={<Loader2 className="animate-spin" size={13} />}>
                Loading reviewers
              </ReviewerPickerMessage>
            ) : candidatesQuery.error ? (
              <ReviewerPickerMessage>
                {candidatesQuery.error instanceof Error
                  ? candidatesQuery.error.message
                  : 'Could not load reviewers.'}
              </ReviewerPickerMessage>
            ) : candidates.length === 0 ? (
              <ReviewerPickerMessage>
                {query.trim() ? 'No matching reviewers.' : 'No reviewers are available.'}
              </ReviewerPickerMessage>
            ) : (
              candidates.map((candidate) => {
                const reviewer = findCandidateReviewer(candidate, detail.reviewers);
                const requested = reviewer?.state === 'pending';
                const pending = mutation.isPending && mutation.variables.candidate.id === candidate.id;
                return (
                  <button
                    className="pr-reviewer-picker-option"
                    type="button"
                    role="option"
                    aria-selected={requested}
                    disabled={mutation.isPending}
                    key={candidate.id}
                    onClick={() => mutation.mutate({ candidate, requested: !requested })}
                  >
                    <ReviewerCandidateAvatar candidate={candidate} />
                    <span>
                      <strong>{reviewerCandidateLabel(candidate)}</strong>
                      <small>{reviewerCandidateDescription(candidate, reviewer)}</small>
                    </span>
                    <span className="pr-reviewer-picker-check" aria-hidden="true">
                      {pending ? (
                        <Loader2 className="animate-spin" size={12} />
                      ) : requested ? (
                        <Check size={12} strokeWidth={3} />
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <footer>Selections are saved to GitHub immediately.</footer>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function ReviewerPickerMessage({
  icon,
  children
}: {
  icon?: ReactElement;
  children: string;
}): ReactElement {
  return <p className="pr-reviewer-picker-message">{icon}{children}</p>;
}

function ReviewerCandidateAvatar({
  candidate
}: {
  candidate: GitHubPullRequestReviewerCandidate;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);
  const label = reviewerCandidateLabel(candidate);

  return candidate.avatarUrl && !didAvatarFail ? (
    <img
      className="pr-reviewer-picker-avatar"
      src={candidate.avatarUrl}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setDidAvatarFail(true)}
    />
  ) : (
    <span className="pr-reviewer-picker-avatar" aria-hidden="true">
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
