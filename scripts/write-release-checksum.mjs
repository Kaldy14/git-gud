#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export async function writeReleaseChecksum(artifactPath) {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(artifactPath)) {
    hash.update(chunk);
  }

  const checksumPath = `${artifactPath}.sha256`;
  const checksumLine = `${hash.digest('hex')}  ${basename(artifactPath)}\n`;
  await writeFile(checksumPath, checksumLine, { encoding: 'ascii' });

  return checksumPath;
}

if (argv[1] && resolve(argv[1]) === scriptPath) {
  const artifactPath = argv[2];

  if (!artifactPath) {
    throw new Error('Usage: node scripts/write-release-checksum.mjs <artifact>');
  }

  const checksumPath = await writeReleaseChecksum(artifactPath);
  stdout.write(`Wrote ${checksumPath}\n`);
}
