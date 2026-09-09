import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BugFindingContent } from '@shared/bugFinder';
import { parseBugRequest } from '@shared/bugFinder';
import type { GitHubPullRequestDetail } from '@shared/types';

const mocks = vi.hoisted(() => ({
  directory: '',
  head: vi.fn(),
  detail: vi.fn(),
  scan: vi.fn(),
  submit: vi.fn()
}));
vi.mock('electron', () => ({ app: { getPath: () => mocks.directory } }));
vi.mock('./github', () => ({
  loadBugFinderHead: mocks.head,
  loadGitHubPullRequestDetail: mocks.detail,
  postBugFinderReview: mocks.submit
}));
vi.mock('./bugFinderScan', async (original) => ({
  ...(await original<typeof import('./bugFinderScan')>()),
  scanPullRequestBugs: mocks.scan
}));
vi.mock('./bugFinderBridge', () => ({
  startBugFinderBridge: vi.fn(async () => ({
    script: '/fixture/git-gud.mjs',
    connection: '/fixture/connection.json'
  }))
}));
const locator = {
  profileId: 'test',
  owner: 'example',
  repository: 'demo',
  number: 12
};
const headSha = 'a'.repeat(40);
const content: BugFindingContent = {
  title: 'Late response overwrites results',
  body: 'An earlier request can complete after the latest request.',
  category: 'bug',
  severity: 'major',
  evidence: {
    kind: 'code',
    detail: 'The result setter has no active request guard.'
  },
  location: { path: 'src/search.ts', line: 2, endLine: 2, side: 'right' }
};
const detail = {
  ...locator,
  headSha,
  title: 'Search',
  url: 'https://github.com/example/demo/pull/12',
  baseRefName: 'main',
  headRefName: 'search',
  viewerLogin: 'reviewer',
  reviewComments: [],
  files: [
    {
      path: 'src/search.ts',
      patch:
        '@@ -1,2 +1,2 @@\n const data = await search();\n-setResults([]);\n+setResults(data);'
    }
  ]
} as unknown as GitHubPullRequestDetail;
let handle: (typeof import('./bugFinder'))['handleBugFinder'];
async function ready() {
  await handle({ locator, action: 'start' });
  await vi.waitFor(async () =>
    expect((await handle({ locator, action: 'get' })).state.status).toBe(
      'ready'
    )
  );
  return (await handle({ locator, action: 'get' })).state.findings[0]!;
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.directory = mkdtempSync(join(tmpdir(), 'git-gud-bugs-'));
  mocks.head.mockResolvedValue({ headSha, host: 'github.com' });
  mocks.detail.mockResolvedValue(detail);
  mocks.scan.mockResolvedValue({
    findings: [content],
    coverage: 'One file inspected; tests not run.'
  });
  mocks.submit.mockResolvedValue({ reviewId: 42 });
  handle = (await import('./bugFinder')).handleBugFinder;
});
afterEach(() => {
  rmSync(mocks.directory, { recursive: true, force: true });
});

describe('PR finding records', () => {
  it('rejects stale agents and preserves the winning edit', async () => {
    const finding = await ready();
    await handle(
      {
        locator,
        action: 'update',
        headSha,
        id: finding.id,
        version: 1,
        content: { ...content, title: 'Verified request race' }
      },
      'agent'
    );
    await expect(
      handle(
        {
          locator,
          action: 'dismiss',
          headSha,
          id: finding.id,
          version: 1,
          reason: 'Old conclusion'
        },
        'agent'
      )
    ).rejects.toThrow('CONFLICT');
    expect(
      (await handle({ locator, action: 'get' })).state.findings[0]
    ).toMatchObject({
      title: 'Verified request race',
      version: 2,
      status: 'open'
    });
  });
  it('refuses writes after the PR head changes', async () => {
    const finding = await ready();
    mocks.head.mockResolvedValue({ headSha: 'b'.repeat(40), host: 'github.com' });
    await expect(
      handle({
        locator,
        action: 'remove',
        headSha,
        id: finding.id,
        version: finding.version
      })
    ).rejects.toThrow('STALE_HEAD');
  });
  it('preserves dismissal reasons and stable IDs through rescans and restarts', async () => {
    const finding = await ready();
    await handle(
      {
        locator,
        action: 'dismiss',
        headSha,
        id: finding.id,
        version: 1,
        reason: 'Caller already guards the request'
      },
      'agent'
    );
    await ready();
    vi.resetModules();
    handle = (await import('./bugFinder')).handleBugFinder;
    const stored = (await handle({ locator, action: 'get' })).state.findings;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: finding.id,
      status: 'dismissed',
      version: 2
    });
    expect(stored[0]!.history.at(-1)?.reason).toContain('Caller');
  });
  it('posts only selected current findings with the edited comment, and blocks duplicate publication', async () => {
    const finding = await ready();
    await handle({
      locator,
      action: 'add',
      headSha,
      content: { ...content, title: 'Separate defect' }
    });
    const selection = [
      {
        id: finding.id,
        version: finding.version,
        body: 'Please guard this request completion.'
      }
    ];
    const result = await handle({
      locator,
      action: 'post',
      headSha,
      selected: selection
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit.mock.calls[0]![0].comments).toHaveLength(1);
    expect(mocks.submit.mock.calls[0]![0].comments[0].body).toContain(
      'Please guard this request completion.'
    );
    const posted = result.state.findings[0]!;
    expect(posted.publication?.status).toBe('posted');
    expect(result.state.findings[1]!.publication).toBeUndefined();
    await expect(
      handle({
        locator,
        action: 'post',
        headSha,
        selected: [{ id: posted.id, version: posted.version }]
      })
    ).rejects.toThrow('were posted');
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it('retains an uncertain submission after a network failure and never blindly reposts it', async () => {
    const finding = await ready();
    mocks.submit.mockRejectedValue(new Error('Connection lost'));
    await expect(
      handle({
        locator,
        action: 'post',
        headSha,
        selected: [{ id: finding.id, version: finding.version }]
      })
    ).rejects.toThrow('could not be confirmed');
    const current = (await handle({ locator, action: 'get' })).state
      .findings[0]!;
    expect(current.publication?.status).toBe('uncertain');
    await expect(
      handle({
        locator,
        action: 'post',
        headSha,
        selected: [{ id: current.id, version: current.version }]
      })
    ).rejects.toThrow('unconfirmed');
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it('does not lose an agent edit when generation completes during a write', async () => {
    const finding = await ready();
    let finish!: (value: {
      findings: BugFindingContent[];
      coverage: string;
    }) => void;
    mocks.scan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await handle({ locator, action: 'start' });
    const update = handle(
      {
        locator,
        action: 'update',
        headSha,
        id: finding.id,
        version: finding.version,
        content: { ...content, body: 'Agent verified the caller guard.' }
      },
      'agent'
    );
    finish({ findings: [content], coverage: 'Updated scan' });
    await update;
    await vi.waitFor(async () =>
      expect((await handle({ locator, action: 'get' })).state.status).toBe(
        'ready'
      )
    );
    expect(
      (await handle({ locator, action: 'get' })).state.findings[0]!.body
    ).toBe('Agent verified the caller guard.');
  });
  it('exports a zero-context prompt with the installed CLI and selected IDs only', async () => {
    const finding = await ready();
    const result = await handle({
      locator,
      action: 'prompt',
      headSha,
      selected: [{ id: finding.id, version: 1 }]
    });
    expect(result.prompt).toContain('desktop Git client');
    expect(result.prompt).toContain("node '/fixture/git-gud.mjs'");
    expect(result.prompt).toContain(headSha);
    expect(result.prompt).toContain(finding.id);
    expect(result.prompt).toContain('--if-version');
    expect(result.prompt).not.toContain('{{');
  });
  it('rejects a changed account host even when commit hashes match', async () => {
    const finding = await ready();
    mocks.head.mockResolvedValue({ headSha, host: 'github.other.example' });
    await expect(handle({ locator, action: 'remove', headSha, id: finding.id, version: 1 })).rejects.toThrow('host');
  });
  it('allows correction and retry after a definitive GitHub rejection', async () => {
    const finding = await ready(); mocks.submit.mockRejectedValueOnce(new Error('Validation Failed (HTTP 422)'));
    await expect(handle({ locator, action: 'post', headSha, selected: [{ id: finding.id, version: 1 }] })).rejects.toThrow('422');
    const current = (await handle({ locator, action: 'get' })).state.findings[0]!;
    expect(current.publication).toBeUndefined();
    const result = await handle({ locator, action: 'post', headSha, selected: [{ id: current.id, version: current.version }] });
    expect(result.state.findings[0]!.publication).toMatchObject({ status: 'posted', reviewId: 42 });
  });
  it('confirms an uncertain publication after the PR head advances', async () => {
    const finding = await ready(); mocks.submit.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(handle({ locator, action: 'post', headSha, selected: [{ id: finding.id, version: 1 }] })).rejects.toThrow('could not be confirmed');
    const saved = (await handle({ locator, action: 'get' })).state.findings[0]!;
    mocks.head.mockResolvedValue({ headSha: 'b'.repeat(40), host: 'github.com' });
    mocks.detail.mockResolvedValue({ ...detail, headSha: 'b'.repeat(40), reviewComments: [{ id: 123, author: 'reviewer', body: saved.publication!.marker }] });
    const result = await handle({ locator, action: 'reconcile', headSha: 'b'.repeat(40) });
    expect(result.state.findings[0]!.publication).toMatchObject({ status: 'posted', commentIds: [123] });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it('reports a scan failure without discarding saved findings', async () => {
    const finding = await ready(); mocks.scan.mockRejectedValueOnce(new Error('Provider unavailable'));
    await handle({ locator, action: 'start' });
    await vi.waitFor(async () => expect((await handle({ locator, action: 'get' })).state.status).toBe('failed'));
    const failed = (await handle({ locator, action: 'get' })).state;
    expect(failed.error).toContain('Provider unavailable'); expect(failed.findings[0]!.id).toBe(finding.id);
  });
  it('preserves whitespace in real Git paths', () => {
    const request = parseBugRequest({ locator, action: 'add', headSha, content: { ...content, location: { ...content.location, path: ' src/search.ts ' } } });
    expect(request.content!.location.path).toBe(' src/search.ts ');
  });
  it('rejects injected paths, missing dismissal reasons, and duplicate selections', () => {
    expect(() =>
      parseBugRequest({
        locator,
        action: 'add',
        headSha,
        content: {
          ...content,
          location: { ...content.location, path: '../outside' }
        }
      })
    ).toThrow('repository-relative');
    expect(() =>
      parseBugRequest({
        locator,
        action: 'dismiss',
        headSha,
        id: 'x',
        version: 1
      })
    ).toThrow('reason');
    expect(() =>
      parseBugRequest({
        locator,
        action: 'post',
        headSha,
        selected: [
          { id: 'x', version: 1 },
          { id: 'x', version: 1 }
        ]
      })
    ).toThrow('Duplicate');
  });
});
