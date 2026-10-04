import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile, execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { cp, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// Runs the actual built Electron app, with real repositories and isolated settings.
// Controlled IPC delays/failures exercise pending avatars and pagination recovery.
const project = resolve(import.meta.dirname, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-history-')));
const artifacts = join(project, 'artifacts', 'history-loading');
await mkdir(artifacts, { recursive: true });
const exec = promisify(execFile);
const session = `git-gud-history-${process.pid}`;
const agent = async (...args) => (await exec('pnpm', ['dlx', 'agent-browser', '--session', session, ...args], {
  cwd: project, timeout: 35_000, maxBuffer: 1024 * 1024
})).stdout.trim();
const evaluate = async (expression) => JSON.parse(await agent('eval', expression));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const report = { url: `file://${project}/out/renderer/index.html`, root, checks: [], screenshots: [] };

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`History validation timed out after ${timeoutMs}ms.`);
}

async function screenshot(name) {
  const path = join(artifacts, `${name}.png`);
  await agent('screenshot', path);
  report.screenshots.push(path);
}

async function seedHistory(name, count) {
  const repo = join(root, name);
  await mkdir(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'History Validation');
  git(repo, 'config', 'user.email', 'history@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  if (count) {
    const chunks = ['blob\nmark :1\ndata 5\nbase\n'];
    for (let index = 1; index <= count; index++) {
      const message = `${name} commit ${index}\n`;
      chunks.push(`commit refs/heads/main\nmark :${index + 1}\ncommitter History Validation <history@example.invalid> ${1760000000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}${index > 1 ? `from :${index}\n` : ''}${index === 1 ? 'M 100644 :1 README.md\n' : ''}\n`);
    }
    chunks.push('done\n');
    execFileSync('git', ['-C', repo, 'fast-import', '--quiet'], { input: chunks.join('') });
    git(repo, 'reset', '--hard', 'main');
  }
  return repo;
}

const alpha = await seedHistory('alpha-history', 2000);
const beta = await seedHistory('beta-history', 120);
const empty = await seedHistory('empty-history', 0);
const userData = join(root, 'user-data');
await mkdir(userData);
await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
await writeFile(join(userData, 'git-gud-workspace.json'), JSON.stringify({
  settings: { autoFetchIntervalMinutes: 0, remoteAvatars: true, graphPageSize: 250 }
}));
const cdpPort = await freePort();
const controlPort = await freePort();
const launch = join(root, 'launch.cjs');
await writeFile(launch, `
const { app, ipcMain } = require('electron');
const http = require('node:http');
app.setPath('userData', ${JSON.stringify(userData)});
let window;
let failPagination = false;
let avatarDelay = 3000;
let pendingAvatars = 0;
const reads = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => handle(channel, async (event, ...args) => {
  const entry = { channel, repoPath: args[0], limit: args[1], startedAt: Date.now() };
  if (channel === 'repo:graph') reads.push(entry);
  if (channel === 'repo:graph-avatars') {
    pendingAvatars++;
    try {
      await new Promise((done) => setTimeout(done, avatarDelay));
      return await callback(event, ...args);
    } finally { pendingAvatars--; }
  }
  if (channel === 'repo:graph' && args[1] > 50 && failPagination) {
    entry.failed = true;
    throw new Error('History validation: older commits are temporarily unavailable.');
  }
  const result = await callback(event, ...args);
  if (channel === 'repo:graph') {
    entry.durationMs = Date.now() - entry.startedAt;
    entry.count = result.loadedCommitCount;
  }
  return result;
});
app.on('browser-window-created', (_event, created) => { window = created; });
http.createServer((request, response) => {
  if (request.url === '/fail-pagination') failPagination = true;
  if (request.url === '/resume-pagination') failPagination = false;
  if (request.url === '/fast-avatars') avatarDelay = 0;
  if (request.url === '/quit') window?.close();
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ ready: Boolean(window), reads, pendingAvatars }));
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
const control = async (path = '/metrics') => (await globalThis.fetch(`http://127.0.0.1:${controlPort}${path}`)).json();
const historyText = () => evaluate('document.querySelector(\'[aria-label="Commit history"]\')?.innerText ?? ""');

async function activate(name) {
  await agent('snapshot', '-i');
  await agent('find', 'role', 'tab', 'click', '--name', name, '--exact');
}

try {
  await waitFor(async () => {
    if (launchError) throw launchError;
    try { return (await control()).ready; } catch { return false; }
  });
  await agent('connect', String(cdpPort));
  await waitFor(() => evaluate('Boolean(window.api)'));
  for (const path of [alpha, beta, empty]) {
    await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(path)}).then(() => true)`);
  }
  await evaluate('location.reload(); true');
  await waitFor(() => evaluate('document.body.innerText.includes("No commits found.")'));
  await screenshot('empty-repository');
  report.checks.push({ name: 'Empty repository', pass: true });

  await activate('alpha-history');
  await waitFor(async () => (await historyText()).includes('alpha-history commit 2000'));
  const cold = await control();
  const first = cold.reads.find((read) => read.repoPath === alpha && read.count !== undefined);
  assert.equal(first?.limit, 50, 'Cold history loaded a large first page.');
  assert.equal(first?.count, 50);
  assert.ok(!cold.reads.some((read) => read.repoPath === alpha && read.limit > 50), 'History fetched older pages before the user scrolled.');
  assert.ok(cold.pendingAvatars > 0, 'Slow avatars finished before history could render.');
  await screenshot('first-50-commits');
  report.checks.push({ name: '50 commits visible while avatar request is pending', pass: true, historyMs: first.durationMs, avatarDelayMs: 3000 });
  await control('/fast-avatars');

  await control('/fail-pagination');
  await evaluate('(() => { const list = document.querySelector(\'[aria-label="Commit history"]\'); list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event("scroll", { bubbles: true })); return true; })()');
  await waitFor(() => evaluate('document.body.innerText.includes("Couldn’t load older commits")'), 20_000);
  assert.ok((await historyText()).includes('alpha-history commit'), 'Pagination failure discarded visible commits.');
  await screenshot('pagination-error');
  const failedCount = (await control()).reads.filter((read) => read.failed).length;
  await delay(1200);
  assert.equal((await control()).reads.filter((read) => read.failed).length, failedCount, 'Pagination continuously retried after failure.');
  report.checks.push({ name: 'Pagination error keeps rows and stops automatic retries', pass: true, attempts: failedCount });
  await control('/resume-pagination');
  await agent('snapshot', '-i');
  await agent('find', 'role', 'button', 'click', '--name', 'Retry', '--exact');
  await waitFor(async () => (await control()).reads.some((read) => read.repoPath === alpha && read.count === 250));
  await screenshot('older-commits-loaded');
  report.checks.push({ name: 'Manual retry extends history to configured 250-commit page', pass: true });

  await agent('snapshot', '-i');
  await agent('find', 'role', 'button', 'click', '--name', 'Settings', '--exact');
  await waitFor(() => evaluate('document.body.innerText.includes("History page size")'));
  await screenshot('history-page-settings');
  await agent('snapshot', '-i');
  await agent('find', 'role', 'button', 'click', '--name', 'Save Settings', '--exact');
  await waitFor(() => evaluate('!document.querySelector(\'[aria-label="Close settings"]\') && document.body.innerText.includes("250 rows loaded")'));
  report.checks.push({ name: 'Settings limit reset preserves larger cached history', pass: true });

  await activate('beta-history');
  await waitFor(async () => (await historyText()).includes('beta-history commit 120'));
  assert.ok(!(await historyText()).includes('alpha-history'), 'Another repository history leaked into the active graph.');
  // Measure the UI transition inside the renderer, excluding CLI startup overhead.
  await evaluate(`(() => {
    const result = window.__historyTransition = { startedAt: performance.now(), loadingSeen: false, elapsedMs: null };
    const list = document.querySelector('[aria-label="Commit history"]');
    const observer = new MutationObserver(() => {
      const text = list?.innerText ?? '';
      result.loadingSeen ||= text.includes('Loading commit history');
      if (text.includes('alpha-history commit') && result.elapsedMs === null) {
        result.elapsedMs = performance.now() - result.startedAt;
        observer.disconnect();
      }
    });
    observer.observe(list, { subtree: true, childList: true, characterData: true });
    const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === 'alpha-history');
    tab.click();
    return true;
  })()`);
  await waitFor(async () => (await evaluate('window.__historyTransition')).elapsedMs !== null);
  const transition = await evaluate('window.__historyTransition');
  assert.equal(transition.loadingSeen, false, 'Cached return switch displayed the loading screen.');
  await screenshot('cached-repository-switch');
  report.checks.push({ name: 'Cached repository switch without loading screen or wrong rows', pass: true, transition });

  for (const count of [50, 1500]) {
    const samples = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      samples.push(await evaluate(`(async () => { const start = performance.now(); const page = await window.api.getCommitGraph(${JSON.stringify(alpha)}, ${count}); return { ms: performance.now() - start, count: page.loadedCommitCount }; })()`));
    }
    report.checks.push({ name: `Local graph IPC benchmark (${count} commits)`, pass: true, samples });
  }
  report.console = await agent('console');
  report.errors = await agent('errors');
  report.network = await agent('network', 'requests');
  report.metrics = await control();
  report.pass = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.pass = false;
  report.error = error.stack;
  try { report.snapshot = await agent('snapshot', '-i'); await screenshot('failure'); } catch { /* App may have failed to start. */ }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, 'application.log'), applicationLog);
  try { await control('/quit'); } catch { /* Already closed. */ }
  await delay(500);
  if (application.exitCode === null) application.kill('SIGTERM');
  try { await agent('close'); } catch { /* Session already closed. */ }
}
