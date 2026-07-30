import path from 'node:path';

const ignoredIdentifiers = new Set([
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'data',
  'continue',
  'default',
  'delete',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'float',
  'for',
  'from',
  'function',
  'field',
  'fields',
  'if',
  'implements',
  'import',
  'interface',
  'item',
  'items',
  'name',
  'int',
  'let',
  'new',
  'null',
  'number',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'static',
  'string',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

const ignoredPathConcepts = new Set([
  'api',
  'app',
  'apps',
  'component',
  'components',
  'dto',
  'file',
  'files',
  'generated',
  'graphql',
  'gql',
  'index',
  'input',
  'lib',
  'model',
  'models',
  'module',
  'package',
  'packages',
  'repository',
  'resolver',
  'route',
  'routes',
  'schema',
  'service',
  'spec',
  'src',
  'test',
  'tests',
  'type',
  'types',
  'util',
  'utils'
]);

const graphqlWrapperWords = new Set([
  'args',
  'document',
  'fields',
  'fragment',
  'input',
  'key',
  'mutation',
  'output',
  'query',
  'resolver',
  'subscription',
  'type'
]);

const ignoredStorySignalWords = new Set([
  ...ignoredIdentifiers,
  'array',
  'async',
  'boolean',
  'class',
  'const',
  'date',
  'error',
  'event',
  'export',
  'false',
  'function',
  'id',
  'import',
  'interface',
  'null',
  'number',
  'object',
  'return',
  'schema',
  'state',
  'status',
  'string',
  'true',
  'type',
  'undefined',
  'value',
  'values',
  'void'
]);

export type ReviewRenameCandidate = {
  from: string;
  to: string;
  score: number;
};

export function extractReviewIdentifiers(value: string): Set<string> {
  const identifiers = new Set<string>();

  for (const match of value.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const identifier = match[0];

    if (identifier.length >= 3 && !ignoredIdentifiers.has(identifier.toLowerCase())) {
      identifiers.add(identifier);
    }
  }

  return identifiers;
}

export function extractReviewStorySignals(value: string): Set<string> {
  const signals = new Set<string>();

  for (const line of value.split('\n')) {
    for (const match of line.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
      const words = reviewSymbolWords(match[0]).filter(isStorySignalWord);
      addStorySignals(signals, words);
    }

    for (const match of line.matchAll(/[A-Za-z_$][\w$]*(?:[.:-][A-Za-z\d_$]+)+/g)) {
      addDelimitedStorySignals(signals, match[0]);
    }
  }

  return signals;
}

export function extractStructuredLiteralStorySignals(value: string): Set<string> {
  const signals = new Set<string>();

  for (const literal of value.matchAll(/["'`]([^"'`]*)["'`]/g)) {
    for (const token of literal[1]?.matchAll(/[A-Za-z_$][\w$]*(?:[.:-][A-Za-z\d_$]+)*/g) ?? []) {
      if (/[_:.-]/u.test(token[0])) {
        addDelimitedStorySignals(signals, token[0]);
      }
    }
  }

  return signals;
}

export function extractReviewRenameCandidates(
  deletedIdentifiers: ReadonlySet<string>,
  addedIdentifiers: ReadonlySet<string>
): ReviewRenameCandidate[] {
  const candidates: ReviewRenameCandidate[] = [];

  for (const from of deletedIdentifiers) {
    for (const to of addedIdentifiers) {
      const fromKey = normalizeReviewSymbol(from);
      const toKey = normalizeReviewSymbol(to);
      const fromWords = reviewSymbolWords(from);
      const toWords = reviewSymbolWords(to);

      if (!fromKey || !toKey || fromKey === toKey) {
        continue;
      }

      if (
        fromWords.length > 1 &&
        toWords.length > 1 &&
        fromWords.at(-1) !== toWords.at(-1) &&
        !isSymbolWordExtension(fromWords, toWords)
      ) {
        continue;
      }

      const score = reviewSymbolSimilarity(from, to);

      if (score >= 0.5) {
        candidates.push({ from, to, score });
      }
    }
  }

  return candidates.sort((left, right) =>
    right.score - left.score ||
    right.from.length + right.to.length - (left.from.length + left.to.length) ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to)
  );
}

function isSymbolWordExtension(left: string[], right: string[]): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  return shorter.length < longer.length &&
    shorter.every((word, index) => word === longer[index]);
}

export function normalizeReviewSymbol(value: string): string {
  return reviewSymbolWords(value).join(':');
}

export function reviewSymbolWords(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function reviewSymbolSimilarity(left: string, right: string): number {
  const leftWords = reviewSymbolWords(left);
  const rightWords = reviewSymbolWords(right);

  if (leftWords.length === 0 || rightWords.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftWords);
  const rightSet = new Set(rightWords);
  const sharedCount = [...leftSet].filter((word) => rightSet.has(word)).length;
  const longestSize = Math.max(leftSet.size, rightSet.size);
  const shortestSize = Math.min(leftSet.size, rightSet.size);
  const coverage = sharedCount / longestSize;
  const containment = sharedCount / shortestSize;
  const sameFirst = leftWords[0] === rightWords[0];
  const sameLast = leftWords.at(-1) === rightWords.at(-1);

  return Math.min(1, coverage * 0.7 + containment * 0.2 + (sameFirst ? 0.05 : 0) + (sameLast ? 0.05 : 0));
}

export function codeMatchesGraphqlSymbol(codeSymbol: string, graphqlSymbol: string): boolean {
  const codeWords = reviewSymbolWords(codeSymbol);
  const graphqlWords = reviewSymbolWords(graphqlSymbol);

  if (codeWords.join('') === graphqlWords.join('')) {
    return true;
  }

  if (graphqlWords.join('').length < 6 || graphqlWords.length > codeWords.length) {
    return false;
  }

  for (let start = 0; start <= codeWords.length - graphqlWords.length; start += 1) {
    if (!graphqlWords.every((word, offset) => codeWords[start + offset] === word)) {
      continue;
    }

    const extraWords = [...codeWords.slice(0, start), ...codeWords.slice(start + graphqlWords.length)];

    if (extraWords.length <= 1 || extraWords.every((word) => graphqlWrapperWords.has(word))) {
      return true;
    }
  }

  return false;
}

export function extractReviewPathConcepts(filePath: string): Set<string> {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const withoutExtension = normalizedPath.replace(/\.[^./]+$/, '');
  const concepts = new Set<string>();

  for (const word of reviewSymbolWords(withoutExtension)) {
    if (word.length >= 3 && !ignoredPathConcepts.has(word)) {
      concepts.add(word);
    }
  }

  return concepts;
}

export function isGeneratedReviewPath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const basename = path.posix.basename(normalizedPath);

  return (
    normalizedPath.split('/').some((segment) => segment === 'generated' || segment === '__generated__') ||
    /(?:^|[._-])generated(?:[._-]|$)/.test(basename) ||
    /\/(?:gql|graphql)\/sdk\.[^/]+$/.test(normalizedPath) ||
    /\/migrations\/meta\/\d+_snapshot\.json$/.test(normalizedPath) ||
    basename === 'schema.generated.graphql'
  );
}

function addStorySignals(signals: Set<string>, words: string[]): void {
  const distinctWords = [...new Set(words)];

  if (distinctWords.length === 1) {
    const word = distinctWords[0]!;

    if (word.length >= 5) {
      signals.add(`word:${word}`);
    }
    return;
  }

  if (distinctWords.length >= 2) {
    signals.add(`exact:${distinctWords.join(':')}`);
    addStoryWordPairs(signals, distinctWords);

    for (const word of distinctWords) {
      if (word.length >= 5) {
        signals.add(`word:${word}`);
      }
    }
  }
}

function addDelimitedStorySignals(signals: Set<string>, value: string): void {
  const words = reviewSymbolWords(value);
  addStorySignals(signals, words.filter(isStorySignalWord));

  if (
    value.includes('-') &&
    words.length >= 2 &&
    words[0]?.length === 1 &&
    words.slice(1).every(isStorySignalWord)
  ) {
    signals.add(`exact:${words.join(':')}`);
    addStoryWordPairs(signals, words);
  }
}

function addStoryWordPairs(signals: Set<string>, words: string[]): void {
  for (let leftIndex = 0; leftIndex < words.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < words.length; rightIndex += 1) {
      const left = words[leftIndex]!;
      const right = words[rightIndex]!;

      if (left !== right) {
        signals.add(`pair:${[left, right].sort().join(':')}`);
      }
    }
  }
}

function isStorySignalWord(word: string): boolean {
  return word.length >= 2 &&
    !/^\d+$/u.test(word) &&
    !ignoredStorySignalWords.has(word);
}
