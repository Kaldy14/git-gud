import { spawnSync } from 'node:child_process';
import { dirname, extname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import type {
  GitReviewFileContext,
  GitReviewTypeDefinitionInput,
  GitReviewTypeDefinitionResult
} from '@shared/types';

import { resolveGitExecutable } from './exec';

export type ReviewTypeDefinitionFileContext = Pick<
  GitReviewFileContext,
  'newContents' | 'oldContents' | 'originalPath' | 'path' | 'source'
>;

export interface ReviewTypeDefinitionInput extends Omit<
  GitReviewTypeDefinitionInput,
  'sourceFingerprint' | 'target'
> {
  files: readonly ReviewTypeDefinitionFileContext[];
  repoPath?: string;
  target?: GitReviewTypeDefinitionInput['target'];
  baseSha?: string;
  gitEnv?: NodeJS.ProcessEnv;
}
export type ReviewTypeDefinitionResult = GitReviewTypeDefinitionResult;

const REVIEW_ROOT = resolve('/__git_gud_review_snapshot__');
const MAX_GIT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_GIT_TREE_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_GIT_LAYERS = 8;

type ReviewProjectLayer =
  | { kind: 'disk' }
  | { kind: 'git'; revision: string };

type ProjectSource = Pick<
  ts.ParseConfigHost,
  'fileExists' | 'readDirectory' | 'readFile' | 'useCaseSensitiveFileNames'
> & {
  directoryExists: (directory: string) => boolean;
  getDirectories: (directory: string) => string[];
};

type CachedGitLayer = {
  files: ReadonlySet<string>;
  contents: Map<string, string | undefined>;
};

const gitLayerCache = new Map<string, CachedGitLayer>();

/** Resolve a declaration from reviewed contents overlaid on the local TypeScript project. */
export function resolveReviewTypeDefinition(
  input: ReviewTypeDefinitionInput
): ReviewTypeDefinitionResult | undefined {
  if (!Number.isInteger(input.line) || input.line < 1 ||
      !Number.isInteger(input.character) || input.character < 0) {
    return undefined;
  }

  const projectRoot = input.repoPath ? normalizePath(input.repoPath) : REVIEW_ROOT;
  const clickedPath = reviewPath(projectRoot, input.filePath);
  if (!clickedPath || !isTypeScriptPath(clickedPath)) return undefined;

  const snapshots = new Map<string, string>();
  const orderedFiles = [
    ...input.files.filter((file) => file.source !== input.source),
    ...input.files.filter((file) => file.source === input.source)
  ];
  for (const file of orderedFiles) {
    const sidePath = input.side === 'old' ? file.originalPath ?? file.path : file.path;
    const filePath = reviewPath(projectRoot, sidePath);
    if (!filePath) continue;
    snapshots.set(filePath, input.side === 'old' ? file.oldContents : file.newContents);
  }

  const clickedContents = snapshots.get(clickedPath);
  if (clickedContents === undefined) return undefined;

  const project = createReviewTypeDefinitionProject(
    projectRoot,
    clickedPath,
    snapshots,
    reviewProjectLayer(input),
    input.gitEnv
  );
  const service = ts.createLanguageService(
    project.host,
    ts.createDocumentRegistry()
  );

  try {
    const sourceFile = service.getProgram()?.getSourceFile(clickedPath);
    if (!sourceFile) return undefined;
    const position = positionAt(sourceFile, input.line, input.character);
    if (position === undefined) return undefined;

    const definitions = expandAliasDefinitions(
      service.getDefinitionAtPosition(clickedPath, position),
      service
    );
    const definitionResult = resultFromDefinitions(
      definitions,
      'definition',
      service,
      projectRoot,
      project.readFile
    );
    if (definitionResult) return definitionResult;

    return resultFromDefinitions(
      service.getTypeDefinitionAtPosition(clickedPath, position),
      'type-definition',
      service,
      projectRoot,
      project.readFile
    );
  } finally {
    service.dispose();
  }
}

function reviewProjectLayer(input: ReviewTypeDefinitionInput): ReviewProjectLayer {
  if (!input.repoPath || !input.target) return { kind: 'disk' };

  if (input.target.kind === 'commit') {
    return {
      kind: 'git',
      revision: input.side === 'new' ? input.target.sha : `${input.target.sha}^1`
    };
  }

  if (input.target.kind === 'branch') {
    return input.side === 'new'
      ? { kind: 'git', revision: input.target.sha }
      : input.baseSha
        ? { kind: 'git', revision: input.baseSha }
        : { kind: 'disk' };
  }

  if (input.source === 'staged') {
    return input.side === 'new'
      ? { kind: 'git', revision: '' }
      : { kind: 'git', revision: 'HEAD' };
  }

  if (input.source === 'unstaged') {
    return input.side === 'new'
      ? { kind: 'disk' }
      : { kind: 'git', revision: '' };
  }

  return { kind: 'disk' };
}

function createProjectSource(
  projectRoot: string,
  layer: ReviewProjectLayer,
  gitEnv?: NodeJS.ProcessEnv
): ProjectSource {
  if (layer.kind === 'disk') {
    return {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: (directory) => ts.sys.directoryExists?.(directory) ?? false,
      getDirectories: ts.sys.getDirectories,
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
    };
  }

  const environment = { ...process.env, ...gitEnv };
  const executable = resolveGitExecutable(environment);
  const gitLayer = loadGitLayer(projectRoot, layer.revision, executable, environment);
  const sourceFiles = new Set(
    [...gitLayer.files].map((path) => normalizePath(resolve(projectRoot, path)))
  );
  const isInsideProject = (path: string): boolean => isContained(projectRoot, path);
  const relativePath = (path: string): string => normalizeRelativePath(relative(projectRoot, path));
  const readFile = (path: string): string | undefined => {
    const normalizedPath = normalizePath(path);
    if (!isInsideProject(normalizedPath)) return ts.sys.readFile(normalizedPath);
    if (!sourceFiles.has(normalizedPath)) return undefined;

    const repositoryPath = relativePath(normalizedPath);
    if (gitLayer.contents.has(repositoryPath)) {
      return gitLayer.contents.get(repositoryPath);
    }

    const objectName = layer.revision
      ? `${layer.revision}:${repositoryPath}`
      : `:${repositoryPath}`;
    const result = spawnSync(executable, ['show', objectName], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: environment,
      maxBuffer: MAX_GIT_FILE_BYTES,
      timeout: 5_000
    });
    const contents = result.status === 0 ? result.stdout : undefined;
    gitLayer.contents.set(repositoryPath, contents);
    return contents;
  };
  const directoryExists = (directory: string): boolean => {
    const normalizedDirectory = normalizePath(directory);
    if (!isInsideProject(normalizedDirectory)) {
      return ts.sys.directoryExists?.(normalizedDirectory) ?? false;
    }
    return normalizedDirectory === normalizePath(projectRoot) ||
      [...sourceFiles].some((path) => isContained(normalizedDirectory, path));
  };

  return {
    fileExists: (path) => {
      const normalizedPath = normalizePath(path);
      return isInsideProject(normalizedPath)
        ? sourceFiles.has(normalizedPath)
        : ts.sys.fileExists(normalizedPath);
    },
    readFile,
    readDirectory: (directory, extensions) => {
      const normalizedDirectory = normalizePath(directory);
      if (!isInsideProject(normalizedDirectory)) {
        return ts.sys.readDirectory(directory, extensions ?? []);
      }
      return [...sourceFiles].filter((path) =>
        isContained(normalizedDirectory, path) &&
        (!extensions?.length || extensions.includes(extname(path)))
      );
    },
    directoryExists,
    getDirectories: (directory) => {
      const normalizedDirectory = normalizePath(directory);
      if (!isInsideProject(normalizedDirectory)) return ts.sys.getDirectories(directory);
      return [...new Set(
        [...sourceFiles]
          .filter((path) => isContained(normalizedDirectory, path))
          .map((path) => relative(normalizedDirectory, path).split(sep)[0])
          .filter((segment): segment is string => Boolean(segment))
          .map((segment) => resolve(normalizedDirectory, segment))
      )];
    },
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
  };
}

function loadGitLayer(
  projectRoot: string,
  revision: string,
  executable: string,
  env: NodeJS.ProcessEnv
): CachedGitLayer {
  const cacheKey = revision ? `${projectRoot}\0${revision}` : undefined;
  const cached = cacheKey ? gitLayerCache.get(cacheKey) : undefined;
  if (cached) return cached;

  const args = revision
    ? ['ls-tree', '-r', '--name-only', '-z', revision]
    : ['ls-files', '-z'];
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
    maxBuffer: MAX_GIT_TREE_BYTES,
    timeout: 5_000
  });
  const layer: CachedGitLayer = {
    files: new Set(result.status === 0 ? result.stdout.split('\0').filter(Boolean) : []),
    contents: new Map()
  };

  if (cacheKey) {
    gitLayerCache.delete(cacheKey);
    gitLayerCache.set(cacheKey, layer);
    while (gitLayerCache.size > MAX_CACHED_GIT_LAYERS) {
      const oldestKey = gitLayerCache.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      gitLayerCache.delete(oldestKey);
    }
  }

  return layer;
}

function createReviewTypeDefinitionProject(
  projectRoot: string,
  clickedPath: string,
  snapshots: ReadonlyMap<string, string>,
  layer: ReviewProjectLayer,
  gitEnv?: NodeJS.ProcessEnv
): {
  host: ts.LanguageServiceHost;
  readFile: (fileName: string) => string | undefined;
} {
  const isLocalProject = projectRoot !== REVIEW_ROOT;
  const source = createProjectSource(projectRoot, layer, gitEnv);
  const readFile = (fileName: string): string | undefined => {
    const normalizedFileName = normalizePath(fileName);
    return snapshots.get(normalizedFileName) ??
      (isLocalProject ? source.readFile(normalizedFileName) : undefined);
  };
  const fileExists = (fileName: string): boolean => {
    const normalizedFileName = normalizePath(fileName);
    return snapshots.has(normalizedFileName) ||
      (isLocalProject && source.fileExists(normalizedFileName));
  };
  const projectSource: ProjectSource = {
    ...source,
    fileExists,
    readFile,
    readDirectory: (directory, extensions, excludes, includes, depth) => {
      const sourcePaths = source.readDirectory(
        directory,
        extensions,
        excludes,
        includes,
        depth
      );
      const overlayPaths = [...snapshots.keys()].filter((fileName) =>
        isContained(directory, fileName) &&
        (!extensions.length || extensions.includes(extname(fileName)))
      );
      return [...new Set([...sourcePaths, ...overlayPaths])];
    }
  };
  const options = isLocalProject
    ? loadCompilerOptions(projectRoot, clickedPath, projectSource)
    : fallbackCompilerOptions(true);

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...snapshots.keys()].filter(isTypeScriptPath),
    getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => {
      const contents = readFile(fileName);
      return contents === undefined ? undefined : ts.ScriptSnapshot.fromString(contents);
    },
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists,
    readFile,
    readDirectory: (directory, extensions, excludes, includes, depth) => {
      const diskFiles = isLocalProject
        ? projectSource.readDirectory(directory, extensions ?? [], excludes ?? [], includes ?? [], depth)
        : [];
      const overlayFiles = [...snapshots.keys()].filter((fileName) =>
        isContained(directory, fileName) &&
        (!extensions?.length || extensions.includes(extname(fileName)))
      );
      return [...new Set([...diskFiles, ...overlayFiles])];
    },
    directoryExists: (directory) =>
      (isLocalProject && source.directoryExists(directory)) ||
      [...snapshots.keys()].some((fileName) => isContained(directory, fileName)),
    getDirectories: (directory) => isLocalProject ? source.getDirectories(directory) : [],
    realpath: normalizePath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n'
  };

  return { host, readFile };
}

function loadCompilerOptions(
  projectRoot: string,
  clickedPath: string,
  source: ProjectSource
): ts.CompilerOptions {
  const configPath = findProjectConfig(projectRoot, clickedPath, source.fileExists);
  if (!configPath) {
    return fallbackCompilerOptions(false);
  }

  const config = ts.readConfigFile(configPath, source.readFile);
  if (config.error) {
    return fallbackCompilerOptions(false);
  }

  return {
    ...fallbackCompilerOptions(false),
    ...ts.parseJsonConfigFileContent(config.config, source, dirname(configPath)).options,
    noEmit: true
  };
}

function findProjectConfig(
  projectRoot: string,
  clickedPath: string,
  fileExists: (path: string) => boolean
): string | undefined {
  let directory = dirname(clickedPath);
  while (isContained(projectRoot, directory)) {
    const candidate = resolve(directory, 'tsconfig.json');
    if (fileExists(candidate)) return candidate;
    if (directory === projectRoot) return undefined;
    directory = dirname(directory);
  }
  return undefined;
}

function fallbackCompilerOptions(noLib: boolean): ts.CompilerOptions {
  return {
    allowJs: false,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib,
    target: ts.ScriptTarget.ES2022
  };
}

function expandAliasDefinitions(
  definitions: readonly ts.DefinitionInfo[] | undefined,
  service: ts.LanguageService
): readonly ts.DefinitionInfo[] | undefined {
  const program = service.getProgram();
  if (!definitions || !program) return definitions;
  const checker = program.getTypeChecker();

  return definitions.flatMap((definition) => {
    if (definition.kind !== ts.ScriptElementKind.alias) return [definition];
    const sourceFile = program.getSourceFile(definition.fileName);
    if (!sourceFile) return [];
    const token = tokenAtPosition(sourceFile, definition.textSpan.start);
    const symbol = checker.getSymbolAtLocation(token);
    if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) return [];

    const target = checker.getAliasedSymbol(symbol);
    const targetDefinitions = target.declarations?.map((declaration): ts.DefinitionInfo => {
      const nameNode = (declaration as ts.NamedDeclaration).name;
      const start = nameNode?.getStart() ?? declaration.getStart();
      const end = nameNode?.getEnd() ?? declaration.getEnd();
      return {
        fileName: declaration.getSourceFile().fileName,
        textSpan: { start, length: end - start },
        kind: definition.kind,
        name: target.getName(),
        containerKind: definition.containerKind,
        containerName: definition.containerName
      };
    });
    return targetDefinitions?.length ? targetDefinitions : [];
  });
}

function resultFromDefinitions(
  definitions: readonly ts.DefinitionInfo[] | undefined,
  kind: ReviewTypeDefinitionResult['kind'],
  service: ts.LanguageService,
  projectRoot: string,
  readFile: (fileName: string) => string | undefined
): ReviewTypeDefinitionResult | undefined {
  for (const definition of definitions ?? []) {
    const fileName = normalizePath(definition.fileName);
    if (!isContained(projectRoot, fileName)) continue;
    const contents = readFile(fileName);
    if (contents === undefined) continue;

    const sourceFile = service.getProgram()?.getSourceFile(fileName) ?? ts.createSourceFile(
      fileName,
      contents,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(fileName)
    );
    const declaration = enclosingDeclaration(sourceFile, definition.textSpan.start);
    const start = declaration?.getStart(sourceFile) ?? definition.textSpan.start;
    const end = declaration?.getEnd() ?? definition.textSpan.start + definition.textSpan.length;
    const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
    const endPosition = sourceFile.getLineAndCharacterOfPosition(end);

    return {
      name: definition.name,
      path: normalizeRelativePath(relative(projectRoot, fileName)),
      kind,
      declarationKind: declarationKind(declaration, definition.kind),
      start,
      end,
      startLine: startPosition.line + 1,
      startCharacter: startPosition.character,
      endLine: endPosition.line + 1,
      endCharacter: endPosition.character,
      snippetStartLine: startPosition.line + 1,
      snippetEndLine: endPosition.line + 1,
      snippet: contents.slice(start, end)
    };
  }
  return undefined;
}

function enclosingDeclaration(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
  let current: ts.Node | undefined = tokenAtPosition(sourceFile, position);
  while (current && current !== sourceFile) {
    if (ts.isVariableDeclaration(current)) {
      const statement = current.parent.parent;
      if (ts.isVariableStatement(statement)) return statement;
    }
    if (isUsefulDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function tokenAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node {
  let best: ts.Node = sourceFile;
  const visit = (node: ts.Node): void => {
    if (position < node.getFullStart() || position >= node.getEnd()) return;
    best = node;
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return best;
}

function isUsefulDeclaration(node: ts.Node): boolean {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) ||
    ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) ||
    ts.isMethodDeclaration(node) || ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function declarationKind(node: ts.Node | undefined, fallback: string): string {
  if (!node) return fallback;
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isVariableStatement(node)) return 'variable';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isModuleDeclaration(node)) return 'module';
  if (ts.isMethodDeclaration(node)) return 'method';
  if (ts.isMethodSignature(node)) return 'method';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
  if (ts.isGetAccessorDeclaration(node)) return 'getter';
  if (ts.isSetAccessorDeclaration(node)) return 'setter';
  return fallback;
}

function positionAt(sourceFile: ts.SourceFile, line: number, character: number): number | undefined {
  const starts = sourceFile.getLineStarts();
  const lineStart = starts[line - 1];
  if (lineStart === undefined) return undefined;
  const lineEnd = line < starts.length ? starts[line] - 1 : sourceFile.text.length;
  if (lineStart + character > lineEnd) return undefined;
  return lineStart + character;
}

function reviewPath(root: string, path: string): string | undefined {
  if (path.startsWith('/') || path.includes('\0')) return undefined;
  const candidate = normalizePath(resolve(root, path));
  return isContained(root, candidate) ? candidate : undefined;
}

function isContained(root: string, candidatePath: string): boolean {
  const candidate = normalizePath(candidatePath);
  const normalizedRoot = normalizePath(root);
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${sep}`);
}

function normalizePath(path: string): string {
  return resolve(path);
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/');
}

function isTypeScriptPath(path: string): boolean {
  return ['.ts', '.tsx', '.mts', '.cts'].includes(extname(path).toLowerCase());
}

function scriptKindForPath(path: string): ts.ScriptKind {
  return extname(path).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
