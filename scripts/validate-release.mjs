import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// Real Electron renderer, preload, IPC and Git. Every repository and remote is
// disposable; this never publishes a tag to a network remote or uses saved settings.
const exec = promisify(execFile);
const project = resolve(import.meta.dirname, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-release-e2e-')));
const artifacts = join(project, 'artifacts', 'release-one-click');
await mkdir(artifacts, { recursive: true });
const fixture = join(root, 'release-demo');
const remote = join(root, 'origin.git');
const emptyRemote = join(root, 'empty-origin.git');
const noOrigin = join(root, 'no-origin');
const noTags = join(root, 'no-tags');
const userData = join(root, 'user-data');
await mkdir(fixture);
await mkdir(noOrigin);
await mkdir(userData);
await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}).trim();
function configure(cwd) {
  git(cwd, 'config', 'user.name', 'Git Gud Validation');
  git(cwd, 'config', 'user.email', 'validation@example.invalid');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}
git(fixture, 'init', '-b', 'main');
configure(fixture);
await writeFile(join(fixture, 'README.md'), '# Release validation\n');
git(fixture, 'add', '.');
git(fixture, 'commit', '-m', 'Initial release');
git(fixture, 'tag', 'v1.0.0');
git(fixture, 'tag', 'v1.0.1');
git(root, 'clone', '--bare', fixture, remote);
git(fixture, 'remote', 'add', 'origin', remote);
git(fixture, 'fetch', 'origin');
git(fixture, 'checkout', '-b', 'feature/local-work');
await writeFile(join(fixture, 'README.md'), 'Local staged draft\n');
git(fixture, 'add', 'README.md');
await writeFile(join(fixture, 'README.md'), 'Local unstaged draft\n');
await writeFile(join(fixture, 'untracked.txt'), 'Keep these local notes\n');
const originalHead = git(fixture, 'rev-parse', 'HEAD');
const originalStatus = git(fixture, 'status', '--porcelain=v1', '--branch');
const originalIndex = git(fixture, 'diff', '--cached');
git(noOrigin, 'init', '-b', 'main');
configure(noOrigin);
await writeFile(join(noOrigin, 'README.md'), '# No origin remote\n');
git(noOrigin, 'add', '.');
git(noOrigin, 'commit', '-m', 'Initial commit');
git(root, 'clone', '--bare', noOrigin, join(root, 'no-tags-origin.git'));
git(root, 'clone', join(root, 'no-tags-origin.git'), noTags);
git(root, 'init', '--bare', emptyRemote);
await writeFile(join(userData, 'git-gud-workspace.json'), JSON.stringify({
  settings: { autoFetchIntervalMinutes: 0, remoteAvatars: false }
}));

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
  if (request.url === '/quit') window?.close();
  if (request.url === '/narrow') window?.setSize(960, 720);
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
const session = `git-gud-release-${process.pid}`;
const report = { url: `file://${project}/out/renderer/index.html`, root, cdpPort, session, checks: [], screenshots: [], commands: [] };
let connected = false;
const agent = async (...args) => {
  const binary = process.env.GIT_GUD_AGENT_BROWSER || 'agent-browser';
  report.commands.push([binary, '--session', session, ...args]);
  return (await exec(binary, ['--session', session, ...args], { cwd: project, timeout: 35_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
};
const evaluate = async (expression) => JSON.parse(await agent('eval', expression));
const control = async (path = '/') => (await globalThis.fetch(`http://127.0.0.1:${controlPort}${path}`)).json();
async function waitFor(predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error('Application validation condition timed out.');
}
const bodyIncludes = (text) => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const button = (name) => agent('find', 'role', 'button', 'click', '--name', name, '--exact');
async function screenshot(name) {
  const path = join(artifacts, `${name}.png`);
  await agent('screenshot', path);
  report.screenshots.push(path);
}
function pass(name) {
  report.checks.push({ name, pass: true });
  process.stdout.write(`PASS: ${name}\n`);
}
async function openRepository(path) {
  await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(path)}).then(() => true)`);
  await evaluate('location.reload(); true');
  await waitFor(() => bodyIncludes(basename(path)));
  await waitFor(() => evaluate(`Boolean(document.querySelector('[role="listbox"] [role="option"]'))`));
}
const releaseButton = '.app-toolbar button[aria-label="Release"]';
const releaseState = () => evaluate(`(() => {
  const button = document.querySelector(${JSON.stringify(releaseButton)});
  return button ? { disabled: button.disabled, title: button.title } : null;
})()`);
try {
  await waitFor(async () => {
    if (launchError) throw launchError;
    try { return (await control()).ready; } catch { return false; }
  });
  await agent('connect', String(cdpPort));
  connected = true;
  await waitFor(() => evaluate('Boolean(window.api)'));
  await openRepository(fixture);
  await waitFor(async () => (await releaseState())?.disabled === false);
  assert.ok((await releaseState()).title.includes('v1.0.2'));
  await screenshot('release-toolbar');
  await button('Actions');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].some((item) => /release/i.test(item.textContent))`), false);
  await agent('press', 'Escape');
  assert.equal(git(remote, 'tag', '--list', 'v1.0.2'), '');
  pass('Release is a standalone toolbar button with the automatic next tag in its tooltip, absent from Actions');

  // Publish after opening the app. Its cached origin/main and local HEAD are stale.
  const publisher = join(root, 'publisher');
  git(root, 'clone', remote, publisher);
  configure(publisher);
  await writeFile(join(publisher, 'release.txt'), 'Fresh remote main\n');
  git(publisher, 'add', '.');
  git(publisher, 'commit', '-m', 'New main commit for release');
  git(publisher, 'push', 'origin', 'main');
  const remoteHead = git(publisher, 'rev-parse', 'HEAD');
  assert.notEqual(remoteHead, originalHead);
  assert.equal(git(fixture, 'rev-parse', 'origin/main'), originalHead);
  await button('Release');
  assert.equal(await evaluate(`Boolean(document.querySelector('[role="dialog"]'))`), false);
  await waitFor(() => bodyIncludes('Create release v1.0.2 from origin/main and push to origin'));
  assert.equal(git(remote, 'cat-file', '-t', 'refs/tags/v1.0.2'), 'tag');
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v1.0.2^{}'), remoteHead);
  assert.equal(git(fixture, 'rev-parse', 'HEAD'), originalHead);
  assert.equal(git(fixture, 'status', '--porcelain=v1', '--branch'), originalStatus);
  assert.equal(git(fixture, 'diff', '--cached'), originalIndex);
  await waitFor(async () => {
    const state = await releaseState();
    return !state.disabled && state.title.includes('v1.0.3');
  });
  // Expand the real sidebar so the published release tag is visible in evidence.
  await agent('click', '[data-sidebar-section="tags"] .side-section');
  await waitFor(() => bodyIncludes('v1.0.2'));
  await screenshot('release-created');
  pass('One click publishes an annotated tag at fresh origin/main without any dialog, preserving the dirty feature checkout and index');

  await button('Release');
  await waitFor(() => bodyIncludes('Create release v1.0.3 from origin/main and push to origin'));
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v1.0.3^{}'), remoteHead);
  await waitFor(async () => {
    const state = await releaseState();
    return !state.disabled && state.title.includes('v1.0.4');
  });
  pass('A subsequent click automatically advances to the next tag name');

  git(fixture, 'remote', 'set-url', 'origin', emptyRemote);
  await button('Release');
  await waitFor(() => bodyIncludes("couldn't find remote ref refs/heads/main"));
  assert.equal(git(fixture, 'tag', '--list', 'v1.0.4'), '');
  assert.equal(git(emptyRemote, 'tag', '--list'), '');
  await screenshot('missing-main-error');
  pass('Missing remote main reports fetch failure and never tags stale origin/main');

  await openRepository(noOrigin);
  await waitFor(async () => (await releaseState())?.title.toLowerCase().includes('origin'));
  assert.equal((await releaseState()).disabled, true);
  await screenshot('no-origin-disabled');
  pass('Release action is disabled when there is no origin remote');

  await openRepository(noTags);
  await waitFor(async () => {
    const state = await releaseState();
    return state?.disabled && /tag/i.test(state.title) && !/loading/i.test(state.title);
  });
  await screenshot('no-tag-suggestion-disabled');
  assert.equal(git(noTags, 'tag', '--list'), '');
  pass('Release action is disabled when the existing naming helper cannot determine the next tag');

  await openRepository(fixture);
  await control('/narrow');
  const layout = await evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(releaseButton)}).getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, viewportWidth: innerWidth };
  })()`);
  assert.ok(layout.width > 0 && layout.left >= 0 && layout.right <= layout.viewportWidth);
  await screenshot('release-toolbar-narrow');
  pass('Release toolbar button remains visible at 960 by 720');
  report.console = await agent('console');
  report.errors = await agent('errors');
  report.network = await agent('network', 'requests');
  report.nativeConsole = (await control()).messages;
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = error.stack ?? String(error);
  if (connected) {
    try {
      report.failureSnapshot = await agent('snapshot', '-i');
      await screenshot('failure');
      report.console = await agent('console');
      report.errors = await agent('errors');
    } catch { /* Keep the original failure. */ }
  }
  process.exitCode = 1;
} finally {
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, 'electron.log'), applicationLog);
  try { await control('/quit'); } catch { /* App may have exited. */ }
  if (connected) {
    try { await agent('close'); } catch { /* Close only our own CDP session. */ }
  }
  application.kill();
  process.stdout.write(`Report: ${join(artifacts, 'report.json')}\n`);
  if (report.error) process.stderr.write(`${report.error}\n`);
}
