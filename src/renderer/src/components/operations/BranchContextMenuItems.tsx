import type { ReactElement } from 'react';
import {
  BookOpenCheck,
  Check,
  Cloud,
  Copy,
  Download,
  GitMerge,
  GitPullRequest,
  Link,
  Pencil,
  RefreshCw,
  Tag,
  Trash2,
  Workflow
} from 'lucide-react';

import { CreateSuggestedTagMenuItem } from '@renderer/components/operations/CreateSuggestedTagMenuItem';
import { ContextMenuSeparator } from '@renderer/components/ui/context-menu';
import type { GitHubPullRequestSummary } from '@shared/types';

type MaybeAsync = Promise<unknown> | void;

type BranchContextMenuItemsProps = {
  branchName: string;
  targetSha: string;
  currentBranchName?: string;
  isCurrentBranch: boolean;
  hasUpstream: boolean;
  canSetBranchUpstream: boolean;
  suggestedTagName?: string;
  pullRequest?: GitHubPullRequestSummary;
  isOperationBusy: boolean;
  onCheckoutBranch?: (name: string) => MaybeAsync;
  onPushBranch?: (name: string) => MaybeAsync;
  onPushBranchWithTag?: (branchName: string, tagName: string) => MaybeAsync;
  onPullBranch?: (name: string) => MaybeAsync;
  onSetBranchUpstream?: (name: string) => MaybeAsync;
  onReviewBranch?: (name: string, sha: string) => MaybeAsync;
  onViewPullRequest?: (pullRequest: GitHubPullRequestSummary) => MaybeAsync;
  onCreateTagAtCommit?: (sha: string) => MaybeAsync;
  onCreateSuggestedTagAtCommit?: (sha: string, name: string) => Promise<unknown>;
  onMergeBranch?: (name: string) => MaybeAsync;
  onRebaseOntoBranch?: (name: string) => MaybeAsync;
  onInteractiveRebaseOntoBranch?: (name: string) => MaybeAsync;
  onRenameBranch?: (name: string) => MaybeAsync;
  onCopyBranchName?: (name: string) => MaybeAsync;
  onDeleteBranch?: (name: string) => MaybeAsync;
  onClose: () => void;
};

/**
 * Local branch actions shared by the graph and sidebar so every action keeps the
 * same position regardless of where the menu was opened. Groups, in order:
 * sync, review, create, integrate, manage. Inapplicable actions are disabled
 * rather than hidden so the remaining rows do not shift.
 */
export function BranchContextMenuItems({
  branchName,
  targetSha,
  currentBranchName,
  isCurrentBranch,
  hasUpstream,
  canSetBranchUpstream,
  suggestedTagName,
  pullRequest,
  isOperationBusy,
  onCheckoutBranch,
  onPushBranch,
  onPushBranchWithTag,
  onPullBranch,
  onSetBranchUpstream,
  onReviewBranch,
  onViewPullRequest,
  onCreateTagAtCommit,
  onCreateSuggestedTagAtCommit,
  onMergeBranch,
  onRebaseOntoBranch,
  onInteractiveRebaseOntoBranch,
  onRenameBranch,
  onCopyBranchName,
  onDeleteBranch,
  onClose
}: BranchContextMenuItemsProps): ReactElement {
  const canIntegrate = Boolean(currentBranchName) && !isCurrentBranch;
  const targetBranchName = currentBranchName ?? 'current';

  function run(action: (() => MaybeAsync) | undefined): void {
    void action?.();
    onClose();
  }

  return (
    <>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onCheckoutBranch || isCurrentBranch || isOperationBusy}
        onClick={() => run(() => onCheckoutBranch?.(branchName))}
      >
        <Check size={14} />
        <span>Checkout {branchName}</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onPushBranch || isOperationBusy}
        onClick={() => run(() => onPushBranch?.(branchName))}
      >
        <Cloud size={14} />
        <span>Push branch to remote</span>
      </button>
      {suggestedTagName && onPushBranchWithTag ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={isOperationBusy}
          onClick={() => run(() => onPushBranchWithTag(branchName, suggestedTagName))}
        >
          <Cloud size={14} />
          <span>Push remote &amp; Create tag {suggestedTagName} &amp; push tag</span>
        </button>
      ) : null}
      {isCurrentBranch && hasUpstream ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={!onPullBranch || isOperationBusy}
          onClick={() => run(() => onPullBranch?.(branchName))}
        >
          <Download size={14} />
          <span>Pull</span>
        </button>
      ) : null}
      {!hasUpstream && canSetBranchUpstream ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={!onSetBranchUpstream || isOperationBusy}
          onClick={() => run(() => onSetBranchUpstream?.(branchName))}
        >
          <Link size={14} />
          <span>Set upstream…</span>
        </button>
      ) : null}
      <ContextMenuSeparator />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onReviewBranch || isOperationBusy}
        onClick={() => run(() => onReviewBranch?.(branchName, targetSha))}
      >
        <BookOpenCheck size={14} />
        <span>Review entire branch</span>
      </button>
      {pullRequest ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={!onViewPullRequest}
          onClick={() => run(() => onViewPullRequest?.(pullRequest))}
        >
          <GitPullRequest size={14} />
          <span>View pull request #{pullRequest.number}</span>
        </button>
      ) : null}
      <ContextMenuSeparator />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onCreateTagAtCommit || isOperationBusy}
        onClick={() => run(() => onCreateTagAtCommit?.(targetSha))}
      >
        <Tag size={14} />
        <span>Create tag here and push</span>
      </button>
      <CreateSuggestedTagMenuItem
        suggestedTagName={suggestedTagName}
        isOperationBusy={isOperationBusy}
        onCreate={
          onCreateSuggestedTagAtCommit ? (name) => onCreateSuggestedTagAtCommit(targetSha, name) : undefined
        }
        onClose={onClose}
      />
      <ContextMenuSeparator />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onMergeBranch || !canIntegrate || isOperationBusy}
        onClick={() => run(() => onMergeBranch?.(branchName))}
      >
        <GitMerge size={14} />
        <span>
          Merge {branchName} into {targetBranchName}
        </span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onRebaseOntoBranch || !canIntegrate || isOperationBusy}
        onClick={() => run(() => onRebaseOntoBranch?.(branchName))}
      >
        <RefreshCw size={14} />
        <span>
          Rebase {targetBranchName} onto {branchName}
        </span>
      </button>
      {onInteractiveRebaseOntoBranch ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={!canIntegrate || isOperationBusy}
          onClick={() => run(() => onInteractiveRebaseOntoBranch(branchName))}
        >
          <Workflow size={14} />
          <span>
            Interactive rebase {targetBranchName} onto {branchName}
          </span>
        </button>
      ) : null}
      <ContextMenuSeparator />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onRenameBranch || isOperationBusy}
        onClick={() => run(() => onRenameBranch?.(branchName))}
      >
        <Pencil size={14} />
        <span>Rename branch…</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onCopyBranchName}
        onClick={() => run(() => onCopyBranchName?.(branchName))}
      >
        <Copy size={14} />
        <span>Copy branch name</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onDeleteBranch || isCurrentBranch || isOperationBusy}
        onClick={() => run(() => onDeleteBranch?.(branchName))}
      >
        <Trash2 size={14} />
        <span>Delete branch…</span>
      </button>
    </>
  );
}
