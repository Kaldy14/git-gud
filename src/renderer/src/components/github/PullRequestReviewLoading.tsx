import type { CSSProperties, ReactElement } from 'react';
import { ArrowLeft, Loader2, X } from 'lucide-react';

import { reviewPanelSize } from '@renderer/components/review/reviewFileScope';
import { loadReviewFileTreeOpen } from '@renderer/components/review/reviewFileTree';
import type { GitHubPullRequestSummary } from '@shared/types';
import { PullRequestDetailHeader, PullRequestDetailTabs, PullRequestMeta } from './PullRequestDetailTabs';
import type { PullRequestDetailTab } from './pullRequestDetailTab';
import { PullRequestReviewStatus } from './PullRequestReviewStatus';
import { TOUR_PANEL_COLLAPSED_KEY } from './tour/useTourDiffSurface';

export function PullRequestReviewLoading({
  pullRequest,
  tab,
  isOwn,
  onAction,
  onClose
}: {
  pullRequest: GitHubPullRequestSummary;
  tab: PullRequestDetailTab;
  /** The viewer opened it: Review has no decision menu, so its stand-in is narrower. */
  isOwn: boolean;
  onAction: () => void;
  onClose: () => void;
}): ReactElement {
  // Code, Blocks and Tour open with the header folded, the status beside the tabs, as the loaded view does.
  const condensed = tab === 'code' || tab === 'tour' || tab === 'blocks';
  const repoPath = `github://${new URL(pullRequest.url).host}/${pullRequest.owner}/${pullRequest.repository}`;
  const isOpen = pullRequest.state !== 'merged' && pullRequest.state !== 'closed';
  return (
    <section
      className="pr-review-view pr-review-loading"
      data-tab={tab}
      aria-label={`Loading review for ${pullRequest.title}`}
      aria-busy="true"
    >
      <PullRequestDetailHeader
        pullRequest={pullRequest}
        condensed={condensed}
        onBack={onAction}
        actions={
          <>
            <PullRequestLoadPhase>Loading pull request</PullRequestLoadPhase>
            {/* Stand-ins for Refresh, Review, Merge (open pull requests only) and More, in the loaded order
                and at their sizes, so nothing in the row moves when the real buttons arrive. */}
            <span className="pr-review-loading-action" data-shape="refresh" aria-hidden="true" />
            <span className="pr-review-loading-action" data-shape={isOwn ? 'review-own' : 'review'} aria-hidden="true" />
            {isOpen ? <span className="pr-review-loading-action" data-shape="merge" aria-hidden="true" /> : null}
            <span className="pr-review-loading-action" aria-hidden="true" />
            <button
              className="icon-btn icon-btn-regular shrink-0"
              type="button"
              onClick={onClose}
              aria-label="Close pull request review and return to commit graph"
              title="Return to commit graph"
            >
              <X size={16} />
            </button>
          </>
        }
      />

      {/* Match the loaded layout: the same tab strip, and a static skeleton shaped like the remembered tab. */}
      <PullRequestDetailTabs
        value={tab}
        onChange={() => false}
        counts={{ code: pullRequest.changedFiles }}
        pendingCounts={['conversation', 'blocks']}
        disabled
        trailing={<span className="pr-detail-status pr-tabs-status"><PullRequestReviewStatus detail={pullRequest} reserveConflictToggle /></span>}
      />
      <div className="pr-review-workspace" aria-hidden="true">
        {tab === 'blocks'
          ? <BlocksSkeleton repoPath={repoPath} />
          : tab === 'code' || tab === 'tour'
          ? <DiffSkeleton tab={tab} repoPath={repoPath} />
          : <ReadingSkeleton tab={tab === 'conversation' ? 'conversation' : 'overview'} pullRequest={pullRequest} />}
      </div>
    </section>
  );
}

/** What the header says while something is still on its way; the only spinner in the pull request chrome. */
export function PullRequestLoadPhase({ children }: { children: string }): ReactElement {
  return (
    <span className="pr-review-loading-progress" role="status" aria-live="polite">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      {children}
    </span>
  );
}

const bars = (count: number) => Array.from({ length: count }, (_, index) => <b className="pr-review-skeleton" key={index} />);

/** Overview: section headings over cards. Conversation: the description card, then timeline cards. */
function ReadingSkeleton({ tab, pullRequest }: { tab: 'overview' | 'conversation'; pullRequest: GitHubPullRequestSummary }): ReactElement {
  const sections = tab === 'overview' ? [3, 4, 2] : [5, 2, 3];
  return (
    <div className="pr-detail-pane">
      <div className="pr-summary-column pr-review-loading-reading" data-tab={tab}>
        <PullRequestMeta pullRequest={pullRequest} commitsPending />
        {sections.map((lines, index) => (
          <div className="pr-review-loading-section" key={index}>
            {tab === 'overview' ? <span className="pr-review-skeleton pr-review-loading-heading" /> : null}
            <div className="pr-review-loading-card">
              {tab === 'conversation' ? <span className="pr-review-loading-byline"><i />{bars(1)}</span> : null}
              {bars(lines)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Blocks: the toolbar, the block queue, one block's header and code, and the file tree when it was left open. */
function BlocksSkeleton({ repoPath }: { repoPath: string }): ReactElement {
  return (
    <div className="pr-focused-review pr-diff-pane" data-diff-tab="blocks">
      <div className="review-view">
        <div className="review-toolbar">
          <div className="review-toolbar-primary">{bars(3)}</div>
        </div>
        <div className="review-layout">
          <nav className="review-queue">
            {[0, 1, 2, 3, 4, 5].map((index) => <div className="pr-review-loading-card" key={index}>{bars(2)}</div>)}
          </nav>
          <div className="review-content">
            <div className="review-stack-file-header pr-review-loading-file-header">
              <span className="pr-review-skeleton" />
              <span className="pr-review-skeleton" />
            </div>
            <div className="pr-review-loading-code">
              {Array.from({ length: 14 }, (_, line) => <span key={line}><i />{bars(1)}</span>)}
            </div>
          </div>
          {fileTreeOpen(repoPath) ? <aside className="review-file-tree-panel" /> : null}
        </div>
      </div>
    </div>
  );
}

/** Code and Tour: the progress strip, the left panel at its remembered width, and stacked file headers. */
function DiffSkeleton({ tab, repoPath }: { tab: 'tour' | 'code'; repoPath: string }): ReactElement {
  const size = reviewPanelSize(repoPath, tab === 'tour' ? 'side' : 'files');
  const width = Math.min(size.maxWidth, Math.max(size.minWidth, storedWidth(size.storageKey) ?? size.defaultWidth));
  // A collapsed Tour panel is a 44px strip in the loaded view, so the skeleton is one too.
  const collapsed = tab === 'tour' && stored(TOUR_PANEL_COLLAPSED_KEY) === 'true';
  const panelStyle: CSSProperties | undefined = collapsed ? undefined : { width, flexBasis: width };
  return (
    <div className="pr-focused-review">
      <div className="review-files-layout pr-review-loading-files">
        <div className="review-files-progress">
          <span className="pr-review-skeleton pr-review-loading-progress-text" />
          <span className="review-files-progress-bar" />
        </div>
        <div className="review-files-main">
          <aside className="review-files-panel" data-collapsed={collapsed ? '' : undefined} style={panelStyle}>
            {collapsed ? null : tab === 'code' ? (
              <>
                <div className="review-files-panel-header"><span className="pr-review-skeleton pr-review-loading-panel-title" /></div>
                <span className="review-files-filter" />
                {[0, 1, 1, 2, 2, 1, 0, 1, 1].map((depth, index) => (
                  <span className="pr-review-loading-tree-row" data-depth={depth} key={index}>{bars(1)}</span>
                ))}
              </>
            ) : (
              <div className="pr-review-loading-narrative">
                <span className="pr-review-skeleton pr-review-loading-chip" />
                <span className="pr-review-skeleton pr-review-loading-heading" />
                <p>{bars(3)}</p>
                {[0, 1, 2].map((index) => <div className="pr-review-loading-card" key={index}>{bars(2)}</div>)}
              </div>
            )}
          </aside>
          <div className="review-files-content">
            {[14, 0, 0].map((lines, index) => (
              <div className="review-stack-file" key={index}>
                <div className="review-stack-file-header pr-review-loading-file-header">
                  <span className="pr-review-skeleton" />
                  <span className="pr-review-skeleton" />
                </div>
                {lines ? (
                  <div className="pr-review-loading-code">
                    {Array.from({ length: lines }, (_, line) => <span key={line}><i />{bars(1)}</span>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function fileTreeOpen(repoPath: string): boolean {
  try {
    return loadReviewFileTreeOpen(window.localStorage, repoPath);
  } catch {
    return true;
  }
}

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storedWidth(key: string): number | undefined {
  const width = Number(stored(key));
  return Number.isFinite(width) && width > 0 ? width : undefined;
}

export function ReviewMessage({
  icon,
  text,
  tone,
  actionLabel,
  onAction,
  closeLabel,
  onClose
}: {
  icon: ReactElement;
  text: string;
  tone?: 'danger';
  actionLabel?: string;
  onAction?: () => void;
  closeLabel?: string;
  onClose?: () => void;
}): ReactElement {
  return (
    <div className="review-message" data-tone={tone}>
      <span className="flex items-center gap-2">{icon}{text}</span>
      {(actionLabel && onAction) || (closeLabel && onClose) ? (
        <span className="mt-3 flex items-center gap-2">
          {actionLabel && onAction ? (
            <button
              className="icon-btn icon-btn-regular"
              type="button"
              onClick={onAction}
              aria-label={actionLabel}
              title={actionLabel}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {closeLabel && onClose ? (
            <button
              className="icon-btn icon-btn-regular"
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X size={16} />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
