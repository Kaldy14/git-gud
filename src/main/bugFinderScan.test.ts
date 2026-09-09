import { describe, expect, it, vi } from 'vitest';
import type { GitHubPullRequestDetail } from '@shared/types';
import { parseBugScan } from './bugFinderScan';
vi.mock('./github', () => ({ loadBugFinderSource: vi.fn() }));
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
  it('rejects reproduction claims from the read-only scanner', () => {
    expect(() => parseBugScan(output({ ...finding, evidence: { ...finding.evidence, kind: 'reproduced' } }), detail)).toThrow('cannot claim a reproduction');
  });
});
