import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import type { GitHubPullRequestDetail } from '@shared/types';
import { prepareBugFinderCheckout, verifyBugFinderCheckout } from './bugFinderCheckout';
import { scanPullRequestBugs } from './bugFinderScan';
import { loadBugFinderGitContext } from './github';

vi.mock('./github', () => ({ loadBugFinderGitContext: vi.fn() }));
const exec = promisify(execFile);
const roots: string[] = [];
const locator = { profileId: 'test', owner: 'test', repository: 'test', number: 1 };
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'bug-finder-fixture-'));
  roots.push(path);
  const git = async (...args: string[]) => (await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: path })).stdout.trim();
  await git('init');
  await writeFile(join(path, 'money.mjs'), 'export const total = prices => prices.reduce((sum, price) => sum + price, 0);\nexport const dollars = cents => cents / 100;\n');
  await writeFile(join(path, 'money.test.mjs'), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { total, dollars } from "./money.mjs";\ntest("total", () => assert.equal(total([2, 3]), 5));\ntest("dollars", () => assert.equal(dollars(250), 2.5));\n');
  await git('add', '.');
  await git('commit', '-m', 'Base');
  const baseSha = await git('rev-parse', 'HEAD');
  await writeFile(join(path, 'money.mjs'), 'export const total = prices => prices.reduce((sum, price) => sum + price, 1);\nexport const dollars = cents => cents * 100;\n');
  await git('add', '.');
  await git('commit', '-m', 'Refactor calculations');
  const headSha = await git('rev-parse', 'HEAD');
  const patch = await git('diff', baseSha, headSha, '--', 'money.mjs');
  const url = pathToFileURL(path).href;
  vi.mocked(loadBugFinderGitContext).mockResolvedValue({ url, executable: 'gh', env: { GH_CONFIG_DIR: '', GH_HOST: '', GH_TOKEN: '', GITHUB_TOKEN: '', GH_ENTERPRISE_TOKEN: '', GITHUB_ENTERPRISE_TOKEN: '', GIT_TERMINAL_PROMPT: '0' } });
  const detail = { title: 'Refactor calculations without changing results', url, headSha, baseSha, files: [{ path: 'money.mjs', status: 'modified', patch }] } as GitHubPullRequestDetail;
  return { path, detail, git };
}

it('fetches exact head and base commits into a disposable checkout without touching the original', async () => {
  const { path, detail, git } = await fixture();
  await writeFile(join(path, 'money.mjs'), 'user uncommitted edits');
  const checkout = await prepareBugFinderCheckout(locator, detail);
  try {
    expect(checkout.path).not.toBe(path);
    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: checkout.path })).stdout.trim()).toBe(detail.headSha);
    expect((await exec('git', ['show', `${detail.baseSha}:money.mjs`], { cwd: checkout.path })).stdout).toContain('cents / 100');
    expect(await readFile(join(checkout.path, 'money.test.mjs'), 'utf8')).toContain('node:test');
    expect(await readFile(join(path, 'money.mjs'), 'utf8')).toBe('user uncommitted edits');
    expect(await git('rev-parse', 'HEAD')).toBe(detail.headSha);
    await verifyBugFinderCheckout(checkout.path, detail.headSha);
    await writeFile(join(checkout.path, 'money.mjs'), 'modified by investigation');
    await expect(verifyBugFinderCheckout(checkout.path, detail.headSha)).rejects.toThrow('Results were discarded');
  } finally { await checkout.cleanup(); }
  await expect(readFile(join(checkout.path, 'money.mjs'))).rejects.toThrow();
});

it('fails rather than reviewing a different revision', async () => {
  const { detail } = await fixture();
  await expect(prepareBugFinderCheckout(locator, { ...detail, headSha: '0'.repeat(40) })).rejects.toThrow();
});

it.runIf(process.env.BUG_FINDER_LIVE_TEST === '1')('uses real Astra tools to reproduce defects from the full checkout', async () => {
  const { detail } = await fixture();
  const result = await scanPullRequestBugs(locator, detail);
  expect(result.findings.length).toBeGreaterThanOrEqual(2);
  expect(result.findings.some((finding) => finding.evidence.kind === 'reproduced')).toBe(true);
  expect(result.findings.map((finding) => finding.evidence.detail).join('\n') + result.coverage).toMatch(/node (?:--test|money\.test)/u);
}, 300_000);
