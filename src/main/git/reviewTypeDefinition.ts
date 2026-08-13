import { extname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import type {
  GitReviewFileContext,
  GitReviewTypeDefinitionInput,
  GitReviewTypeDefinitionResult
} from '@shared/types';

export type ReviewTypeDefinitionFileContext = Pick<
  GitReviewFileContext,
  'newContents' | 'oldContents' | 'originalPath' | 'path'
>;

export interface ReviewTypeDefinitionInput extends Omit<
  GitReviewTypeDefinitionInput,
  'sourceFingerprint' | 'target'
> {
  files: readonly ReviewTypeDefinitionFileContext[];
}
export type ReviewTypeDefinitionResult = GitReviewTypeDefinitionResult;

const REVIEW_ROOT = resolve('/__git_gud_review_snapshot__');

/** Resolve a declaration exclusively from a main-process-owned review snapshot. */
export function resolveReviewTypeDefinition(
  input: ReviewTypeDefinitionInput
): ReviewTypeDefinitionResult | undefined {
  if (!Number.isInteger(input.line) || input.line < 1 ||
      !Number.isInteger(input.character) || input.character < 0) {
    return undefined;
  }

  const clickedPath = reviewPath(input.filePath);
  if (!clickedPath || !isTypeScriptPath(clickedPath)) return undefined;

  const snapshots = new Map<string, string>();
  for (const file of input.files) {
    const sidePath = input.side === 'old' ? file.originalPath ?? file.path : file.path;
    const filePath = reviewPath(sidePath);
    if (!filePath || !isTypeScriptPath(filePath)) continue;
    snapshots.set(filePath, input.side === 'old' ? file.oldContents : file.newContents);
  }

  const clickedContents = snapshots.get(clickedPath);
  if (clickedContents === undefined) return undefined;

  const service = ts.createLanguageService(
    createLanguageServiceHost(snapshots),
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
    const definitionResult = resultFromDefinitions(definitions, 'definition', service, snapshots);
    if (definitionResult) return definitionResult;

    return resultFromDefinitions(
      service.getTypeDefinitionAtPosition(clickedPath, position),
      'type-definition',
      service,
      snapshots
    );
  } finally {
    service.dispose();
  }
}

function createLanguageServiceHost(
  snapshots: ReadonlyMap<string, string>
): ts.LanguageServiceHost {
  const options: ts.CompilerOptions = {
    allowJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    target: ts.ScriptTarget.ES2022
  };

  return {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...snapshots.keys()],
    getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => {
      const contents = snapshots.get(normalizePath(fileName));
      return contents === undefined ? undefined : ts.ScriptSnapshot.fromString(contents);
    },
    getCurrentDirectory: () => REVIEW_ROOT,
    getDefaultLibFileName: () => resolve(REVIEW_ROOT, 'lib.d.ts'),
    fileExists: (fileName) => snapshots.has(normalizePath(fileName)),
    readFile: (fileName) => snapshots.get(normalizePath(fileName)),
    readDirectory: (directory, extensions) => [...snapshots.keys()].filter((fileName) =>
      isContained(directory, fileName) &&
      (!extensions?.length || extensions.includes(extname(fileName)))
    ),
    directoryExists: (directory) => [...snapshots.keys()].some((fileName) =>
      isContained(directory, fileName)
    ),
    getDirectories: () => [],
    realpath: normalizePath,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n'
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
    if (!sourceFile) return [definition];
    const token = tokenAtPosition(sourceFile, definition.textSpan.start);
    const symbol = checker.getSymbolAtLocation(token);
    if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) return [definition];

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
    return targetDefinitions?.length ? targetDefinitions : [definition];
  });
}

function resultFromDefinitions(
  definitions: readonly ts.DefinitionInfo[] | undefined,
  kind: ReviewTypeDefinitionResult['kind'],
  service: ts.LanguageService,
  snapshots: ReadonlyMap<string, string>
): ReviewTypeDefinitionResult | undefined {
  for (const definition of definitions ?? []) {
    const fileName = normalizePath(definition.fileName);
    const contents = snapshots.get(fileName);
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
      path: normalizeRelativePath(relative(REVIEW_ROOT, fileName)),
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
    ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) ||
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
  if (ts.isPropertyDeclaration(node)) return 'property';
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

function reviewPath(path: string): string | undefined {
  if (path.startsWith('/') || path.includes('\0')) return undefined;
  const candidate = normalizePath(resolve(REVIEW_ROOT, path));
  return isContained(REVIEW_ROOT, candidate) ? candidate : undefined;
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
