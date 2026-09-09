import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { BugFinderRequest, BugFinderResult } from '@shared/bugFinder';
import { parseBugRequest } from '@shared/bugFinder';
import {
  loadBugFinderHead,
  loadGitHubPullRequestDetail,
  postBugFinderReview
} from './github';
import {
  BugFinderStore,
  checkedFinding,
  newBugFinding,
  reconcileBugScan
} from './bugFinderStore';
import { scanPullRequestBugs, validateBugLocation } from './bugFinderScan';
import { startBugFinderBridge } from './bugFinderBridge';
import { buildBugFinderHandoff, shellQuote } from './bugFinderHandoff';

let store: BugFinderStore | undefined;
let bridge: ReturnType<typeof startBugFinderBridge> | undefined;
const queues = new Map<string, Promise<unknown>>();
function getStore(): BugFinderStore {
  return (store ??= new BugFinderStore(
    join(app.getPath('userData'), 'bug-finder.json')
  ));
}

// All app and CLI writes run through one queue per PR, including asynchronous revision checks.
export async function handleBugFinder(
  value: BugFinderRequest,
  actor = 'user'
): Promise<BugFinderResult> {
  const request = parseBugRequest(value);
  return enqueue(request, () => execute(request, actor));
}
async function enqueue<T>(
  request: BugFinderRequest,
  operation: () => Promise<T>
): Promise<T> {
  const key = JSON.stringify([
    request.locator.profileId,
    request.locator.owner.toLowerCase(),
    request.locator.repository.toLowerCase(),
    request.locator.number
  ]);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
async function execute(
  r: BugFinderRequest,
  actor: string
): Promise<BugFinderResult> {
  const db = getStore();
  let state = db.get(r.locator);
  if (r.action === 'get') return { state };
  if (r.action === 'start') {
    if (state.status === 'running') return { state };
    const detail = await loadGitHubPullRequestDetail(r.locator);
    if (state.url && new URL(state.url).host !== new URL(detail.url).host) throw new Error('This profile now targets a different GitHub host. Use a separate profile to keep its findings distinct.');
    state = {
      ...state,
      status: 'running',
      error: undefined,
      headSha: detail.headSha,
      title: detail.title,
      url: detail.url,
      baseRef: detail.baseRefName,
      headRef: detail.headRefName
    };
    db.save(r.locator, state);
    void scanPullRequestBugs(r.locator, detail)
      .then((scan) =>
        enqueue(r, async () => {
          // Scan completion reads the latest records so agent edits made during generation survive.
          const current = db.get(r.locator);
          db.save(r.locator, {
            ...current,
            status: 'ready',
            findings: reconcileBugScan(current, scan.findings, detail.headSha),
            coverage: scan.coverage,
            scannedAt: new Date().toISOString(),
            error: undefined
          });
        })
      )
      .catch((error: unknown) =>
        enqueue(r, async () => {
          db.save(r.locator, {
            ...db.get(r.locator),
            status: 'failed',
            error: error instanceof Error ? error.message : 'Bug scan failed.'
          });
        })
      );
    return { state };
  }
  // Reconciliation only confirms an existing publication; it is valid after new commits.
  if (r.action === 'reconcile') {
    const detail = await loadGitHubPullRequestDetail(r.locator);
    if (state.url && new URL(state.url).host !== new URL(detail.url).host) throw new Error('The GitHub host for this profile changed. Use the original profile host to confirm this submission.');
    for (const finding of state.findings) {
      if (!finding.publication || finding.publication.status === 'posted')
        continue;
      const comments = detail.reviewComments.filter(
        (c) =>
          c.author === detail.viewerLogin &&
          c.body.includes(finding.publication!.marker)
      );
      if (comments.length) {
        finding.publication.status = 'posted';
        finding.publication.commentIds = comments.map((c) => c.id);
        finding.version++;
        finding.history.push({
          at: new Date().toISOString(),
          actor,
          action: 'publication confirmed'
        });
      }
    }
    db.save(r.locator, state);
    return { state };
  }
  const live = await loadBugFinderHead(r.locator);
  if (state.url && live.host !== new URL(state.url).host) throw new Error('The GitHub host for this profile changed. Use the original profile host to access these findings.');
  if (live.headSha !== r.headSha || state.headSha !== r.headSha)
    throw new Error(
      'STALE_HEAD: The PR revision changed. Run a new scan and revalidate findings.'
    );
  if (r.action === 'prompt' || r.action === 'post') {
    const selected = r.selected!.map((s) =>
      checkedFinding(state, s.id, s.version)
    );
    if (selected.some((f) => f.status !== 'open' || f.headSha !== live.headSha))
      throw new Error(
        'Select open findings validated at the current revision.'
      );
    if (r.action === 'prompt') {
      bridge ??= startBugFinderBridge(
        join(app.getPath('userData'), 'findings-cli'),
        (request) => handleBugFinder(request, 'agent')
      ).catch((error) => {
        bridge = undefined;
        throw error;
      });
      const cli = await bridge;
      return {
        state,
        prompt: buildBugFinderHandoff(
          r.locator,
          state,
          selected,
          `node ${shellQuote(cli.script)} --connection ${shellQuote(cli.connection)}`
        )
      };
    }
    const detail = await loadGitHubPullRequestDetail(r.locator);
    if (detail.headSha !== r.headSha)
      throw new Error('STALE_HEAD: Reload this PR before posting.');
    // Resolve uncertain submissions using the unique marker, never by blindly retrying a POST.
    for (const f of selected) {
      if (f.publication) {
        const comments = detail.reviewComments.filter(
          (c) =>
            c.author === detail.viewerLogin &&
            c.body.includes(f.publication!.marker)
        );
        if (comments.length) {
          f.publication = {
            ...f.publication,
            status: 'posted',
            commentIds: comments.map((c) => c.id)
          };
          db.save(r.locator, state);
        }
      }
    }
    if (selected.some((f) => f.publication))
      throw new Error(
        'These findings were posted or have an unconfirmed submission. Check GitHub before taking further action.'
      );
    for (const f of selected) validateBugLocation(f, detail);
    const batch = randomUUID();
    for (const f of selected) {
      f.publication = {
        status: 'posting',
        marker: `<!-- git-gud-finding:${f.id}:${batch} -->`,
        commentIds: []
      };
      f.version++;
    }
    db.save(r.locator, state);
    try {
      const result = await postBugFinderReview({
        ...r.locator,
        event: 'comment',
        body: '',
        commitId: r.headSha!,
        fileComments: [],
        replies: [],
        comments: selected.map((f, i) => ({
          id: f.id,
          body: `${r.selected![i].body ?? `${f.title}\n\n${f.body}\n\n${f.evidence.detail}`}\n\n${f.publication!.marker}`,
          path: f.location.path,
          line: f.location.endLine,
          side: f.location.side,
          ...(f.location.endLine !== f.location.line
            ? { startLine: f.location.line, startSide: f.location.side }
            : {})
        }))
      });
      for (const f of selected) {
        f.publication!.status = 'posted';
        f.publication!.reviewId = result.reviewId;
        f.history.push({
          at: new Date().toISOString(),
          actor,
          action: 'posted'
        });
      }
      db.save(r.locator, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // A definitive client rejection cannot have published a review; transport/server errors may have.
      const rejected = /HTTP (?:400|401|403|404|409|422|429)\b/u.test(message);
      for (const f of selected) {
        if (rejected) delete f.publication;
        else f.publication!.status = 'uncertain';
      }
      db.save(r.locator, state);
      if (rejected) throw error;
      throw new Error(
        `Submission could not be confirmed. Check GitHub before retrying. ${error instanceof Error ? error.message : ''}`,
        { cause: error }
      );
    }
    return { state };
  }
  if (r.action === 'add' || r.action === 'update') {
    const detail = await loadGitHubPullRequestDetail(r.locator);
    if (detail.headSha !== r.headSha)
      throw new Error(
        'STALE_HEAD: The PR changed while validating the finding.'
      );
    validateBugLocation(r.content!, detail);
    state = db.get(r.locator);
  }
  if (r.action === 'add')
    state.findings.push(newBugFinding(r.content!, r.headSha!, actor));
  else {
    const finding = checkedFinding(state, r.id!, r.version!);
    if (finding.publication)
      throw new Error(
        'Posted or publication-pending findings cannot be edited.'
      );
    if (finding.status === 'removed' && r.action !== 'restore')
      throw new Error('Restore the removed finding before editing.');
    if (r.action === 'update')
      Object.assign(finding, r.content, { headSha: r.headSha });
    else
      finding.status =
        r.action === 'dismiss'
          ? 'dismissed'
          : r.action === 'remove'
            ? 'removed'
            : 'open';
    finding.version++;
    finding.history.push({
      at: new Date().toISOString(),
      actor,
      action: r.action,
      ...(r.reason ? { reason: r.reason } : {})
    });
  }
  db.save(r.locator, state);
  return { state };
}
