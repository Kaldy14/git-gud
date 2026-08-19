import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execPath } from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('release checksum writer', () => {
  it('writes a portable LF-terminated checksum that shasum can consume', () => {
    const directory = mkdtempSync(join(tmpdir(), 'git-gud-release-checksum-'));
    temporaryDirectories.push(directory);

    const artifactPath = join(directory, 'Git-Gud-Windows-x64.exe');
    const artifact = Buffer.from('portable release artifact');
    writeFileSync(artifactPath, artifact);

    execFileSync(execPath, [resolve('scripts/write-release-checksum.mjs'), artifactPath]);

    const checksumFile = readFileSync(`${artifactPath}.sha256`);
    const expectedHash = createHash('sha256').update(artifact).digest('hex');

    expect(checksumFile.toString('ascii')).toBe(
      `${expectedHash}  Git-Gud-Windows-x64.exe\n`
    );
    expect(checksumFile).not.toContain(0x0d);

    expect(
      execFileSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-e',
          '-o',
          'pipefail',
          '-c',
          'for checksum in *.sha256; do shasum -a 256 -c "$checksum"; done'
        ],
        {
          cwd: directory,
          encoding: 'utf8'
        }
      )
    ).toBe('Git-Gud-Windows-x64.exe: OK\n');
  });
});
