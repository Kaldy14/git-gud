import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubPullRequestDetail } from '@shared/types';
import { parseBugScan, scanPullRequestBugs } from './bugFinderScan';
import { prepareBugFinderCheckout } from './bugFinderCheckout';
import { runPiPrompt } from './piHarness';
vi.mock('./piHarness', () => ({ runPiPrompt: vi.fn() }));
vi.mock('./bugFinderCheckout', () => ({ prepareBugFinderCheckout: vi.fn(), verifyBugFinderCheckout: vi.fn(async () => {}) }));
const cleanup = vi.fn(async () => {});
beforeEach(() => {
  cleanup.mockClear();
  vi.mocked(prepareBugFinderCheckout).mockResolvedValue({ path: '/isolated/repo', cleanup });
});
const detail = { files: [{ path: 'src/search.ts', patch: '@@ -1,2 +1,2 @@\n const results = await search();\n-setResults([]);\n+setResults(results);' }] } as unknown as GitHubPullRequestDetail;
const finding = { title: 'Request race', body: 'An old request may overwrite newer results.', category: 'bug', severity: 'major', evidence: { kind: 'code', detail: 'No guard before setting results.' }, location: { path: 'src/search.ts', line: 2, endLine: 2, side: 'right' } };
const output = (value: typeof finding) => JSON.stringify({ findings: [value], coverage: 'No tests ran.' });
describe('bug scan evidence boundaries', () => {
  it('accepts findings attached to supplied changed code, and an evidence-limited empty result', () => {
    expect(parseBugScan(output(finding), detail).findings[0]!.location.line).toBe(2);
    expect(parseBugScan('{"findings":[],"coverage":"No supported bugs in supplied files."}', detail).findings).toEqual([]);
  });
  it('accepts a fenced JSON response surrounded by whitespace', () => {
    expect(parseBugScan(' \n```json\n' + output(finding) + '\n```\n ', detail).findings).toHaveLength(1);
  });
  it('rejects hallucinated locations and unchanged-only ranges', () => {
    expect(() => parseBugScan(output({ ...finding, location: { ...finding.location, path: 'missing.ts' } }), detail)).toThrow('changed range');
    expect(() => parseBugScan(output({ ...finding, location: { ...finding.location, line: 1, endLine: 1 } }), detail)).toThrow('changed range');
  });
  it('accepts reproduction evidence from the repository investigator', () => {
    expect(parseBugScan(output({ ...finding, evidence: { kind: 'reproduced', detail: 'node test-race.mjs failed with stale results' } }), detail).findings[0].evidence.kind).toBe('reproduced');
  });
});

describe('iterative bug scan', () => {
  it('investigates in the isolated checkout and retracts disproven findings', async () => {
    const second = { ...finding, title: 'Missing error handling' };
    vi.mocked(runPiPrompt).mockReset()
      .mockResolvedValueOnce(JSON.stringify({ findings: [finding], coverage: 'Need caller', requestedPaths: ['src/caller.ts', '../secret', '/etc/passwd'] }))
      .mockResolvedValueOnce(JSON.stringify({ findings: [finding, second], coverage: 'Checked caller' }))
      .mockResolvedValueOnce(JSON.stringify({ findings: [second], coverage: 'Race disproved; error handling confirmed' }));
    const result = await scanPullRequestBugs({ profileId: 'test', owner: 'owner', repository: 'repo', number: 1 }, { ...detail, headSha: 'abc12345' });
    for (const [options] of vi.mocked(runPiPrompt).mock.calls) {
      expect(options).toMatchObject({ cwd: '/isolated/repo', tools: 'read,grep,find,ls,bash', finalResponseOnly: true });
    }
    expect(vi.mocked(runPiPrompt).mock.calls[2][0].prompt).toContain('Missing error handling');
    expect(result.findings).toEqual([second]);
    expect(runPiPrompt).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('reviews files beyond the first batch and preserves independent findings from both batches', async () => {
    const files = Array.from({ length: 25 }, (_, index) => ({ ...detail.files[0], path: `src/file${index}.ts` }));
    let call = 0;
    vi.mocked(runPiPrompt).mockReset().mockImplementation(async () => {
      const index = call++ < 3 ? 0 : 24;
      return JSON.stringify({ findings: [ { ...finding, location: { ...finding.location, path: files[index].path } } ], coverage: 'Checked' });
    });
    const result = await scanPullRequestBugs({ profileId: 'test', owner: 'owner', repository: 'repo', number: 1 }, { ...detail, files, headSha: 'abc12345' });
    expect(result.findings.map((item) => item.location.path)).toEqual(['src/file0.ts', 'src/file24.ts']);
    expect(runPiPrompt).toHaveBeenCalledTimes(6);
    expect(vi.mocked(runPiPrompt).mock.calls[3][0].prompt).toContain('src/file24.ts');
  });

  it('cleans up the checkout when investigation fails', async () => {
    vi.mocked(runPiPrompt).mockReset().mockRejectedValue(new Error('provider failed'));
    await expect(scanPullRequestBugs({ profileId: 'test', owner: 'owner', repository: 'repo', number: 1 }, { ...detail, headSha: 'abc12345' })).rejects.toThrow('provider failed');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
