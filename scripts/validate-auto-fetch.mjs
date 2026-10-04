import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// Exercises the built Electron app with real local Git remotes and agent-browser.
// All mutations and application settings live in a temporary validation workspace.
const exec = promisify(execFile);
const project = resolve(import.meta.dirname, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-autofetch-')));
const artifacts = resolve(project, 'artifacts', 'auto-fetch');
await mkdir(artifacts, { recursive: true });
const report = { url: `file://${project}/out/renderer/index.html`, checks: [], screenshots: [], root };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const session = `git-gud-autofetch-${process.pid}`;
const agent = async (...args) => (await exec('pnpm', ['dlx', 'agent-browser', '--session', session, ...args], {
  cwd: project, timeout: 35_000, maxBuffer: 1024 * 1024
})).stdout.trim();
const evaluate = async (expression) => JSON.parse(await agent('eval', expression));

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const port = server.address().port;
  await new Promise((resolveClosed) => server.close(resolveClosed));
  return port;
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(`Validation condition did not pass within ${timeoutMs}ms.`);
}

async function screenshot(name) {
  const path = join(artifacts, `${name}.png`);
  await agent('screenshot', path);
  report.screenshots.push(path);
}

async function openRepository(path) {
  await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(path)}).then(() => true)`);
  await evaluate('location.reload(); true');
  await waitFor(() => evaluate(`Boolean(window.api && document.body.innerText.includes(${JSON.stringify(basename(path))}) && document.querySelector('[role="listbox"] [role="option"]'))`));
}

async function subscribe() {
  await evaluate(`(() => {
    window.__autoFetchEvents = [];
    window.api.onOperationProgress((event) => window.__autoFetchEvents.push(event));
    return true;
  })()`);
}

async function assertQuietBackgroundStatus(expectedStatus) {
  const state = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('div')].find((element) =>
      ['fixed', 'bottom-8', 'left-4'].every((name) => element.classList.contains(name)));
    const status = document.querySelector('footer [data-background-operation-status]');
    return { status: status?.getAttribute('data-background-operation-status'),
      footer: status?.innerText ?? '', cards: cards?.innerText ?? '' };
  })()`);
  assert.equal(state.status, expectedStatus, `Missing footer status ${expectedStatus}: ${state.footer}`);
  assert.ok(state.footer.includes('Auto-fetch'), `Missing automatic action label: ${state.footer}`);
  assert.ok(!state.cards.includes('Auto-fetch'), `Automatic action rendered a notification card: ${state.cards}`);
  return state;
}

async function setIntervalMinutes(value) {
  await agent('find', 'role', 'button', 'click', '--name', 'Settings', '--exact');
  await agent('fill', 'input[type="number"][max="60"]', String(value));
  await agent('find', 'role', 'button', 'click', '--name', 'Save Settings', '--exact');
}

const fixture = join(root, 'slow-fetch-repo');
const offline = join(root, 'offline-repo');
const updated = join(root, 'updated-refs-repo');
const userData = join(root, 'user-data');
await mkdir(userData);
await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
await writeFile(join(userData, 'git-gud-workspace.json'), JSON.stringify({ settings: { autoFetchIntervalMinutes: 0, remoteAvatars: false } }));
for (const directory of [fixture, offline]) {
  await mkdir(directory);
  git(directory, 'init', '-b', 'main');
  git(directory, 'config', 'user.name', 'Git Gud Validation');
  git(directory, 'config', 'user.email', 'validation@example.invalid');
  git(directory, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(directory, 'README.md'), '# Background fetch validation\n');
  git(directory, 'add', '.');
  git(directory, 'commit', '-m', 'Initial validation fixture');
  await writeFile(join(directory, 'README.md'), '# Background fetch validation\n\nWorking files remain editable during a slow fetch.\n');
}
const remote = join(root, 'remote.git');
git(root, 'clone', '--bare', fixture, remote);
git(fixture, 'remote', 'add', 'origin', remote);
git(fixture, 'fetch', 'origin');
git(fixture, 'branch', '--set-upstream-to', 'origin/main', 'main');
git(root, 'clone', remote, updated);
git(offline, 'remote', 'add', 'origin', join(root, 'unreachable.git'));
const uploadPack = join(root, 'upload-pack');
const fetchMarker = join(root, 'fetch-started');
const uploadScript = (slow) => `#!/bin/sh\nprintf started > '${fetchMarker}'\n${slow ? 'sleep 20\n' : ''}exec git upload-pack "$@"\n`;
await writeFile(uploadPack, uploadScript(true), { mode: 0o755 });
git(fixture, 'config', 'remote.origin.uploadpack', uploadPack);

const cdpPort = await freePort();
const controlPort = await freePort();
const launch = join(root, 'launch.cjs');
// Native window controls and IPC counts observe the real app without replacing
// its renderer, preload API, Git commands, or repository data.
await writeFile(launch, `
const { app, ipcMain } = require('electron');
const http = require('node:http');
app.setPath('userData', ${JSON.stringify(userData)});
let window;
const counts = {};
const progress = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => handle(channel, (event, ...args) => {
  counts[channel] = (counts[channel] || 0) + 1;
  return callback(event, ...args);
});
app.on('browser-window-created', (_event, created) => {
  window = created;
  const send = created.webContents.send.bind(created.webContents);
  created.webContents.send = (channel, ...args) => {
    if (channel === 'repo:operation-progress') progress.push(args[0]);
    return send(channel, ...args);
  };
});
http.createServer((request, response) => {
  if (request.url === '/minimize') window?.minimize();
  if (request.url === '/restore') { window?.restore(); window?.show(); }
  if (request.url === '/quit') window?.close();
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ready: Boolean(window), minimized: window?.isMinimized(), counts, progress}));
}).listen(${controlPort}, '127.0.0.1');
require(${JSON.stringify(join(project, 'out/main/index.js'))});
`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const application = spawn(join(project, 'node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'),
  [launch, `--remote-debugging-port=${cdpPort}`], { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
let applicationLog = '';
application.stdout.on('data', (chunk) => { applicationLog += chunk; });
application.stderr.on('data', (chunk) => { applicationLog += chunk; });
const control = async (path = '/metrics') => (await globalThis.fetch(`http://127.0.0.1:${controlPort}${path}`)).json();

try {
  await waitFor(async () => { try { return (await control()).ready; } catch { return false; } });
  await agent('connect', String(cdpPort));
  await waitFor(() => evaluate('Boolean(window.api)'));
  const realRepository = process.env.GIT_GUD_PERF_REPO;
  if (realRepository) {
    await openRepository(realRepository);
    await screenshot('monorepo-history');
    await evaluate(`window.api.getWorkspace().then(async (workspace) => {
      for (const tab of workspace.tabs) await window.api.closeTab(tab.id);
      return true;
    })`);
    report.checks.push({ name: 'Real monorepo history', pass: true, repository: realRepository });
  }
  await openRepository(fixture);
  await subscribe();
  report.initialSnapshot = await agent('snapshot', '-i');
  await setIntervalMinutes(1);
  await waitFor(async () => { try { await readFile(fetchMarker); return true; } catch { return false; } });
  const readMs = await evaluate(`(async () => {
    const start = performance.now();
    await window.api.getRepositoryOverview(${JSON.stringify(fixture)});
    return Math.round(performance.now() - start);
  })()`);
  assert.ok(readMs < 2000, `Repository reads blocked for ${readMs}ms.`);
  await assertQuietBackgroundStatus('pending');
  await screenshot('slow-fetch-responsive');
  const stageMs = await evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') || item.title) === 'Stage File README.md');
    if (!button || button.disabled) throw new Error('Stage button unavailable during auto-fetch.');
    const start = performance.now();
    button.click();
    while (!document.body.innerText.includes('Staged Files (1)')) {
      if (performance.now() - start > 2000) throw new Error('Staging waited for the slow fetch.');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    return Math.round(performance.now() - start);
  })()`);
  const progress = (await control()).progress;
  assert.ok(progress.some((event) => event.background && event.phase === 'cancelled'));
  assert.equal(git(fixture, 'diff', '--cached', '--name-only').trim(), 'README.md');
  await screenshot('fetch-yields-to-staging');
  report.checks.push({ name: '20-second remote: reads and UI staging stay responsive', pass: true, readMs, stageMs });
  process.stdout.write(`PASS: slow fetch reads ${readMs}ms, staging ${stageMs}ms; testing minimized scheduling…\n`);
  await writeFile(uploadPack, uploadScript(false));
  await delay(1200);
  await control('/minimize');
  await waitFor(async () => (await control()).minimized);
  const before = await control();
  await waitFor(async () => (await control()).progress.some((event) => event.background && event.phase === 'completed'), 90_000);
  const after = await control();
  assert.equal(after.counts['repo:graph'], before.counts['repo:graph'], 'Unchanged fetch rebuilt history.');
  assert.equal(after.counts['repo:overview'], before.counts['repo:overview'], 'Unchanged fetch rescanned the worktree.');
  await control('/restore');
  await assertQuietBackgroundStatus('success');
  await screenshot('background-fetch-success');
  report.checks.push({ name: 'Minimized background fetch without history or status reload', pass: true, before: before.counts, after: after.counts });
  await setIntervalMinutes(0);

  await openRepository(updated);
  await subscribe();
  const publisher = join(root, 'publisher');
  git(root, 'clone', remote, publisher);
  git(publisher, 'config', 'user.name', 'Git Gud Validation');
  git(publisher, 'config', 'user.email', 'validation@example.invalid');
  git(publisher, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(publisher, 'remote-update.txt'), 'Fetched without changing local working files.\n');
  git(publisher, 'add', '.');
  git(publisher, 'commit', '-m', 'Remote update fetched in background');
  git(publisher, 'push', 'origin', 'main');
  const remoteHead = git(publisher, 'rev-parse', 'HEAD').trim();
  await setIntervalMinutes(1);
  await waitFor(() => evaluate('document.body.innerText.includes("Remote update fetched in background")'));
  assert.equal(git(updated, 'rev-parse', 'origin/main').trim(), remoteHead);
  assert.equal(git(updated, 'status', '--porcelain').trim(), '');
  await assertQuietBackgroundStatus('success');
  await screenshot('background-ref-update');
  report.checks.push({ name: 'Changed remote refs appear in history without touching working files', pass: true });
  await setIntervalMinutes(0);

  await openRepository(offline);
  await evaluate(`window.api.getWorkspace().then(async (workspace) => {
    for (const tab of workspace.tabs) if (tab.path !== ${JSON.stringify(offline)}) await window.api.closeTab(tab.id);
    return true;
  })`);
  await openRepository(offline);
  await subscribe();
  await setIntervalMinutes(1);
  await waitFor(() => evaluate('window.__autoFetchEvents.some((event) => event.background && event.phase === "failed")'));
  await assertQuietBackgroundStatus('error');
  await screenshot('offline-fetch-error');
  const failureCount = (await control()).progress.filter((event) => event.repoPath === offline && event.phase === 'failed').length;
  await delay(1200);
  assert.equal((await control()).progress.filter((event) => event.repoPath === offline && event.phase === 'failed').length, failureCount);
  const offlineStatus = await evaluate(`window.api.getRepositoryOverview(${JSON.stringify(offline)}).then((overview) => overview.status.dirtyCount)`);
  assert.equal(offlineStatus, 1);
  report.checks.push({ name: 'Unreachable remote keeps local work accessible and does not retry immediately', pass: true });
  await setIntervalMinutes(0);
  await agent('press', 'Meta+Shift+f');
  await waitFor(() => evaluate('Boolean(document.querySelector(\'button[aria-label="Dismiss Fetch"]\'))'));
  await screenshot('manual-fetch-error-card');
  report.checks.push({ name: 'Automatic progress, success, and failure stay in footer; manual fetch still gets a card', pass: true });
  report.console = await agent('console');
  report.networkErrors = await agent('network', 'requests', '--status', '400-599');
  const errors = JSON.parse(await agent('--json', 'errors'));
  report.pageErrors = errors.data?.errors ?? [];
  assert.ok(errors.success && report.pageErrors.length === 0, `Unexpected page errors: ${JSON.stringify(errors)}`);
  report.pass = true;
  process.stdout.write(`${JSON.stringify(report.checks, null, 2)}\nScreenshots: ${artifacts}\n`);
} catch (error) {
  report.pass = false;
  report.error = error.stack;
  await screenshot('validation-failure').catch(() => {});
  throw error;
} finally {
  await writeFile(join(artifacts, 'validation.json'), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, 'electron.log'), applicationLog);
  await control('/quit').catch(() => {});
  await delay(1700);
  if (application.exitCode === null) application.kill('SIGTERM');
}
