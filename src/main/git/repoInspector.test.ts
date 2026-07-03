import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { validateRepository } from './repoInspector';

describe('validateRepository', () => {
  it('rejects bare repositories with a clear message', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-repo-inspector-'));

    try {
      const barePath = join(rootPath, 'bare.git');
      await gitExecutor.run(['init', '--bare', barePath], { cwd: rootPath, kind: 'mutation' });

      await expect(validateRepository(barePath)).rejects.toThrow(
        'Bare repositories are not supported in this first build.'
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
