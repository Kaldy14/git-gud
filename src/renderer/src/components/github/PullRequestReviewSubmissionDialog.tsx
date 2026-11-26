import type { FormEvent, ReactElement } from 'react';
import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, CornerDownRight, FileText, Loader2, MessageSquare, Send, ShieldCheck, Trash2, X } from 'lucide-react';

import { PullRequestPanel } from './PullRequestPanel';
import type { PullRequestReviewDraft, ReviewEvent } from './pullRequestReviewDrafts';
import { isReviewSummaryRequired } from './pullRequestReviewSubmission';
import { useReportUnsavedText } from './workspace/pullRequestLeaveGuard';

export function PullRequestReviewSubmissionDialog({
  open,
  event,
  onEventChange,
  isOwnPullRequest,
  drafts,
  isSubmitting,
  isCopyingPrompt,
  errorMessage,
  onRemoveDraft,
  onClose,
  onCopyPrompt,
  onSubmit
}: {
  open: boolean;
  event: ReviewEvent;
  onEventChange: (event: ReviewEvent) => void;
  isOwnPullRequest: boolean;
  drafts: PullRequestReviewDraft[];
  isSubmitting: boolean;
  isCopyingPrompt: boolean;
  errorMessage?: string;
  onRemoveDraft: (id: string) => void;
  onClose: () => void;
  onCopyPrompt: (body: string) => void;
  onSubmit: (event: ReviewEvent, body: string) => void;
}): ReactElement {
  const titleId = useId();
  const [body, setBody] = useState('');
  const requiresBody = isReviewSummaryRequired(event, drafts.length);
  const hasPromptContext = drafts.length > 0 || body.trim().length > 0;
  const isBusy = isSubmitting || isCopyingPrompt;
  // The summary survives closing the panel, so it stays guarded until a submit remounts this with an empty body.
  useReportUnsavedText(body.trim().length > 0);

  function handleSubmit(submitEvent: FormEvent<HTMLFormElement>): void {
    submitEvent.preventDefault();
    if (isBusy || (isOwnPullRequest && event !== 'comment') || (requiresBody && !body.trim())) {
      return;
    }
    onSubmit(event, body.trim());
  }

  return (
    <PullRequestPanel
      open={open}
      labelledBy={titleId}
      className="pr-action-dialog"
      onClose={isBusy ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit}>
        <header>
          <ShieldCheck size={16} />
          <h2 id={titleId}>Finish review</h2>
          <button
            className="icon-btn icon-btn-compact"
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close review dialog"
          >
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          {!isOwnPullRequest ? <div>
            <span className="pr-action-field-label">GitHub review decision</span>
            <div
              className="pr-review-decision-options"
              role="group"
              aria-label="GitHub review decision"
            >
              {(
                [
                  ['comment', 'Send comments', MessageSquare],
                  ['approve', 'Approve', CheckCircle2],
                  ['request-changes', 'Request changes', AlertTriangle]
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  disabled={isBusy}
                  data-active={event === value}
                  aria-pressed={event === value}
                  onClick={() => onEventChange(value)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div> : null}
          {drafts.length > 0 ? (
            <section className="pr-review-draft-list" aria-label="Draft review comments">
              <header>
                <span>
                  Draft comments
                  <strong>{drafts.length}</strong>
                </span>
                <small>These are still local to Git Gud.</small>
              </header>
              <div>
                {drafts.map((draft) => (
                  <article key={draft.id}>
                    <span className="pr-review-draft-type">
                      {draft.kind === 'line' ? (
                        <MessageSquare size={12} />
                      ) : draft.kind === 'file' ? (
                        <FileText size={12} />
                      ) : (
                        <CornerDownRight size={12} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {draft.kind === 'line'
                          ? `${draft.path}:${draft.startLine ? `${draft.startLine}–` : ''}${draft.line}`
                          : draft.kind === 'file'
                            ? draft.path
                            : 'Reply in existing thread'}
                      </strong>
                      <small>{draft.body}</small>
                    </span>
                    <button
                      className="review-comment-action review-comment-icon-action review-comment-action--danger"
                      type="button"
                      disabled={isBusy}
                      onClick={() => onRemoveDraft(draft.id)}
                      aria-label="Remove draft comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <label>
            <span>{requiresBody ? 'Review summary' : 'Review summary (optional)'}</span>
            <textarea
              rows={4}
              value={body}
              placeholder={
                event === 'approve'
                  ? 'Looks good to me…'
                  : event === 'request-changes'
                    ? 'Explain what should change before merging…'
                    : 'Leave a general review comment…'
              }
              disabled={isBusy}
              onChange={(changeEvent) => setBody(changeEvent.target.value)}
            />
          </label>
          {errorMessage ? <p className="pr-action-error">{errorMessage}</p> : null}
        </div>
        <footer>
          <span className="pr-review-submit-note">
            Copying keeps drafts local. GitHub publishes them.
          </span>
          <button
            className="btn-subtle btn-regular"
            type="button"
            disabled={isBusy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-subtle btn-regular"
            type="button"
            disabled={isBusy || !hasPromptContext}
            title={
              hasPromptContext
                ? 'Copy a prompt containing these local review comments and summary'
                : 'Add a draft comment or review summary first'
            }
            onClick={() => onCopyPrompt(body.trim())}
          >
            {isCopyingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
            Copy review prompt
          </button>
          <button
            className="btn-primary btn-regular"
            type="submit"
            // aria-disabled keeps focus on the button while a submission runs; handleSubmit refuses the click.
            aria-disabled={isBusy || (requiresBody && !body.trim())}
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {reviewSubmitLabel(event, drafts.length)}
          </button>
        </footer>
      </form>
    </PullRequestPanel>
  );
}

function reviewSubmitLabel(event: ReviewEvent, draftCount: number): string {
  const suffix = draftCount > 0
    ? ` with ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'}`
    : '';
  return event === 'approve'
    ? `Approve${suffix}`
    : event === 'request-changes'
      ? `Request changes${suffix}`
      : draftCount > 0
        ? `Send ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'}`
        : 'Send review comment';
}
