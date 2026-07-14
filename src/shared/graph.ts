import type {
  CommitGraphRow,
  GraphFile,
  GraphFileStatus,
  GraphNodeKind,
  GraphRefChip,
  GraphRailSegment,
  GraphRailStyle
} from './types';

export const DEFAULT_COMMIT_GRAPH_LIMIT = 1500;
export const COMMIT_GRAPH_LIMIT_STEP = 1500;

const LANE_COLORS = ['#19c9e6', '#2684ff', '#d726e7', '#ff5a36', '#ffd34d', '#2ed3a6'] as const;
const AUTHOR_COLORS = ['#38bdf8', '#c084fc', '#4ade80', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf'] as const;
const dateLabelFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});
const dateMarkerFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export const FILE_STATUS_COLORS: Record<GraphFileStatus, string> = {
  added: '#4cc38a',
  modified: '#f0b35f',
  deleted: '#ef6a6a'
};

export type GraphCommitInput = {
  sha: string;
  parentShas: string[];
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  authorAvatarUrl?: string;
  authoredAt?: string;
  committedAt?: string;
  dateLabel?: string;
  kind?: GraphNodeKind;
  refs?: GraphRefChip[];
  colorOverride?: string;
  files?: GraphFile[];
};

export function buildCommitGraphRows(commits: GraphCommitInput[]): CommitGraphRow[] {
  const expectedByLane: Array<string | undefined> = [];
  const styleByLane: Array<GraphRailStyle | undefined> = [];
  const rows: CommitGraphRow[] = [];
  let previousDay: string | undefined;

  for (const commit of commits) {
    const matchingLanes = findMatchingLanes(expectedByLane, commit.sha);
    const lane = matchingLanes[0] ?? firstFreeLane(expectedByLane);
    const rails = buildIncomingRails(expectedByLane, styleByLane, matchingLanes, lane);

    for (const matchingLane of matchingLanes) {
      styleByLane[matchingLane] = undefined;

      if (matchingLane !== lane) {
        expectedByLane[matchingLane] = undefined;
      }
    }

    const [firstParent, ...additionalParents] = uniqueParents(commit.parentShas);
    const isSyntheticTip = commit.kind === 'wip' || commit.kind === 'stash';

    if (firstParent) {
      expectedByLane[lane] = firstParent;
      styleByLane[lane] = isSyntheticTip
        ? { color: commit.colorOverride ?? laneColor(lane), dashed: true }
        : undefined;
      rails.push({ type: 'startBottom', lane, ...styleByLane[lane] });
    } else {
      expectedByLane[lane] = undefined;
      styleByLane[lane] = undefined;
    }

    for (const parentSha of additionalParents) {
      const parentLane = laneForParent(expectedByLane, parentSha, lane);
      expectedByLane[parentLane] = parentSha;
      styleByLane[parentLane] = undefined;
      rails.push({ type: 'curveOut', from: lane, to: parentLane });
    }

    trimTrailingFreeLanes(expectedByLane, styleByLane);

    const displayDate = commit.committedAt ?? commit.authoredAt;
    const day = dayKey(displayDate);
    const dateMarker = day && day !== previousDay ? formatDateMarker(displayDate) : undefined;

    if (day) {
      previousDay = day;
    }

    rows.push({
      sha: commit.sha,
      parentShas: commit.parentShas,
      subject: commit.subject,
      body: commit.body,
      author: {
        name: commit.authorName,
        email: commit.authorEmail,
        initials: initials(commit.authorName || commit.authorEmail || commit.sha),
        color: authorColor(commit.authorEmail ?? commit.authorName),
        avatarUrl: commit.authorAvatarUrl
      },
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt,
      dateLabel: commit.dateLabel ?? formatDateLabel(displayDate),
      node: {
        lane,
        kind: commit.kind ?? (commit.parentShas.length > 1 ? 'merge' : 'commit')
      },
      colorOverride: commit.colorOverride,
      rails,
      refs: commit.refs,
      dateMarker,
      files: commit.files ?? []
    });
  }

  return rows;
}

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function buildIncomingRails(
  expectedByLane: Array<string | undefined>,
  styleByLane: Array<GraphRailStyle | undefined>,
  matchingLanes: number[],
  nodeLane: number
): GraphRailSegment[] {
  const matchingSet = new Set(matchingLanes);
  const rails: GraphRailSegment[] = [];

  for (let lane = 0; lane < expectedByLane.length; lane += 1) {
    const expectedSha = expectedByLane[lane];

    if (!expectedSha) {
      continue;
    }

    const style = styleByLane[lane];

    if (matchingSet.has(lane)) {
      rails.push(
        lane === nodeLane
          ? { type: 'stopTop', lane, ...style }
          : { type: 'curveIn', from: lane, to: nodeLane, ...style }
      );
      continue;
    }

    rails.push({ type: 'through', lane, ...style });
  }

  return rails;
}

function findMatchingLanes(expectedByLane: Array<string | undefined>, sha: string): number[] {
  const lanes: number[] = [];

  for (let lane = 0; lane < expectedByLane.length; lane += 1) {
    if (expectedByLane[lane] === sha) {
      lanes.push(lane);
    }
  }

  return lanes;
}

function firstFreeLane(expectedByLane: Array<string | undefined>): number {
  const lane = expectedByLane.findIndex((expectedSha) => expectedSha === undefined);

  if (lane !== -1) {
    return lane;
  }

  expectedByLane.push(undefined);
  return expectedByLane.length - 1;
}

function laneForParent(expectedByLane: Array<string | undefined>, parentSha: string, avoidLane: number): number {
  const existingLane = expectedByLane.findIndex((expectedSha, lane) => lane !== avoidLane && expectedSha === parentSha);

  if (existingLane !== -1) {
    return existingLane;
  }

  const freeLane = expectedByLane.findIndex((expectedSha, lane) => lane !== avoidLane && expectedSha === undefined);

  if (freeLane !== -1) {
    return freeLane;
  }

  expectedByLane.push(undefined);
  return expectedByLane.length - 1;
}

function uniqueParents(parentShas: string[]): string[] {
  return [...new Set(parentShas.filter(Boolean))];
}

function trimTrailingFreeLanes(
  expectedByLane: Array<string | undefined>,
  styleByLane: Array<GraphRailStyle | undefined>
): void {
  while (expectedByLane.length > 0 && expectedByLane[expectedByLane.length - 1] === undefined) {
    expectedByLane.pop();
  }

  styleByLane.length = expectedByLane.length;
}

function initials(value: string): string {
  return (
    value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'G'
  );
}

function authorColor(identity: string): string {
  return AUTHOR_COLORS[Math.abs(hashString(identity)) % AUTHOR_COLORS.length];
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return hash;
}

function dayKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return dateLabelFormatter.format(date);
}

function formatDateMarker(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return dateMarkerFormatter.format(date);
}
