import type { GitHubWorkflowJob } from '@shared/types';

export type WorkflowJobNameSegment = {
  text: string;
  match: boolean;
};

export function normalizeWorkflowJobQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Job IDs whose names contain the query, in the order the jobs are listed. */
export function findWorkflowJobMatches(
  jobs: readonly Pick<GitHubWorkflowJob, 'id' | 'name'>[],
  query: string
): number[] {
  const needle = normalizeWorkflowJobQuery(query);
  if (!needle) {
    return [];
  }
  return jobs
    .filter((job) => job.name.toLocaleLowerCase().includes(needle))
    .map((job) => job.id);
}

/** Wraps around in either direction; an unknown current index starts at the first or last match. */
export function stepWorkflowJobMatch(
  currentIndex: number,
  matchCount: number,
  direction: 1 | -1
): number {
  if (matchCount === 0) {
    return -1;
  }
  if (currentIndex < 0) {
    return direction === 1 ? 0 : matchCount - 1;
  }
  return (currentIndex + direction + matchCount) % matchCount;
}

export function workflowJobNameSegments(
  name: string,
  query: string
): WorkflowJobNameSegment[] {
  const needle = normalizeWorkflowJobQuery(query);
  if (!needle) {
    return [{ text: name, match: false }];
  }
  const haystack = name.toLocaleLowerCase();
  // Lower-casing can change string length for a few locales; fall back to unhighlighted text.
  if (haystack.length !== name.length) {
    return [{ text: name, match: false }];
  }

  const segments: WorkflowJobNameSegment[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) {
      segments.push({ text: name.slice(cursor, index), match: false });
    }
    segments.push({ text: name.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < name.length) {
    segments.push({ text: name.slice(cursor), match: false });
  }
  return segments;
}
