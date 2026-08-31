import { realpath, readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const ICON_PATHS = [
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'app/favicon.ico',
  'app/favicon.png',
  'app/icon.svg',
  'app/icon.png',
  'app/icon.ico',
  'src/favicon.ico',
  'src/favicon.svg',
  'src/app/favicon.ico',
  'src/app/icon.svg',
  'src/app/icon.png',
  'assets/icon.svg',
  'assets/icon.png',
  'assets/logo.svg',
  'assets/logo.png',
  'build/icon.svg',
  'build/icon.png',
  'build/icon.ico'
] as const;

const ICON_SOURCE_PATHS = [
  'index.html',
  'public/index.html',
  'app/routes/__root.tsx',
  'src/routes/__root.tsx',
  'app/root.tsx',
  'src/root.tsx',
  'src/index.html'
] as const;

const MONOREPO_APP_DIRECTORIES = ['apps', 'packages'] as const;
const SUPPORTED_ICON_EXTENSIONS = new Set(['.ico', '.jpg', '.jpeg', '.png', '.svg']);
const ICON_MIME_TYPES = {
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
} satisfies Record<string, string>;
const MAX_ICON_FILE_SIZE = 2 * 1024 * 1024;
const MAX_ICON_SOURCE_SIZE = 256 * 1024;

const HTML_ICON_LINK_PATTERN =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/iu;
const OBJECT_ICON_LINK_PATTERN =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"']+)["'])[^}]*/iu;

export async function loadRepositoryIconDataUrl(repoPath: string): Promise<string | undefined> {
  const iconPath = await discoverRepositoryIcon(repoPath);

  if (!iconPath) {
    return undefined;
  }

  const extension = extname(iconPath).toLowerCase() as keyof typeof ICON_MIME_TYPES;
  const contents = await readFile(iconPath);
  return `data:${ICON_MIME_TYPES[extension]};base64,${contents.toString('base64')}`;
}

export async function discoverRepositoryIcon(repoPath: string): Promise<string | undefined> {
  const projectRoot = resolve(repoPath);
  const realProjectRoot = await realpath(projectRoot);
  const searchRoots = [projectRoot, ...(await listMonorepoAppDirectories(projectRoot))];

  for (const searchRoot of searchRoots) {
    const knownIcon = await findKnownIcon(projectRoot, realProjectRoot, searchRoot);

    if (knownIcon) {
      return knownIcon;
    }

    const declaredIcon = await findDeclaredIcon(projectRoot, realProjectRoot, searchRoot);

    if (declaredIcon) {
      return declaredIcon;
    }
  }

  return undefined;
}

async function findKnownIcon(
  projectRoot: string,
  realProjectRoot: string,
  searchRoot: string
): Promise<string | undefined> {
  for (const iconPath of ICON_PATHS) {
    const candidate = await validateIconCandidate(
      projectRoot,
      realProjectRoot,
      join(searchRoot, iconPath)
    );

    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

async function findDeclaredIcon(
  projectRoot: string,
  realProjectRoot: string,
  searchRoot: string
): Promise<string | undefined> {
  for (const sourcePath of ICON_SOURCE_PATHS) {
    const source = await readSmallTextFile(
      projectRoot,
      realProjectRoot,
      join(searchRoot, sourcePath)
    );

    if (!source) {
      continue;
    }

    const href = extractIconHref(source);

    if (!href) {
      continue;
    }

    for (const candidatePath of resolveIconHref(searchRoot, href)) {
      const candidate = await validateIconCandidate(
        projectRoot,
        realProjectRoot,
        candidatePath
      );

      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

function extractIconHref(source: string): string | undefined {
  return source.match(HTML_ICON_LINK_PATTERN)?.[1] ??
    source.match(OBJECT_ICON_LINK_PATTERN)?.[1];
}

function resolveIconHref(searchRoot: string, href: string): string[] {
  const localHref = href.split(/[?#]/u, 1)[0]?.trim();

  if (!localHref || localHref.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(localHref)) {
    return [];
  }

  const relativeHref = localHref.replace(/^[/\\]+/u, '');
  return [join(searchRoot, 'public', relativeHref), join(searchRoot, relativeHref)];
}

async function validateIconCandidate(
  projectRoot: string,
  realProjectRoot: string,
  candidatePath: string
): Promise<string | undefined> {
  if (!isPathInside(projectRoot, candidatePath)) {
    return undefined;
  }

  const extension = extname(candidatePath).toLowerCase();

  if (!SUPPORTED_ICON_EXTENSIONS.has(extension)) {
    return undefined;
  }

  try {
    const fileStat = await stat(candidatePath);

    if (!fileStat.isFile() || fileStat.size > MAX_ICON_FILE_SIZE) {
      return undefined;
    }

    const realCandidatePath = await realpath(candidatePath);
    return isPathInside(realProjectRoot, realCandidatePath) ? realCandidatePath : undefined;
  } catch {
    return undefined;
  }
}

async function readSmallTextFile(
  projectRoot: string,
  realProjectRoot: string,
  filePath: string
): Promise<string | undefined> {
  if (!isPathInside(projectRoot, filePath)) {
    return undefined;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile() || fileStat.size > MAX_ICON_SOURCE_SIZE) {
      return undefined;
    }

    const realFilePath = await realpath(filePath);

    if (!isPathInside(realProjectRoot, realFilePath)) {
      return undefined;
    }

    return await readFile(realFilePath, 'utf8');
  } catch {
    return undefined;
  }
}

async function listMonorepoAppDirectories(projectRoot: string): Promise<string[]> {
  const appDirectories = await Promise.all(
    MONOREPO_APP_DIRECTORIES.map(async (directory) => {
      try {
        const entries = await readdir(join(projectRoot, directory), { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => join(projectRoot, directory, entry.name))
          .sort();
      } catch {
        return [];
      }
    })
  );

  return appDirectories.flat();
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const pathFromParent = relative(resolve(parentPath), resolve(candidatePath));
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}
