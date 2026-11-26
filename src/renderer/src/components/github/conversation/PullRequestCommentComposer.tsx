import type { ReactElement } from 'react';
import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';

import type { GitHubPullRequestLocator } from '@shared/types';
import { useReportUnsavedText } from '../workspace/pullRequestLeaveGuard';

export function PullRequestCommentComposer({ hidden, isOpen, formId, onClose, locator, onPosted }: {
  hidden: boolean;
  isOpen: boolean;
  formId: string;
  onClose: () => void;
  locator: GitHubPullRequestLocator;
  onPosted: (message: string) => void;
}): ReactElement {
  const inputId = useId();
  const [commentBody, setCommentBody] = useState('');
  useReportUnsavedText(isOpen && commentBody.trim().length > 0);
  const commentMutation = useMutation({
    mutationFn: (body: string) => window.api.addGitHubPullRequestComment({ ...locator, body }),
    onSuccess: (result) => {
      setCommentBody('');
      onClose();
      onPosted(result.message);
    }
  });
  return (
    <div className="pr-comment-composer" hidden={hidden || !isOpen}>
      {isOpen ? (
        <form id={formId} onSubmit={(event) => {
          event.preventDefault();
          if (commentBody.trim() && !commentMutation.isPending) commentMutation.mutate(commentBody.trim());
        }}>
          <textarea
            id={inputId}
            aria-label="Add a comment"
            autoFocus
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Leave a comment on this pull request…"
            rows={3}
            maxLength={65_536}
            disabled={commentMutation.isPending}
          />
          {commentMutation.error ? <p role="alert">{commentMutation.error.message}</p> : null}
          <div className="pr-comment-composer-actions">
            <button className="btn-subtle btn-compact" type="button" disabled={commentMutation.isPending} onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary btn-compact" type="submit" disabled={!commentBody.trim() || commentMutation.isPending}>
              <Send size={12} />
              {commentMutation.isPending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
