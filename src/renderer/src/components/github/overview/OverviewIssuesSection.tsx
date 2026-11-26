import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Bot, Bug, Check, ChevronRight, ExternalLink } from 'lucide-react';

import { useSlidingIndicator } from '@renderer/components/ui/useSlidingIndicator';
import type { BugFinding } from '@shared/bugFinder';
import type { GitHubPullRequestDetail } from '@shared/types';
import { BugFinderButton } from '../BugFinderButton';
import { PullRequestAvatar } from '../PullRequestDetailTabs';
import type { PullRequestCodeLocation } from '../pullRequestNavigation';
import { useBugFinder } from '../useBugFinder';
import { firstSentence, pullRequestReviewThreads, type PullRequestReviewThread } from './pullRequestReviewThreads';
import { OverviewSection, RelativeTime } from './overviewParts';

const VISIBLE_ROWS = 8;
type IssueTab = 'unresolved' | 'resolved';

/** Review threads from people and bots, split by resolution, plus local bug-scan findings. */
export function OverviewIssuesSection({ detail, onOpenBugScan, onOpenCode, onOpenConversation }: {
  detail: GitHubPullRequestDetail;
  onOpenBugScan: () => void;
  onOpenCode: (location: PullRequestCodeLocation) => void;
  onOpenConversation: (commentId: number) => void;
}): ReactElement {
  const { threads, resolutionKnown } = pullRequestReviewThreads(detail.reviewComments);
  const unresolved = threads.filter((thread) => !thread.isResolved);
  const resolved = threads.filter((thread) => thread.isResolved);
  const [tab, setTab] = useState<IssueTab>('unresolved');
  const tabRefs = useRef<Record<IssueTab, HTMLButtonElement | null>>({ unresolved: null, resolved: null });
  const { state: bugScan } = useBugFinder(detail);
  // Findings of the scanned head that are still open and were not posted to GitHub.
  const findings = bugScan?.findings.filter((finding) => finding.status === 'open' && !finding.publication && finding.headSha === bugScan.headSha) ?? [];

  const tabListRef = useRef<HTMLDivElement>(null);
  useSlidingIndicator(tabListRef, tab, 0, resolutionKnown);

  const openThread = (thread: PullRequestReviewThread) => {
    if (thread.isOutdated) onOpenConversation(thread.id);
    else onOpenCode({ path: thread.path, line: thread.line, side: thread.side, commentId: thread.id });
  };

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: IssueTab = event.key === 'Home' ? 'unresolved' : event.key === 'End' ? 'resolved' : tab === 'unresolved' ? 'resolved' : 'unresolved';
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const tabButton = (id: IssueTab, label: string, count: number) => (
    <button
      ref={(node) => { tabRefs.current[id] = node; }}
      type="button"
      role="tab"
      id={`pr-overview-issues-tab-${id}`}
      aria-selected={tab === id}
      aria-controls="pr-overview-issues-panel"
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={onTabKeyDown}
    >
      {label}
      <span className="pr-detail-tab-count">{count}</span>
    </button>
  );

  return (
    <OverviewSection
      id="pr-overview-issues"
      title="Issues"
      actions={<BugFinderButton pullRequest={detail} inReview onOpen={onOpenBugScan} />}
    >
      <div className="pr-overview-card pr-overview-issues">
        {resolutionKnown ? (
          <>
            <div ref={tabListRef} className="pr-overview-tabs" role="tablist" aria-label="Review threads">
              {tabButton('unresolved', 'Unresolved', unresolved.length)}
              {tabButton('resolved', 'Resolved', resolved.length)}
              <span className="sliding-indicator" aria-hidden="true" />
            </div>
            <div id="pr-overview-issues-panel" role="tabpanel" aria-labelledby={`pr-overview-issues-tab-${tab}`}>
              {tab === 'unresolved' && unresolved.length === 0 ? (
                <p className="pr-overview-all-clear">
                  <Check size={14} aria-hidden="true" />
                  <span>No unresolved issues</span>
                </p>
              ) : tab === 'resolved' && resolved.length === 0 ? (
                <p className="pr-overview-empty">No resolved threads yet.</p>
              ) : (
                <ThreadList key={tab} threads={tab === 'unresolved' ? unresolved : resolved} onOpen={openThread} />
              )}
            </div>
          </>
        ) : (
          <>
            <p className="pr-overview-note pr-overview-issues-note">GitHub did not say which threads are resolved, so all {threads.length} are listed.</p>
            {threads.length > 0 ? <ThreadList threads={threads} onOpen={openThread} /> : <p className="pr-overview-empty">No review threads.</p>}
          </>
        )}
        {findings.length > 0 ? <BugFindings findings={findings} stale={bugScan?.headSha !== detail.headSha} onOpen={onOpenBugScan} /> : null}
      </div>
    </OverviewSection>
  );
}

function ThreadList({ threads, onOpen }: { threads: PullRequestReviewThread[]; onOpen: (thread: PullRequestReviewThread) => void }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? threads : threads.slice(0, VISIBLE_ROWS);
  return (
    <>
      <ul className="pr-overview-rows">
        {visible.map((thread) => (
          <li key={thread.id} className="pr-overview-thread">
            <button
              type="button"
              className="pr-overview-row-button"
              title={thread.isOutdated ? 'Outdated: open in Conversation' : 'Open in Code'}
              onClick={() => onOpen(thread)}
            >
              <span className="pr-overview-thread-avatar">
                {thread.isBot ? <Bot size={14} aria-label="Bot" /> : <PullRequestAvatar author={thread.author} authorAvatarUrl={thread.authorAvatarUrl} size="compact" />}
              </span>
              <span className="pr-overview-thread-text">
                <span className="pr-overview-thread-sentence">{thread.sentence || 'Comment without text'}</span>
                <span className="pr-overview-thread-meta">
                  <code title={thread.path}>{thread.path.split('/').pop()}{thread.line ? `:${thread.line}` : ''}</code>
                  {thread.isOutdated ? <span className="pr-overview-tag">Outdated</span> : null}
                  <span>{thread.author.replace(/\[bot\]$/u, '')}</span>
                  <RelativeTime value={thread.createdAt} />
                  {thread.replies > 0 ? <span>{thread.replies} {thread.replies === 1 ? 'reply' : 'replies'}</span> : null}
                </span>
              </span>
              <ChevronRight size={14} aria-hidden="true" className="pr-overview-chevron" />
            </button>
            <a className="pr-overview-row-link" href={thread.url} target="_blank" rel="noreferrer" aria-label={`Open thread by ${thread.author} on GitHub`} title="Open on GitHub to reply or resolve">
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {threads.length > VISIBLE_ROWS && !showAll ? (
        <button type="button" className="pr-overview-more" onClick={() => setShowAll(true)}>Show {threads.length - VISIBLE_ROWS} more</button>
      ) : null}
    </>
  );
}

function BugFindings({ findings, stale, onOpen }: { findings: BugFinding[]; stale: boolean; onOpen: () => void }): ReactElement {
  return (
    <div className="pr-overview-findings" role="group" aria-labelledby="pr-overview-findings-heading">
      <h3 id="pr-overview-findings-heading">Local scan · not posted{stale ? ' · before the latest push' : ''} <span className="pr-overview-count">{findings.length}</span></h3>
      <ul className="pr-overview-rows">
        {findings.map((finding) => (
          <li key={finding.id}>
            <button type="button" className="pr-overview-row-button" onClick={onOpen} title="Open the bug scan">
              <span className="pr-overview-thread-avatar"><Bug size={14} aria-hidden="true" /></span>
              <span className="pr-overview-thread-text">
                <span className="pr-overview-thread-sentence">{firstSentence(finding.title) || finding.title}</span>
                <span className="pr-overview-thread-meta">
                  <code title={finding.location.path}>{finding.location.path.split('/').pop()}:{finding.location.line}</code>
                  {finding.severity ? <span>{finding.severity}</span> : null}
                </span>
              </span>
              <ChevronRight size={14} aria-hidden="true" className="pr-overview-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
