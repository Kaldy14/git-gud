import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// Runs the actual application against disposable repositories and a local bare remote.
const exec = promisify(execFile);
const project = resolve(import.meta.dirname, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-pull-recovery-e2e-')));
const artifacts = join(project, 'artifacts', 'pull-recovery');
const fixture = join(root, 'blocked-pull-demo');
const writer = join(root, 'writer');
const other = join(root, 'another-repo');
const remote = join(root, 'origin.git');
const userData = join(root, 'user-data');
await mkdir(artifacts, { recursive: true });
await mkdir(userData);
await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}).trim();
git(root, 'init', '--bare', '--initial-branch=main', remote);
git(root, 'clone', remote, writer);
for (const path of [writer]) {
  git(path, 'config', 'user.name', 'Git Gud Validation');
  git(path, 'config', 'user.email', 'validation@example.invalid');
  git(path, 'config', 'commit.gpgsign', 'false');
}
await writeFile(join(writer, 'notes.txt'), 'Original notes\n');
git(writer, 'add', '.');
git(writer, 'commit', '-m', 'Initial notes');
git(writer, 'push', '-u', 'origin', 'main');
git(root, 'clone', remote, fixture);
git(root, 'clone', remote, other);
const otherHead = git(other, 'rev-parse', 'HEAD');
git(fixture, 'config', 'user.name', 'Git Gud Validation');
git(fixture, 'config', 'user.email', 'validation@example.invalid');
git(fixture, 'config', 'commit.gpgsign', 'false');
await writeFile(join(writer, 'notes.txt'), 'Upstream notes\n');
git(writer, 'commit', '-am', 'Update notes upstream');
git(writer, 'push', 'origin', 'main');
await writeFile(join(fixture, 'notes.txt'), 'Staged notes\n');
git(fixture, 'add', 'notes.txt');
await writeFile(join(fixture, 'notes.txt'), 'Unstaged notes\n');
await writeFile(join(fixture, 'draft.txt'), 'Untracked draft\n');
await writeFile(join(userData, 'git-gud-workspace.json'), JSON.stringify({ settings: { autoFetchIntervalMinutes: 0, remoteAvatars: false, defaultSyncOperation: 'pull-ff-only' } }));

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
const session = `git-gud-pull-recovery-${process.pid}`;
let appConnected = false;
const report = { url: `file://${project}/out/renderer/index.html`, root, cdpPort, session, checks: [], screenshots: [], commands: [] };
const agent = async (...args) => {
  report.commands.push(['agent-browser', '--session', session, ...args]);
  return (await exec('agent-browser', ['--session', session, ...args], { cwd: project, timeout: 35_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
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
try {
  await waitFor(async () => { if (launchError) throw launchError; try { return (await control()).ready; } catch { return false; } });
  await agent('connect', String(cdpPort));
  appConnected = true;
  await waitFor(() => evaluate('Boolean(window.api)'));
  await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(other)}).then(() => true)`);
  await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(fixture)}).then(() => true)`);
  await evaluate('location.reload(); true');
  await waitFor(() => textIncludes('blocked-pull-demo'));
  report.initialSnapshot = await agent('snapshot', '-i');
  await writeFile(join(artifacts, 'initial-snapshot.txt'), report.initialSnapshot);
  await screenshot('initial');
  await button('Pull');
  await waitFor(() => textIncludes('Stash and retry pull'));
  await delay(5500);
  assert.ok(await textIncludes('Stash and retry pull'), 'Recovery disappeared after five seconds');
  assert.equal(await readFile(join(fixture, 'notes.txt'), 'utf8'), 'Unstaged notes\n');
  await screenshot('blocked-pull-options');
  await agent('find', 'text', 'Error details', 'click', '--exact');
  assert.ok(await textIncludes('notes.txt'));
  await screenshot('blocked-pull-details');
  await agent('find', 'text', 'Error details', 'click', '--exact');
  await agent('find', 'role', 'tab', 'click', '--name', 'another-repo', '--exact');
  await button('Reset local main to origin/main');
  await waitFor(() => textIncludes('Reset main to origin/main?'));
  await screenshot('blocked-pull-reset-confirmation');
  await button('Cancel');
  await button('Review changes');
  await waitFor(() => textIncludes('Unstaged files'));
  assert.ok(await evaluate(`document.querySelector('[role="tab"][aria-selected="true"]').textContent.includes('blocked-pull-demo')`));
  await screenshot('review-local-changes');
  report.checks.push({ name: 'Blocked pull persists with review, stash, reset and complete Git details', pass: true });

  await button('Stash and retry pull');
  await waitFor(() => textIncludes('Stash changes and pull main?'));
  await screenshot('stash-pull-confirmation');
  await button('Cancel');
  assert.equal(git(fixture, 'stash', 'list'), '');
  assert.equal(await readFile(join(fixture, 'notes.txt'), 'utf8'), 'Unstaged notes\n');
  report.checks.push({ name: 'Cancel leaves index, working tree and untracked changes intact', pass: true });
  await agent('find', 'role', 'tab', 'click', '--name', 'another-repo', '--exact');
  await button('Stash and retry pull');
  await button('Stash and Pull');
  await waitFor(() => textIncludes('saved in Stashes'));
  assert.equal(git(fixture, 'rev-parse', 'HEAD'), git(writer, 'rev-parse', 'HEAD'));
  assert.equal(git(fixture, 'status', '--porcelain'), '');
  assert.equal(git(fixture, 'show', 'stash@{0}:notes.txt'), 'Unstaged notes');
  assert.equal(git(fixture, 'show', 'stash@{0}^2:notes.txt'), 'Staged notes');
  assert.equal(git(fixture, 'show', 'stash@{0}^3:draft.txt'), 'Untracked draft');
  assert.equal(git(other, 'rev-parse', 'HEAD'), otherHead);
  assert.equal(git(other, 'status', '--porcelain'), '');
  await agent('find', 'role', 'tab', 'click', '--name', 'blocked-pull-demo');
  await screenshot('pull-recovered-stash-saved');
  report.checks.push({ name: 'Recovery from another tab updates the captured main and preserves staged, unstaged and untracked work', pass: true });

  // A local-only commit plus fresh edits exercises reset without touching any real repository.
  await writeFile(join(fixture, 'local-only.txt'), 'Local-only commit\n');
  git(fixture, 'add', 'local-only.txt');
  git(fixture, 'commit', '-m', 'Local-only experiment');
  const localHead = git(fixture, 'rev-parse', 'HEAD');
  await writeFile(join(fixture, 'notes.txt'), 'Changes before reset\n');
  await writeFile(join(fixture, 'second-draft.txt'), 'Second untracked draft\n');
  await evaluate('location.reload(); true');
  await waitFor(() => evaluate(`Boolean(document.querySelector('button[aria-label^="main, current branch"]'))`));
  await evaluate(`document.querySelector('button[aria-label^="main, current branch"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:480, clientY:300})); true`);
  report.branchMenuSnapshot = await agent('snapshot', '-i');
  await screenshot('local-main-menu');
  await agent('find', 'role', 'menuitem', 'click', '--name', 'Reset local main to origin/main…', '--exact');
  await waitFor(() => textIncludes('Reset main to origin/main?'));
  await screenshot('reset-main-confirmation');
  await button('Cancel');
  assert.equal(git(fixture, 'rev-parse', 'HEAD'), localHead);
  assert.equal(await readFile(join(fixture, 'notes.txt'), 'utf8'), 'Changes before reset\n');
  report.checks.push({ name: 'Local branch menu exposes reset to its actual upstream and cancel preserves work', pass: true });
  await evaluate(`document.querySelector('button[aria-label^="main, current branch"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:480, clientY:300})); true`);
  await agent('find', 'role', 'menuitem', 'click', '--name', 'Reset local main to origin/main…', '--exact');
  await button('Stash and Reset');
  await waitFor(() => textIncludes('saved in Stashes'));
  assert.equal(git(fixture, 'rev-parse', 'HEAD'), git(writer, 'rev-parse', 'HEAD'));
  assert.equal(git(fixture, 'status', '--porcelain'), '');
  assert.equal(git(fixture, 'show', 'stash@{0}:notes.txt'), 'Changes before reset');
  assert.equal(git(fixture, 'show', 'stash@{0}^3:second-draft.txt'), 'Second untracked draft');
  assert.equal(git(fixture, 'cat-file', '-t', localHead), 'commit');
  await screenshot('reset-main-completed');
  report.checks.push({ name: 'Reset moves local main to origin/main, saves edits in Stashes and retains the old commit', pass: true });
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
  if (!process.env.GIT_GUD_KEEP_PULL_RECOVERY_APP) {
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
