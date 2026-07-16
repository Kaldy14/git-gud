import { createRequire } from 'node:module';

import { Language, Parser, type Edit, type Tree } from 'web-tree-sitter';

import type { ReviewSyntaxLanguage } from './reviewStructure';

export type ReviewSyntaxCacheStats = {
  cacheHits: number;
  fullParses: number;
  incrementalParses: number;
};

export type ParsedReviewDocument = {
  contents: string;
  tree: Tree;
  sourceBytes: number;
};

type FileContext = {
  oldContents: string;
  newContents: string;
};

const require = createRequire(import.meta.url);
const parserInitialization = Parser.init({
  locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm')
});
const parserPromises = new Map<ReviewSyntaxLanguage, Promise<Parser>>();
const documentCache = new Map<string, ParsedReviewDocument>();
const DEFAULT_MAXIMUM_CACHED_DOCUMENTS = 32;
const DEFAULT_MAXIMUM_CACHED_SOURCE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_SYNTAX_CONTEXT_BYTES = 8 * 1024 * 1024;
let maximumCachedDocuments = DEFAULT_MAXIMUM_CACHED_DOCUMENTS;
let maximumCachedSourceBytes = DEFAULT_MAXIMUM_CACHED_SOURCE_BYTES;
let cachedSourceBytes = 0;
const cacheStats: ReviewSyntaxCacheStats = {
  cacheHits: 0,
  fullParses: 0,
  incrementalParses: 0
};

const grammarPaths: Record<ReviewSyntaxLanguage, string> = {
  javascript: '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm',
  jsx: '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm',
  typescript: '@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm',
  tsx: '@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm',
  graphql: 'tree-sitter-graphql-grammar-wasm/grammar.wasm'
};

export async function parseReviewDocuments(
  language: ReviewSyntaxLanguage,
  context: FileContext,
  documentKey: string
): Promise<{ oldDocument: ParsedReviewDocument; newDocument: ParsedReviewDocument }> {
  if (!canAnalyzeReviewSyntaxContext(context)) {
    throw new Error('Review context exceeds the Tree-sitter analysis limit.');
  }

  const parser = await parserForLanguage(language);
  const oldDocument = parseDocument(parser, `${documentKey}\0old`, context.oldContents);
  const newDocument = parseDocument(
    parser,
    `${documentKey}\0new`,
    context.newContents,
    oldDocument
  );

  return { oldDocument, newDocument };
}

export function canAnalyzeReviewSyntaxContext(context: FileContext): boolean {
  return Buffer.byteLength(context.oldContents) + Buffer.byteLength(context.newContents) <=
    MAXIMUM_SYNTAX_CONTEXT_BYTES;
}

export function reviewSyntaxLanguage(filePath: string): ReviewSyntaxLanguage | undefined {
  const normalizedPath = filePath.toLowerCase();

  if (/\.(?:graphql|gql)$/.test(normalizedPath)) {
    return 'graphql';
  }

  if (normalizedPath.endsWith('.tsx')) {
    return 'tsx';
  }

  if (normalizedPath.endsWith('.ts')) {
    return 'typescript';
  }

  if (normalizedPath.endsWith('.jsx')) {
    return 'jsx';
  }

  if (normalizedPath.endsWith('.js') || normalizedPath.endsWith('.mjs') || normalizedPath.endsWith('.cjs')) {
    return 'javascript';
  }

  return undefined;
}

export function reviewSyntaxCacheStatsForTests(): ReviewSyntaxCacheStats {
  return { ...cacheStats };
}

export function reviewSyntaxCacheUsageForTests(): { cachedDocuments: number; cachedSourceBytes: number } {
  return {
    cachedDocuments: documentCache.size,
    cachedSourceBytes
  };
}

export function setReviewSyntaxCacheLimitsForTests(limits: {
  maximumDocuments: number;
  maximumSourceBytes: number;
}): void {
  maximumCachedDocuments = Math.max(2, limits.maximumDocuments);
  maximumCachedSourceBytes = Math.max(1, limits.maximumSourceBytes);
  trimDocumentCache();
}

export function releaseReviewSyntaxDocument(documentKey: string): void {
  removeCacheEntry(`${documentKey}\0old`);
  removeCacheEntry(`${documentKey}\0new`);
}

export function clearReviewSyntaxCacheForRepository(repoPath: string): void {
  const prefix = `${repoPath}\0`;

  for (const key of [...documentCache.keys()]) {
    if (key.startsWith(prefix)) {
      removeCacheEntry(key);
    }
  }
}

export function clearReviewSyntaxCache(): void {
  for (const key of [...documentCache.keys()]) {
    removeCacheEntry(key);
  }
}

export function resetReviewSyntaxCacheForTests(): void {
  clearReviewSyntaxCache();
  maximumCachedDocuments = DEFAULT_MAXIMUM_CACHED_DOCUMENTS;
  maximumCachedSourceBytes = DEFAULT_MAXIMUM_CACHED_SOURCE_BYTES;
  cacheStats.cacheHits = 0;
  cacheStats.fullParses = 0;
  cacheStats.incrementalParses = 0;
}

async function parserForLanguage(language: ReviewSyntaxLanguage): Promise<Parser> {
  let parserPromise = parserPromises.get(language);

  if (!parserPromise) {
    parserPromise = createParser(language);
    parserPromises.set(language, parserPromise);
  }

  return parserPromise;
}

async function createParser(language: ReviewSyntaxLanguage): Promise<Parser> {
  await parserInitialization;
  const grammar = await Language.load(require.resolve(grammarPaths[language]));
  return new Parser().setLanguage(grammar);
}

function parseDocument(
  parser: Parser,
  cacheKey: string,
  contents: string,
  fallback?: ParsedReviewDocument
): ParsedReviewDocument {
  const cached = documentCache.get(cacheKey);

  if (cached?.contents === contents) {
    cacheStats.cacheHits += 1;
    refreshCacheEntry(cacheKey, cached);
    return cached;
  }

  const previous = cached ?? fallback;
  const oldTree = previous?.tree.copy();

  if (oldTree && previous) {
    oldTree.edit(createIncrementalEdit(previous.contents, contents));
    cacheStats.incrementalParses += 1;
  } else {
    cacheStats.fullParses += 1;
  }

  const tree = parser.parse(contents, oldTree) ?? parser.parse(contents);
  oldTree?.delete();

  if (!tree) {
    throw new Error('Tree-sitter did not produce a syntax tree.');
  }

  const document = { contents, tree, sourceBytes: estimatedSourceBytes(contents) };
  setCacheEntry(cacheKey, document);
  trimDocumentCache();
  return document;
}

function refreshCacheEntry(key: string, document: ParsedReviewDocument): void {
  documentCache.delete(key);
  documentCache.set(key, document);
}

function setCacheEntry(key: string, document: ParsedReviewDocument): void {
  removeCacheEntry(key);
  documentCache.set(key, document);
  cachedSourceBytes += document.sourceBytes;
}

function removeCacheEntry(key: string): void {
  const document = documentCache.get(key);

  if (!document) {
    return;
  }

  document.tree.delete();
  cachedSourceBytes = Math.max(0, cachedSourceBytes - document.sourceBytes);
  documentCache.delete(key);
}

function trimDocumentCache(): void {
  while (
    documentCache.size > maximumCachedDocuments ||
    cachedSourceBytes > maximumCachedSourceBytes
  ) {
    const oldestKey = documentCache.keys().next().value as string | undefined;

    if (!oldestKey) {
      return;
    }

    removeCacheEntry(oldestKey);
  }
}

function estimatedSourceBytes(contents: string): number {
  return Math.max(Buffer.byteLength(contents), contents.length * 2);
}

function createIncrementalEdit(oldContents: string, newContents: string): Edit {
  let start = commonPrefixLength(oldContents, newContents);
  start = safeUtf16Boundary(oldContents, start);
  let oldEnd = oldContents.length;
  let newEnd = newContents.length;

  while (
    oldEnd > start &&
    newEnd > start &&
    oldContents[oldEnd - 1] === newContents[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  oldEnd = safeUtf16Boundary(oldContents, oldEnd);
  newEnd = safeUtf16Boundary(newContents, newEnd);

  return {
    startIndex: Buffer.byteLength(oldContents.slice(0, start)),
    oldEndIndex: Buffer.byteLength(oldContents.slice(0, oldEnd)),
    newEndIndex: Buffer.byteLength(newContents.slice(0, newEnd)),
    startPosition: pointAt(oldContents, start),
    oldEndPosition: pointAt(oldContents, oldEnd),
    newEndPosition: pointAt(newContents, newEnd)
  };
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function safeUtf16Boundary(value: string, index: number): number {
  if (
    index > 0 &&
    index < value.length &&
    isHighSurrogate(value.charCodeAt(index - 1)) &&
    isLowSurrogate(value.charCodeAt(index))
  ) {
    return index - 1;
  }

  return index;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function pointAt(value: string, index: number): { row: number; column: number } {
  const prefix = value.slice(0, index);
  const lineStart = prefix.lastIndexOf('\n') + 1;

  return {
    row: countNewlines(prefix),
    column: Buffer.byteLength(prefix.slice(lineStart))
  };
}

function countNewlines(value: string): number {
  let count = 0;

  for (const character of value) {
    if (character === '\n') {
      count += 1;
    }
  }

  return count;
}
