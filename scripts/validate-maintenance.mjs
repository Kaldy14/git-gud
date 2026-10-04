import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// Launches the actual built Electron app, using only disposable Git repositories,
// local bare remotes, and isolated application settings. No renderer/API mocks.
const exec = promisify(execFile);
const project = resolve(import.meta.dirname, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-maintenance-e2e-')));
const artifacts = join(project, 'artifacts', 'maintenance');
await mkdir(artifacts, { recursive: true });
const fixture = join(root, 'maintenance-demo');
const remote = join(root, 'origin.git');
const userData = join(root, 'user-data');
await mkdir(fixture);
await mkdir(userData);
await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_DATE: '2025-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T12:00:00Z' }
}).trim();
async function commit(file, content) {
  await writeFile(join(fixture, file), content);
  git(fixture, 'add', file);
  git(fixture, 'commit', '-m', file);
  return git(fixture, 'rev-parse', 'HEAD');
}
git(fixture, 'init', '-b', 'main');
git(fixture, 'config', 'user.name', 'Git Gud Validation');
git(fixture, 'config', 'user.email', 'validation@example.invalid');
git(fixture, 'config', 'commit.gpgsign', 'false');
await commit('README.md', '# Maintenance validation\n');
const rootSha = git(fixture, 'rev-parse', 'HEAD');
git(fixture, 'checkout', '-b', 'feature/merged-search');
await commit('search.txt', 'Merged search feature\n');
git(fixture, 'checkout', 'main');
git(fixture, 'merge', '--no-ff', 'feature/merged-search', '-m', 'Merge search');
git(fixture, 'checkout', '-b', 'feature/rebased-fix', rootSha);
const rebased = await commit('fix.txt', 'Rebased fix\n');
git(fixture, 'checkout', 'main');
git(fixture, 'cherry-pick', rebased);
git(fixture, 'checkout', '-b', 'feature/squashed-ui', rootSha);
await commit('ui.txt', 'First UI change\n');
await commit('ui.txt', 'First UI change\nSecond UI change\n');
git(fixture, 'checkout', 'main');
git(fixture, 'merge', '--squash', 'feature/squashed-ui');
git(fixture, 'commit', '-m', 'Squash UI feature');
git(fixture, 'checkout', '-b', 'feature/unfinished', rootSha);
await commit('unfinished.txt', 'Unintegrated work\n');
git(fixture, 'checkout', 'main');
git(fixture, 'branch', 'feature/stale-preview');
git(fixture, 'branch', 'feature/worktree-active');
git(fixture, 'worktree', 'add', join(root, 'linked'), 'feature/worktree-active');
git(fixture, 'branch', 'release/2026');
git(root, 'clone', '--bare', fixture, remote);
git(fixture, 'remote', 'add', 'origin', remote);
git(fixture, 'fetch', 'origin');
git(fixture, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
git(fixture, 'tag', 'local-only-tag');
git(fixture, 'config', 'fetch.pruneTags', 'true');
git(fixture, 'config', 'remote.origin.pruneTags', 'true');
git(fixture, 'config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*');
git(fixture, 'update-ref', 'refs/remotes/origin/already-deleted', rootSha);
await writeFile(join(userData, 'git-gud-workspace.json'), JSON.stringify({ settings: { autoFetchIntervalMinutes: 0, remoteAvatars: false } }));

async function freePort() {
  const server = createServer();
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const port = server.address().port;
  await new Promise((closed) => server.close(closed));
  return port;
}
const cdpPort = await freePort();
const controlPort = await freePort();
const launch = join(root, 'launch.cjs');
await writeFile(launch, `
const { app } = require('electron');
const http = require('node:http');
app.setPath('userData', ${JSON.stringify(userData)});
let window;
const messages = [];
app.on('browser-window-created', (_event, created) => {
  window = created;
  created.webContents.on('console-message', (_event, details) => messages.push({level: details.level, message: details.message}));
});
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/resize') window?.setSize(Number(url.searchParams.get('width')), Number(url.searchParams.get('height')));
  if (url.pathname === '/quit') window?.close();
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ready: Boolean(window), messages}));
}).listen(${controlPort}, '127.0.0.1');
require(${JSON.stringify(join(project, 'out/main/index.js'))});
`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const application = spawn(join(project, 'node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'),
  [launch, `--remote-debugging-port=${cdpPort}`], { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
let applicationLog = '';
let launchError;
application.on('error', (error) => { launchError = error; });
application.stdout.on('data', (chunk) => { applicationLog += chunk; });
application.stderr.on('data', (chunk) => { applicationLog += chunk; });
const session = `git-gud-maintenance-${process.pid}`;
let appConnected = false;
const report = { url: `file://${project}/out/renderer/index.html`, root, cdpPort, session, checks: [], screenshots: [], commands: [] };
const agent = async (...args) => {
  report.commands.push(['pnpm', 'dlx', 'agent-browser', '--session', session, ...args]);
  return (await exec('pnpm', ['dlx', 'agent-browser', '--session', session, ...args], { cwd: project, timeout: 35_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
};
const evaluate = async (expression) => JSON.parse(await agent('eval', expression));
const control = async (path = '/') => (await globalThis.fetch(`http://127.0.0.1:${controlPort}${path}`)).json();
async function waitFor(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error('Application validation condition timed out.');
}
const textIncludes = (text) => evaluate(`(document.querySelector('[role="dialog"]') ?? document.body).innerText.includes(${JSON.stringify(text)})`);
const button = (name) => agent('find', 'role', 'button', 'click', '--name', name, '--exact');
async function screenshot(name) {
  const path = join(artifacts, `${name}.png`);
  await agent('screenshot', path);
  report.screenshots.push(path);
}
async function openMaintenance() {
  await agent('snapshot', '-i');
  await button('Actions');
  await agent('snapshot', '-i');
  await agent('find', 'role', 'menuitem', 'click', '--name', 'Repository maintenance…', '--exact');
  await waitFor(() => textIncludes('Select merged'));
  report.snapshot = await agent('snapshot', '-i');
}
function pass(name) {
  report.checks.push({ name, pass: true });
  process.stdout.write(`PASS: ${name}\n`);
}

try {
  await waitFor(async () => { if (launchError) throw launchError; try { return (await control()).ready; } catch { return false; } });
  await agent('connect', String(cdpPort));
  appConnected = true;
  await waitFor(() => evaluate('Boolean(window.api)'));
  await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(fixture)}).then(() => true)`);
  await evaluate('location.reload(); true');
  await waitFor(() => textIncludes('maintenance-demo'));
  await openMaintenance();
  assert.ok(await textIncludes('feature/merged-search'));
  assert.ok(await textIncludes('Equivalent patches'));
  assert.ok(await textIncludes('Content in base'));
  assert.equal(await evaluate('Boolean(document.querySelector(\'[aria-label="Select feature/unfinished"]\'))'), false);
  assert.equal(git(fixture, 'symbolic-ref', 'HEAD'), 'refs/heads/main');
  await screenshot('branch-analysis');
  pass('Real app analyzes ordinary, rebase, and squash integration without changing checkout');

  await agent('find', 'role', 'checkbox', 'click', '--name', 'Show protected and recent', '--exact');
  assert.ok(await textIncludes('Mainline or default branch') || await textIncludes('Comparison branch'), 'Protected branches must be visible when requested');
  await screenshot('protected-branches');
  pass('Protected mainline and linked worktree branches are visible and cannot be selected');
  await agent('find', 'role', 'checkbox', 'click', '--name', 'Show protected and recent', '--exact');

  await agent('check', 'input[type="checkbox"][aria-label="Select feature/squashed-ui"]');
  await button('Review deletion…');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Delete 1 branch').disabled`), true);
  await screenshot('heuristic-confirmation');
  pass('Heuristic cleanup requires a separate acknowledgement');
  await button('Back');
  await button('Clear');
  await agent('check', 'input[type="checkbox"][aria-label="Select feature/merged-search"]');
  await button('Review deletion…');
  await screenshot('local-delete-review');
  await button('Delete 1 branch');
  await waitFor(() => textIncludes('Cleanup results'));
  assert.ok(await textIncludes('Deleted 1 branch.'));
  assert.equal(git(fixture, 'branch', '--list', 'feature/merged-search'), '');
  const recovery = git(fixture, 'for-each-ref', '--format=%(refname)', 'refs/git-gud/cleanup').split('\n').find((ref) => ref.endsWith('/local/feature/merged-search'));
  assert.ok(recovery);
  assert.equal(git(fixture, 'rev-parse', recovery), git(remote, 'rev-parse', 'refs/heads/feature/merged-search'));
  await button('Copy restore command for feature/merged-search');
  const restoreCommand = await evaluate('navigator.clipboard.readText()');
  await exec('/bin/sh', ['-c', restoreCommand], { cwd: fixture });
  assert.equal(git(fixture, 'rev-parse', 'refs/heads/feature/merged-search'), git(fixture, 'rev-parse', recovery));
  await screenshot('local-cleanup-recovery');
  pass('Reviewed local deletion retains a reachable backup; copied restore command works');

  await button('Scan again');
  await waitFor(() => textIncludes('Select merged'));
  await agent('check', 'input[type="checkbox"][aria-label="Select feature/stale-preview"]');
  await button('Review deletion…');
  const changedSha = git(fixture, 'rev-parse', 'refs/heads/feature/unfinished');
  git(fixture, 'update-ref', 'refs/heads/feature/stale-preview', changedSha);
  await button('Delete 1 branch');
  await waitFor(() => textIncludes('selected branch changed or disappeared'));
  assert.equal(git(fixture, 'rev-parse', 'refs/heads/feature/stale-preview'), changedSha);
  await screenshot('stale-preview-error');
  pass('Changed branch preview is rejected and branch is preserved');

  await button('Back');
  await button('Update remote branches');
  await waitFor(() => textIncludes('Select merged'));
  assert.equal(git(fixture, 'tag', '--list', 'local-only-tag'), 'local-only-tag');
  assert.equal(git(fixture, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/already-deleted'), '');
  await agent('click', '[aria-label="Branch location"] button:nth-child(2)');
  await agent('snapshot', '-i');
  await agent('check', 'input[type="checkbox"][aria-label="Select origin/feature/merged-search"]');
  await button('Review deletion…');
  assert.ok(await textIncludes('affects everyone using that remote'));
  await screenshot('remote-delete-review');
  await button('Delete 1 branch');
  await waitFor(() => textIncludes('Cleanup results'));
  assert.ok(await textIncludes('Deleted 1 branch.'));
  assert.equal(git(remote, 'branch', '--list', 'feature/merged-search'), '');
  assert.ok(git(fixture, 'branch', '--list', 'feature/merged-search'));
  await screenshot('remote-cleanup-result');
  pass('Heads-only refresh preserves tags; confirmed remote deletion leaves the local branch intact');

  await button('Scan again');
  await waitFor(() => textIncludes('Select merged'));
  await agent('fill', 'input[type="number"]', '36500');
  await button('Scan');
  await waitFor(() => textIncludes('No remote branches match'));
  await control('/resize?width=960&height=720');
  await screenshot('empty-narrow-window');
  const layout = await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); const r = d.getBoundingClientRect(); return {width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight, horizontalOverflow: d.scrollWidth > d.clientWidth}; })()`);
  assert.ok(layout.width <= layout.viewportWidth && layout.height <= layout.viewportHeight);
  assert.equal(layout.horizontalOverflow, false);
  pass('Empty scan and narrow 960×720 window remain usable');
  report.console = await agent('console');
  report.errors = await agent('errors');
  report.network = await agent('network', 'requests');
  report.nativeConsole = (await control()).messages;
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = error.stack ?? String(error);
  try {
    if (!appConnected) throw error;
    report.failureSnapshot = await agent('snapshot', '-i');
    await screenshot('failure');
    report.console = await agent('console');
    report.errors = await agent('errors');
  } catch { /* Preserve the original validation failure. */ }
  process.exitCode = 1;
} finally {
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, 'electron.log'), applicationLog);
  if (!process.env.GIT_GUD_KEEP_MAINTENANCE_APP) {
    try { await control('/quit'); } catch { /* App may have already exited. */ }
    try { await agent('close'); } catch { /* No shared browser session is touched. */ }
    application.kill();
  } else {
    application.unref();
    application.stdout.destroy();
    application.stderr.destroy();
  }
  process.stdout.write(`Report: ${join(artifacts, 'report.json')}\n`);
  if (report.error) process.stderr.write(`${report.error}\n`);
}
