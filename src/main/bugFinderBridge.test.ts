import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { startBugFinderBridge } from './bugFinderBridge';
import { newBugFinding } from './bugFinderStore';
import type { BugFinderState, BugFindingContent } from '@shared/bugFinder';
const run = promisify(execFile);

it('runs the installed CLI against the authenticated local bridge and restricts it to finding edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-gud-cli-'));
  const headSha = 'a'.repeat(40);
  const content: BugFindingContent = {
    title: 'Request race',
    body: 'Old request overwrites results',
    category: 'bug',
    severity: 'major',
    evidence: { kind: 'code', detail: 'No request guard.' },
    location: { path: 'src/search.ts', line: 2, endLine: 2, side: 'right' }
  };
  const state: BugFinderState = {
    status: 'ready',
    headSha,
    findings: [newBugFinding(content, headSha, 'scan')]
  };
  const id = state.findings[0]!.id;
  const bridge = await startBugFinderBridge(directory, async (r) => {
    if (r.action === 'update') {
      if (r.version !== state.findings[0]!.version)
        throw new Error('CONFLICT: Stale version');
      Object.assign(state.findings[0]!, r.content);
      state.findings[0]!.version++;
    }
    return { state };
  });
  try {
    const prefix = [
      bridge.script,
      '--connection',
      bridge.connection,
      'findings',
      '--profile',
      'test',
      '--pr',
      'example/demo#12',
      '--head',
      headSha
    ];
    const listed = JSON.parse(
      (await run(process.execPath, [...prefix, 'list', '--json'])).stdout
    );
    expect(listed.state.findings[0].id).toBe(id);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(directory, 'update.json'),
      JSON.stringify({ body: 'Caller evidence added by agent: žluťoučký kůň.' })
    );
    await run(process.execPath, [
      ...prefix,
      'update',
      id,
      '--if-version',
      '1',
      '--input',
      join(directory, 'update.json'),
      '--json'
    ]);
    expect(state.findings[0]).toMatchObject({
      version: 2,
      body: 'Caller evidence added by agent: žluťoučký kůň.'
    });
    await expect(
      run(process.execPath, [
        ...prefix,
        'update',
        id,
        '--if-version',
        '1',
        '--input',
        join(directory, 'update.json')
      ])
    ).rejects.toMatchObject({ stderr: expect.stringContaining('CONFLICT') });
    const connection = JSON.parse(await readFile(bridge.connection, 'utf8'));
    const endpoint = `http://127.0.0.1:${connection.port}/findings`;
    expect((await fetch(endpoint, { method: 'POST', body: '{}' })).status).toBe(
      403
    );
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.token}`,
            Origin: 'https://untrusted.invalid'
          },
          body: '{}'
        })
      ).status
    ).toBe(403);
    const forbidden = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({
        action: 'post',
        locator: {
          profileId: 'test',
          owner: 'example',
          repository: 'demo',
          number: 12
        },
        headSha,
        selected: [{ id, version: 2 }]
      })
    });
    expect(forbidden.status).toBe(400);
    expect(await forbidden.text()).toContain(
      'only supports reading and editing'
    );
  } finally {
    bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
