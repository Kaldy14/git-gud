import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile, execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { cp, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// Exercise the built Electron application with real Git data and isolated settings.
const project = resolve(import.meta.dirname, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-performance-e2e-')));
const artifacts = join(project, 'artifacts', 'repository-performance');
await mkdir(artifacts, { recursive: true });
const exec = promisify(execFile);
const session = `git-gud-performance-${process.pid}`;
const agent = async (...args) => (await exec('pnpm', ['dlx', 'agent-browser', '--session', session, ...args], {
  cwd: project, timeout: 35_000, maxBuffer: 4 * 1024 * 1024
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

async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Repository validation timed out after ${timeoutMs}ms.`);
}

async function screenshot(name) {
  const path = join(artifacts, `${name}.png`);
  await agent('screenshot', path);
  report.screenshots.push(path);
}

const repoPath = join(root, 'large-repository');
await mkdir(repoPath);
git(repoPath, 'init', '-b', 'main');
git(repoPath, 'config', 'user.name', 'Performance Validation');
git(repoPath, 'config', 'user.email', 'performance@example.invalid');
git(repoPath, 'config', 'commit.gpgsign', 'false');
await writeFile(join(repoPath, 'selected.txt'), 'before\n');
await writeFile(join(repoPath, 'original.txt'), 'rename contents\n');
git(repoPath, 'add', '.');
git(repoPath, 'commit', '-m', 'base');
const baseSha = git(repoPath, 'rev-parse', 'HEAD').trim();
const history = [];
for (let index = 1; index <= 8000; index++) {
  const message = `Large repository history ${index}\n`;
  history.push(`commit refs/heads/main\nmark :${index}\ncommitter Performance Validation <performance@example.invalid> ${1760000000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}from ${index === 1 ? baseSha : `:${index - 1}`}\n\n`);
}
execFileSync('git', ['-C', repoPath, 'fast-import', '--quiet'], { input: history.join('') });
const headSha = git(repoPath, 'rev-parse', 'HEAD').trim();
git(repoPath, 'update-ref', 'refs/remotes/origin/main', baseSha);
git(repoPath, 'remote', 'add', 'origin', repoPath);
git(repoPath, 'branch', '--set-upstream-to=origin/main', 'main');
await writeFile(join(repoPath, 'selected.txt'), 'after\n');
git(repoPath, 'mv', 'original.txt', 'renamed.txt');
await mkdir(join(repoPath, 'staged'));
await Promise.all(Array.from({ length: 18 }, (_, index) =>
  writeFile(join(repoPath, 'staged', `${index}.txt`), `staged ${index}\n`)
));
git(repoPath, 'add', 'staged');
await mkdir(join(repoPath, 'unrelated'));
await Promise.all(Array.from({ length: 1500 }, (_, index) =>
  writeFile(join(repoPath, 'unrelated', `${index}.txt`), 'unrelated\n')
));
await writeFile(join(repoPath, 'binary.dat'), Buffer.from([0, 1, 2, 255]));
const userData = join(root, 'user-data');
await mkdir(userData);
await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
await writeFile(join(userData, 'git-gud-workspace.json'), JSON.stringify({
  settings: { autoFetchIntervalMinutes: 0, remoteAvatars: false }
}));
const cdpPort = await freePort();
const controlPort = await freePort();
const launch = join(root, 'launch.cjs');
await writeFile(launch, `
const { app, ipcMain } = require('electron');
const { AsyncLocalStorage } = require('node:async_hooks');
const http = require('node:http');
const childProcess = require('node:child_process');
const { basename } = require('node:path');
app.setPath('userData', ${JSON.stringify(userData)});
let window;
const reads = [];
const counts = {};
const calls = [];
const events = [];
const context = new AsyncLocalStorage();
const spawn = childProcess.spawn;
childProcess.spawn = (executable, args, options) => {
  const child = spawn(executable, args, options);
  const read = context.getStore();
  if (read && /^git(?:\\.exe)?$/.test(basename(executable))) {
    const command = { args, stdoutBytes: 0 };
    read.git.push(command);
    child.stdout?.on('data', (chunk) => { command.stdoutBytes += chunk.length; });
  }
  return child;
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => handle(channel, async (event, ...args) => {
  counts[channel] = (counts[channel] || 0) + 1;
  calls.push({ channel, at: Date.now() });
  if (!['repo:file-diff', 'repo:review-plan', 'repo:commit-selection-detail', 'repo:fetch'].includes(channel)) {
    return callback(event, ...args);
  }
  const entry = { channel, request: args[1], git: [], startedAt: Date.now() };
  reads.push(entry);
  return context.run(entry, async () => {
    try {
      const result = await callback(event, ...args);
      if (channel === 'repo:fetch') entry.invalidates = result.invalidates;
      return result;
    } finally { entry.durationMs = Date.now() - entry.startedAt; }
  });
});
app.on('browser-window-created', (_event, created) => {
  window = created;
  created.on('focus', () => events.push({type:'focus', at:Date.now()}));
  const send = created.webContents.send.bind(created.webContents);
  created.webContents.send = (channel, ...args) => {
    if (channel === 'repo:changed') events.push({type:channel, at:Date.now(), event:args[0]});
    return send(channel, ...args);
  };
});
http.createServer((request, response) => {
  if (request.url === '/focus') { window?.show(); window?.focus(); }
  if (request.url === '/quit') window?.close();
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ ready: Boolean(window), reads, counts, calls, events }));
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

try {
  await waitFor(async () => {
    if (launchError) throw launchError;
    try { return (await control()).ready; } catch { return false; }
  });
  await agent('connect', String(cdpPort));
  await waitFor(() => evaluate('Boolean(window.api)'));
  await evaluate(`window.api.openRepositoryAtPath(${JSON.stringify(repoPath)}).then(() => true)`);
  await evaluate('location.reload(); true');
  await waitFor(() => evaluate('document.body.innerText.includes("Large repository history 8000")'));
  await agent('snapshot', '-i');
  await agent('find', 'text', '// WIP', 'click', '--exact');
  await waitFor(() => evaluate('Boolean(document.querySelector(\'button[title="selected.txt"]\'))'));
  await agent('snapshot', '-i');
  await agent('find', 'title', 'selected.txt', 'click', '--exact');
  await waitFor(() => evaluate('Boolean(document.querySelector(\'[aria-label="Close diff"]\'))'));
  await screenshot('working-file-diff');
  const diff = await evaluate(`window.api.getFileDiff(${JSON.stringify(repoPath)}, {kind:'wip',path:'selected.txt',staged:false})`);
  assert.ok(diff.patch.includes('+after'));
  const diffRead = (await control()).reads.filter((read) => read.channel === 'repo:file-diff' && read.request.path === 'selected.txt').at(-1);
  const statusRead = diffRead.git.filter((command) => command.args.includes('status'));
  assert.equal(statusRead.length, 1);
  assert.ok(statusRead[0].stdoutBytes < 1024);
  assert.ok(statusRead[0].args.includes('--no-ahead-behind'));
  report.checks.push({ name: 'Single-file diff uses scoped status', pass: true, read: diffRead });
  await agent('find', 'role', 'button', 'click', '--name', 'Close diff', '--exact');
  await agent('snapshot', '-i');
  await agent('hover', 'button[title="selected.txt"]');
  await agent('find', 'role', 'button', 'click', '--name', 'Stage File selected.txt', '--exact');
  await waitFor(() => evaluate('Boolean(document.querySelector(\'[aria-label="Unstage File selected.txt"]\'))'));
  assert.equal(git(repoPath, 'diff', '--cached', '--', 'selected.txt').includes('+after'), true);
  await screenshot('file-staged');
  await agent('snapshot', '-i');
  await agent('hover', 'button[title="selected.txt"]');
  await agent('find', 'role', 'button', 'click', '--name', 'Unstage File selected.txt', '--exact');
  await waitFor(() => evaluate('Boolean(document.querySelector(\'[aria-label="Stage File selected.txt"]\'))'));
  assert.equal(git(repoPath, 'diff', '--cached', '--', 'selected.txt'), '');
  report.checks.push({ name: 'Stage and unstage from the UI preserve working contents', pass: true });

  const plan = await evaluate(`window.api.getReviewPlan(${JSON.stringify(repoPath)}, {kind:'wip',scope:'staged'})`);
  assert.equal(plan.fileContexts.length, 19);
  const reviewRead = (await control()).reads.filter((read) => read.channel === 'repo:review-plan').at(-1);
  const reviewStatus = reviewRead.git.filter((command) => command.args.includes('status'));
  assert.equal(reviewStatus.length, 1);
  assert.ok(reviewStatus[0].args.includes('--untracked-files=no'));
  assert.ok(reviewStatus[0].stdoutBytes < 4096);
  report.checks.push({ name: 'Staged review uses one limited status read', pass: true, read: reviewRead });

  const rename = await evaluate(`window.api.getFileDiff(${JSON.stringify(repoPath)}, {kind:'wip',path:'renamed.txt',staged:true})`);
  assert.equal(rename.originalPath, 'original.txt');
  assert.ok(rename.patch.includes('rename from original.txt'));
  await agent('snapshot', '-i');
  await agent('find', 'title', 'renamed.txt', 'click', '--exact');
  await waitFor(() => evaluate('Boolean(document.querySelector(\'[aria-label="Close diff"]\'))'));
  await screenshot('staged-rename-diff');
  await agent('find', 'role', 'button', 'click', '--name', 'Close diff', '--exact');
  report.checks.push({ name: 'Staged rename keeps both paths', pass: true });

  await agent('snapshot', '-i');
  await agent('find', 'title', 'binary.dat', 'click', '--exact');
  await waitFor(() => evaluate('document.body.innerText.includes("Binary") || document.body.innerText.includes("binary")'));
  const binary = await evaluate(`window.api.getFileDiff(${JSON.stringify(repoPath)}, {kind:'wip',path:'binary.dat',staged:false})`);
  assert.equal(binary.omittedReason, 'binary');
  await screenshot('binary-file-omitted');
  await agent('find', 'role', 'button', 'click', '--name', 'Close diff', '--exact');
  report.checks.push({ name: 'Binary file omission', pass: true });

  const selection = await evaluate(`window.api.getCommitSelectionDetail(${JSON.stringify(repoPath)}, ${JSON.stringify([headSha, baseSha])})`);
  assert.equal(selection.isContiguous, false);
  const selectionRead = (await control()).reads.filter((read) => read.channel === 'repo:commit-selection-detail').at(-1);
  const historyRead = selectionRead.git.find((command) => command.args[0] === 'rev-list');
  assert.ok(historyRead.args.includes('--max-count=3'));
  assert.equal(historyRead.stdoutBytes, 3 * 41);
  report.checks.push({ name: 'Sparse selection bounds an 8,001-commit history to three IDs', pass: true, read: selectionRead });

  // Synchronize once, then exercise an unchanged fetch through the actual toolbar.
  const changedFetch = await evaluate(`window.api.fetchRepository(${JSON.stringify(repoPath)})`);
  assert.ok(changedFetch.invalidates.includes('graph'));
  await evaluate('location.reload(); true');
  await waitFor(() => evaluate('document.body.innerText.includes("Large repository history 8000")'));
  await control('/focus');
  await delay(1200);
  const before = await control();
  report.manualFetchBefore = before;
  await agent('snapshot', '-i');
  await agent('find', 'role', 'button', 'click', '--name', 'Fetch', '--exact');
  await waitFor(async () => {
    const latest = (await control()).reads.filter((read) => read.channel === 'repo:fetch').at(-1);
    return latest && latest.durationMs !== undefined && latest.invalidates?.length === 0 &&
      (await control()).counts['repo:fetch'] > (before.counts['repo:fetch'] || 0);
  });
  await delay(1200); // Include delayed filesystem notifications in the assertion.
  const after = await control();
  report.manualFetchAfter = after;
  for (const channel of ['repo:overview', 'repo:graph']) {
    assert.equal(after.counts[channel], before.counts[channel], `Unchanged fetch reloaded ${channel}.`);
  }
  await screenshot('unchanged-fetch-complete');
  report.checks.push({ name: 'Unchanged manual fetch completes without reloading overview or history', pass: true,
    read: after.reads.filter((read) => read.channel === 'repo:fetch').at(-1) });
  report.console = await agent('console');
  report.errors = await agent('errors');
  report.network = await agent('network', 'requests');
  report.pass = true;
  console.log(JSON.stringify({ pass: true, checks: report.checks.map(({ name, pass, read }) => ({ name, pass, ms: read?.durationMs })), screenshots: report.screenshots }, null, 2));
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
