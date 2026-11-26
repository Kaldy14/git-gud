import type { ReactElement } from 'react';
import {
  Check,
  CircleDot,
  CircleDotDashed,
  CircleX,
  Clock,
  Eye,
  GitMerge,
  GitMergeConflict,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquareDiff,
  ShieldAlert,
  TriangleAlert,
  UserRoundCheck,
  type LucideIcon
} from 'lucide-react';

import type { PullRequestStatusIconName } from './pullRequestInboxStatus';

const ICONS: Record<PullRequestStatusIconName, LucideIcon> = {
  check: Check,
  // Approved but not yet mergeable (behind, checks running): a person's approval, not the all-clear.
  approved: UserRoundCheck,
  merge: GitMerge,
  closed: GitPullRequestClosed,
  draft: GitPullRequestDraft,
  conflict: GitMergeConflict,
  failing: CircleX,
  changes: MessageSquareDiff,
  review: Eye,
  waiting: Clock,
  blocked: ShieldAlert,
  running: CircleDotDashed,
  warning: TriangleAlert,
  dot: CircleDot
};

/** The one status glyph set for the inbox, the rail, the header and Overview. Colour comes from the tone around it. */
export function PullRequestStatusIcon({ icon, size = 14, tone }: { icon: PullRequestStatusIconName; size?: number; tone?: string }): ReactElement {
  const Icon = ICONS[icon];
  return <Icon size={size} data-tone={tone} aria-hidden="true" />;
}
