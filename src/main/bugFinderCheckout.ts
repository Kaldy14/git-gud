import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitHubPullRequestDetail, GitHubPullRequestLocator } from '@shared/types';
import { gitExecutor } from './git/exec';
import { loadBugFinderGitContext } from './github';
import { shellQuote } from './bugFinderHandoff';

export async function prepareBugFinderCheckout(locator: GitHubPullRequestLocator, detail: GitHubPullRequestDetail) {
  if (![detail.headSha, detail.baseSha].every((sha) => /^[a-f0-9]{40}$/iu.test(sha))) {
    throw new Error('Bug finder requires full PR head and base commit hashes.');
  }
  const context = await loadBugFinderGitContext(locator);
  if (new URL(context.url).host !== new URL(detail.url).host) throw new Error('The GitHub profile host changed. Reload this PR.');
  const path = await mkdtemp(join(tmpdir(), 'git-gud-bug-scan-'));
  const cleanup = () => rm(path, { recursive: true, force: true });
  const run = (args: string[]) => gitExecutor.run(args, { cwd: path, env: context.env, kind: 'mutation', timeoutMs: 5 * 60_000 });
  try {
    await run(['init']);
    await run(['remote', 'add', 'origin', context.url]);
    // Scope authentication to this fetch, without storing credentials in the checkout.
    await run(['-c', 'credential.helper=', '-c', `credential.helper=!${shellQuote(context.executable)} auth git-credential`,
      'fetch', '--no-tags', 'origin', detail.headSha, detail.baseSha]);
    await run(['-c', 'core.hooksPath=', 'checkout', '--detach', detail.headSha]);
    const head = await run(['rev-parse', 'HEAD']);
    if (head.stdout.trim().toLowerCase() !== detail.headSha.toLowerCase()) throw new Error('Bug finder checkout does not match the PR revision.');
    return { path, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function verifyBugFinderCheckout(path: string, headSha: string) {
  const head = await gitExecutor.run(['rev-parse', 'HEAD'], { cwd: path });
  const diff = await gitExecutor.run(['diff', '--quiet', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], { cwd: path, allowedExitCodes: [1] });
  if (head.stdout.trim().toLowerCase() !== headSha.toLowerCase() || diff.exitCode !== 0) {
    throw new Error('Bug finder changed the reviewed checkout. Results were discarded; run the scan again.');
  }
}
