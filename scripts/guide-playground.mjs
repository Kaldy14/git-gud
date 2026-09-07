import process from 'node:process';
import console from 'node:console';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'git-gud-guide-')));
const repo = join(directory, 'demo');
mkdirSync(repo);
const files = {
  'docs/keyboard.md': '# Keyboard\n\nSubmit with Enter.\n',
  'src/search/search-client.ts': `let latestRequest = 0;
let results: string[] = [];

export async function search(query: string) {
  const request = ++latestRequest;
  const response = await fetch('/search?q=' + encodeURIComponent(query));
  const data: string[] = await response.json();

  results = data;
  return results;
}
`,
  'src/status/loading.ts': `export function isLoading(pending: number) {
  return pending === 1;
}
`,
  'locales/en.json': '{"search": "Go", "empty": "No matches"}\n'
};
for (const [path, content] of Object.entries(files)) {
  mkdirSync(resolve(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
}
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
git('init', '-b', 'main');
git('-c', 'user.name=Guide Test', '-c', 'user.email=guide-test@example.invalid', 'add', '.');
git('-c', 'user.name=Guide Test', '-c', 'user.email=guide-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial fixture');
writeFileSync(join(repo, 'src/search/search-client.ts'), files['src/search/search-client.ts'].replace('  results = data;', '  if (request !== latestRequest) return results;\n  results = data;'));
writeFileSync(join(repo, 'src/status/loading.ts'), files['src/status/loading.ts'].replace('pending === 1', 'pending > 0'));
writeFileSync(join(repo, 'locales/en.json'), '{"search": "Search", "empty": "No results found"}\n');
writeFileSync(join(repo, 'docs/keyboard.md'), '# Keyboard shortcuts\n\nPress Enter to submit.\n');
const launcher = join(directory, 'launcher.cjs');
writeFileSync(launcher, `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
if (process.env.ELECTRON_RENDERER_URL) process.env.ELECTRON_RENDERER_URL += '?guide-test-repo=' + encodeURIComponent(${JSON.stringify(repo)});
require(${JSON.stringify(join(root, 'out/main/index.js'))});
`);
console.log(`Isolated fixture: ${repo}\nDevTools port: ${process.env.GUIDE_TEST_CDP_PORT || '9235'}`);
const child = spawn('pnpm', ['exec', 'electron-vite', 'dev', '--remoteDebuggingPort', process.env.GUIDE_TEST_CDP_PORT || '9235', '--entry', launcher], { cwd: root, stdio: 'inherit' });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code) => { process.exitCode = code ?? 0; });
