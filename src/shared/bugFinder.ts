import type { GitHubPullRequestLocator } from './types';

export type BugFindingContent = {
  title: string;
  body: string;
  category: 'bug' | 'convention';
  severity: 'critical' | 'major' | 'minor' | null;
  evidence: { kind: 'code' | 'reproduced' | 'incomplete'; detail: string };
  location: {
    path: string;
    line: number;
    endLine: number;
    side: 'left' | 'right';
  };
};
export type BugFinding = BugFindingContent & {
  id: string;
  version: number;
  headSha: string;
  status: 'open' | 'dismissed' | 'removed';
  history: Array<{
    at: string;
    actor: string;
    action: string;
    reason?: string;
  }>;
  publication?: {
    status: 'posting' | 'posted' | 'uncertain';
    marker: string;
    commentIds: number[];
    reviewId?: number;
  };
};
export type BugFinderState = {
  status: 'idle' | 'running' | 'ready' | 'failed';
  headSha?: string;
  title?: string;
  url?: string;
  baseRef?: string;
  headRef?: string;
  findings: BugFinding[];
  coverage?: string;
  error?: string;
  scannedAt?: string;
};
export type BugFinderRequest = {
  locator: GitHubPullRequestLocator;
  action:
    | 'get'
    | 'start'
    | 'add'
    | 'update'
    | 'dismiss'
    | 'restore'
    | 'remove'
    | 'prompt'
    | 'post'
    | 'reconcile';
  headSha?: string;
  id?: string;
  version?: number;
  reason?: string;
  content?: BugFindingContent;
  selected?: Array<{ id: string; version: number; body?: string }>;
};
export type BugFinderResult = { state: BugFinderState; prompt?: string };

export function bugRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
export function bugText(value: unknown, name: string, max = 8000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Invalid ${name}.`);
  return value.trim();
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Expected a positive integer.');
  return value;
}
export function parseBugContent(value: unknown): BugFindingContent {
  const r = bugRecord(value),
    e = bugRecord(r.evidence),
    l = bugRecord(r.location);
  const category = r.category;
  if (category !== 'bug' && category !== 'convention')
    throw new Error('Invalid finding category.');
  const severity = category === 'convention' ? null : r.severity;
  if (
    severity !== null &&
    severity !== 'critical' &&
    severity !== 'major' &&
    severity !== 'minor'
  )
    throw new Error('Invalid severity.');
  if (category === 'bug' && severity === null)
    throw new Error('A bug needs severity.');
  if (e.kind !== 'code' && e.kind !== 'reproduced' && e.kind !== 'incomplete')
    throw new Error('Invalid evidence kind.');
  if (typeof l.path !== 'string' || !l.path.length || l.path.length > 1024)
    throw new Error('Invalid path.');
  const path = l.path;
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((p) => p === '..' || p === '.') ||
    path.includes(':') ||
    [...path].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Use a repository-relative path.');
  const line = positive(l.line),
    endLine = positive(l.endLine ?? l.line);
  if (
    endLine < line ||
    endLine - line > 500 ||
    (l.side !== 'left' && l.side !== 'right')
  )
    throw new Error('Invalid finding range.');
  return {
    title: bugText(r.title, 'title', 200),
    body: bugText(r.body, 'body'),
    category,
    severity,
    evidence: { kind: e.kind, detail: bugText(e.detail, 'evidence') },
    location: { path, line, endLine, side: l.side }
  };
}
export function parseBugRequest(value: unknown): BugFinderRequest {
  const r = bugRecord(value),
    l = bugRecord(r.locator);
  const locator = {
    profileId: bugText(l.profileId, 'profile', 200),
    owner: bugText(l.owner, 'owner', 200),
    repository: bugText(l.repository, 'repository', 200),
    number: positive(l.number)
  };
  if (
    !/^[\w.-]+$/u.test(locator.owner) ||
    !/^[\w.-]+$/u.test(locator.repository)
  )
    throw new Error('Invalid repository.');
  const action = r.action;
  if (
    action !== 'get' &&
    action !== 'start' &&
    action !== 'add' &&
    action !== 'update' &&
    action !== 'dismiss' &&
    action !== 'restore' &&
    action !== 'remove' &&
    action !== 'prompt' &&
    action !== 'post' &&
    action !== 'reconcile'
  )
    throw new Error('Unknown findings action.');
  const headSha =
    r.headSha === undefined
      ? undefined
      : bugText(r.headSha, 'head revision', 64);
  if (headSha !== undefined && !/^[a-f0-9]{40,64}$/iu.test(headSha))
    throw new Error('Use the full head SHA.');
  if (action !== 'get' && action !== 'start' && !headSha)
    throw new Error('Expected head revision.');
  const result: BugFinderRequest = { locator, action, headSha };
  if (['update', 'dismiss', 'restore', 'remove'].includes(action)) {
    result.id = bugText(r.id, 'finding ID', 100);
    result.version = positive(r.version);
  }
  if (action === 'dismiss')
    result.reason = bugText(r.reason, 'dismissal reason', 2000);
  if (action === 'add' || action === 'update')
    result.content = parseBugContent(r.content);
  if (action === 'prompt' || action === 'post') {
    if (
      !Array.isArray(r.selected) ||
      !r.selected.length ||
      r.selected.length > 100
    )
      throw new Error('Select between 1 and 100 findings.');
    result.selected = r.selected.map((v) => {
      const s = bugRecord(v);
      return {
        id: bugText(s.id, 'finding ID', 100),
        version: positive(s.version),
        ...(s.body === undefined
          ? {}
          : { body: bugText(s.body, 'comment', 16000) })
      };
    });
    if (
      new Set(result.selected.map((s) => s.id)).size !== result.selected.length
    )
      throw new Error('Duplicate finding selection.');
  }
  return result;
}
