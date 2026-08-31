import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverRepositoryIcon, loadRepositoryIconDataUrl } from './repositoryIcon';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('repository icon discovery', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it('prefers a known icon at the repository root', async () => {
    const repoPath = await createTemporaryDirectory('git-gud-repository-icon-root-');
    await mkdir(join(repoPath, 'apps', 'web', 'public'), { recursive: true });
    await writeFile(join(repoPath, 'favicon.svg'), '<svg>root</svg>');
    await writeFile(join(repoPath, 'apps', 'web', 'public', 'favicon.svg'), '<svg>web</svg>');

    await expect(discoverRepositoryIcon(repoPath)).resolves.toBe(
      await realpath(join(repoPath, 'favicon.svg'))
    );
  });

  it('resolves a local icon declaration from an app entry file', async () => {
    const repoPath = await createTemporaryDirectory('git-gud-repository-icon-source-');
    await mkdir(join(repoPath, 'public', 'brand'), { recursive: true });
    await writeFile(join(repoPath, 'index.html'), '<link href="/brand/mark.svg?v=2" rel="icon">');
    await writeFile(join(repoPath, 'public', 'brand', 'mark.svg'), '<svg>brand</svg>');

    await expect(discoverRepositoryIcon(repoPath)).resolves.toBe(
      await realpath(join(repoPath, 'public', 'brand', 'mark.svg'))
    );
  });

  it('discovers a favicon in an immediate monorepo app', async () => {
    const repoPath = await createTemporaryDirectory('git-gud-repository-icon-monorepo-');
    const iconPath = join(repoPath, 'apps', 'web', 'public', 'favicon.png');
    await mkdir(join(repoPath, 'apps', 'web', 'public'), { recursive: true });
    await writeFile(iconPath, 'png');

    await expect(discoverRepositoryIcon(repoPath)).resolves.toBe(await realpath(iconPath));
  });

  it('ignores external declarations and icons outside the repository', async () => {
    const repoPath = await createTemporaryDirectory('git-gud-repository-icon-contained-');
    const outsidePath = join(await createTemporaryDirectory('git-gud-repository-icon-outside-'), 'icon.svg');
    await writeFile(outsidePath, '<svg>outside</svg>');
    await writeFile(join(repoPath, 'index.html'), '<link rel="icon" href="https://example.com/icon.svg">');
    await symlink(outsidePath, join(repoPath, 'favicon.svg'));

    await expect(discoverRepositoryIcon(repoPath)).resolves.toBeUndefined();
  });

  it('returns no icon when the repository has no supported image', async () => {
    const repoPath = await createTemporaryDirectory('git-gud-repository-icon-empty-');
    await writeFile(join(repoPath, 'README.md'), '# No icon');

    await expect(discoverRepositoryIcon(repoPath)).resolves.toBeUndefined();
  });

  it('returns SVG icons as image data URLs', async () => {
    const repoPath = await createTemporaryDirectory('git-gud-repository-icon-data-');
    await writeFile(join(repoPath, 'favicon.svg'), '<svg>favicon</svg>');

    await expect(loadRepositoryIconDataUrl(repoPath)).resolves.toBe(
      `data:image/svg+xml;base64,${Buffer.from('<svg>favicon</svg>').toString('base64')}`
    );
  });
});
