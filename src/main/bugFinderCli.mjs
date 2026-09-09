#!/usr/bin/env node
// Installed by Git Gud. Run with Node.js 20+; the desktop app must be running.
import console from 'node:console';
import process from 'node:process';
const { fetch, AbortSignal } = globalThis;
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const help = `Git Gud findings CLI v1
Git Gud is the desktop Git client. This CLI updates its local PR findings, not GitHub comments.
node git-gud.mjs --connection FILE findings ACTION --profile ID --pr OWNER/REPO#NUMBER --head FULL_SHA [options]
Actions: list, add, update ID, dismiss ID, restore ID, remove ID
Options: --input FILE (or - for stdin), --if-version NUMBER, --reason TEXT, --json
update accepts a partial content object; add requires title, body, category, severity, evidence, location.
category: bug|convention; severity: critical|major|minor (null for convention).
evidence: {kind: code|reproduced|incomplete, detail: string}
location: {path: repository-relative string, line: integer, endLine: integer, side: left|right}
The app checks revision, location and record version. Use list --json before writing.
Error codes: CONFLICT, STALE_HEAD, INVALID_REQUEST, UNAVAILABLE. Changes never publish GitHub comments.`;
try {
  const { values: v, positionals: p } = parseArgs({
    allowPositionals: true,
    options: {
      connection: { type: 'string' },
      profile: { type: 'string' },
      pr: { type: 'string' },
      head: { type: 'string' },
      input: { type: 'string' },
      'if-version': { type: 'string' },
      reason: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' }
    }
  });
  if (v.help || v.version) {
    console.log(v.version ? 'Git Gud findings CLI v1' : help);
  } else {
    if (
      p[0] !== 'findings' ||
      !['list', 'add', 'update', 'dismiss', 'restore', 'remove'].includes(
        p[1]
      ) ||
      !v.connection ||
      !v.profile ||
      !v.pr
    )
      throw new Error(help);
    const pr = /^([^/#]+)\/([^/#]+)#([1-9][0-9]*)$/u.exec(v.pr);
    if (!pr) throw new Error('Use OWNER/REPOSITORY#NUMBER.');
    const connection = JSON.parse(await readFile(v.connection, 'utf8'));
    if (
      !Number.isInteger(connection.port) ||
      connection.port < 1 ||
      connection.port > 65535 ||
      typeof connection.token !== 'string'
    )
      throw new Error(
        'Invalid connection file. Reopen Git Gud and copy a fresh prompt.'
      );
    const locator = {
      profileId: v.profile,
      owner: pr[1],
      repository: pr[2],
      number: Number(pr[3])
    };
    async function request(body) {
      const response = await fetch(
        `http://127.0.0.1:${connection.port}/findings`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000)
        }
      );
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error);
        error.code = result.code;
        throw error;
      }
      return result;
    }
    const action = p[1] === 'list' ? 'get' : p[1];
    if (
      ['update', 'dismiss', 'restore', 'remove'].includes(action) &&
      (!p[2]?.trim() ||
        !/^[1-9][0-9]*$/u.test(v['if-version'] ?? '') ||
        !Number.isSafeInteger(Number(v['if-version'])))
    )
      throw new Error(
        'Provide a finding ID and a positive integer --if-version from list --json.'
      );
    const body = {
      locator,
      action,
      headSha: v.head,
      id: p[2],
      version: Number(v['if-version']),
      reason: v.reason
    };
    if (action === 'add' || action === 'update') {
      if (!v.input)
        throw new Error('Provide --input FILE, or --input - for stdin.');
      const text =
        v.input === '-'
          ? await new Promise((resolve, reject) => {
              let text = '';
              process.stdin.setEncoding('utf8');
              process.stdin.on('data', (part) => {
                text += part;
                if (text.length > 100000) {
                  reject(new Error('Input too large.'));
                  process.stdin.destroy();
                }
              });
              process.stdin.on('end', () => resolve(text));
              process.stdin.on('error', reject);
            })
          : await readFile(v.input, 'utf8');
      const content = JSON.parse(text);
      if (!content || typeof content !== 'object' || Array.isArray(content))
        throw new Error('Expected a JSON object.');
      const allowed = [
        'title',
        'body',
        'category',
        'severity',
        'evidence',
        'location'
      ];
      if (Object.keys(content).some((key) => !allowed.includes(key)))
        throw new Error('Only content fields may be edited. See --help.');
      if (action === 'update') {
        const { state } = await request({ locator, action: 'get' });
        const current = state.findings.find((f) => f.id === p[2]);
        if (!current || current.version !== body.version) {
          const error = new Error(
            'CONFLICT: Reread the finding before editing.'
          );
          error.code = 'CONFLICT';
          throw error;
        }
        body.content = {
          ...Object.fromEntries(allowed.map((key) => [key, current[key]])),
          ...content
        };
      } else body.content = content;
    }
    const result = await request(body);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(
    JSON.stringify({ code: error.code || 'UNAVAILABLE', error: error.message })
  );
  process.exitCode = 1;
}
