import type { ReactElement } from 'react';
import { useId, useState } from 'react';
import { GitMerge, Loader2, X } from 'lucide-react';

import type { GitHubPullRequestDetail, GitHubPullRequestMergeMethod } from '@shared/types';
import { PullRequestPanel } from './PullRequestPanel';

export function PullRequestMergeDialog({
  open,
  errorMessage,
  pullRequest,
  isMerging,
  onClose,
  onMerge
}: {
  open: boolean;
  errorMessage?: string;
  pullRequest: GitHubPullRequestDetail;
  isMerging: boolean;
  onClose: () => void;
  onMerge: (method: GitHubPullRequestMergeMethod) => void;
}): ReactElement {
  const titleId = useId();
  const [method, setMethod] = useState<GitHubPullRequestMergeMethod>(
    pullRequest.mergeSettings.defaultMethod
  );
  const hasMultipleMethods = pullRequest.mergeSettings.allowedMethods.length > 1;

  return (
    <PullRequestPanel
      open={open}
      labelledBy={titleId}
      className="pr-action-dialog"
      onClose={isMerging ? () => undefined : onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!isMerging) onMerge(method);
        }}
      >
        <header>
          <GitMerge size={16} />
          <h2 id={titleId}>Merge pull request #{pullRequest.number}</h2>
          <button
            className="icon-btn icon-btn-compact"
            type="button"
            disabled={isMerging}
            onClick={onClose}
            aria-label="Close merge dialog"
          >
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          {errorMessage ? (
            <p className="pr-action-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <p className="pr-context-branches">
            {pullRequest.headRefName} → {pullRequest.baseRefName}
          </p>
          <p className="pr-merge-warning">
            This writes to {pullRequest.owner}/{pullRequest.repository} and cannot be undone from
            Git Gud.
          </p>
          {hasMultipleMethods ? (
            <label>
              <span>Merge method</span>
              <select
                value={method}
                disabled={isMerging}
                onChange={(event) => setMethod(normalizeMergeMethod(event.target.value))}
              >
                {pullRequest.mergeSettings.allowedMethods.map((allowedMethod) => (
                  <option value={allowedMethod} key={allowedMethod}>
                    {mergeMethodLabel(allowedMethod)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="pr-merge-method-locked">
              <GitMerge size={14} />
              <span>
                <strong>{mergeMethodLabel(method)}</strong>
                <small>Only merge method enabled for this GitHub repository</small>
              </span>
            </div>
          )}
        </div>
        <footer>
          <button
            className="btn-subtle btn-regular"
            type="button"
            disabled={isMerging}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary btn-regular" type="submit" disabled={isMerging}>
            {isMerging ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
            {mergeMethodLabel(method)}
          </button>
        </footer>
      </form>
    </PullRequestPanel>
  );
}

function normalizeMergeMethod(value: string): GitHubPullRequestMergeMethod {
  return value === 'merge' || value === 'rebase' ? value : 'squash';
}

export function mergeMethodLabel(method: GitHubPullRequestMergeMethod): string {
  return method === 'squash'
    ? 'Squash and merge'
    : method === 'rebase'
      ? 'Rebase and merge'
      : 'Merge pull request';
}
