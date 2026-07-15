import path from 'node:path';

const ignoredGraphqlSymbols = new Set([
  'boolean',
  'data',
  'edge',
  'edges',
  'error',
  'errors',
  'float',
  'id',
  'int',
  'item',
  'items',
  'message',
  'mutation',
  'name',
  'node',
  'nodes',
  'pageInfo',
  'query',
  'status',
  'string',
  'subscription',
  'total',
  'value'
]);

const graphqlSymbolPatterns = [
  /^\s*(?:extend\s+)?(?:query|mutation|subscription|fragment|type|input|interface|enum|scalar|union)\s+([_A-Za-z][_0-9A-Za-z]*)\b/gm,
  /^\s*([_A-Za-z][_0-9A-Za-z]*)\s*(?:\([^)]*\))?\s*(?::|\{)/gm,
  /^\s*\.\.\.([_A-Za-z][_0-9A-Za-z]*)\b/gm
];

export function isGraphqlReviewPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.graphql' || extension === '.gql';
}

export function extractGraphqlSymbols(value: string): string[] {
  const symbols = new Set<string>();

  for (const pattern of graphqlSymbolPatterns) {
    pattern.lastIndex = 0;

    for (const match of value.matchAll(pattern)) {
      const symbol = match[1];
      const canonicalSymbol = symbol ? canonicalGraphqlSymbol(symbol) : '';

      if (canonicalSymbol.length >= 3 && !ignoredGraphqlSymbols.has(canonicalSymbol)) {
        symbols.add(canonicalSymbol);
      }
    }
  }

  return [...symbols];
}

export function identifierMatchesGraphqlSymbol(identifier: string, symbol: string): boolean {
  const identifierWords = splitIdentifierWords(identifier);
  const symbolWords = splitIdentifierWords(symbol);

  if (identifierWords.join('') === symbolWords.join('')) {
    return true;
  }

  if (symbolWords.join('').length < 6 || symbolWords.length > identifierWords.length) {
    return false;
  }

  return identifierWords.some((_, startIndex) =>
    symbolWords.every((word, offset) => identifierWords[startIndex + offset] === word)
  );
}

export function identifiersShareSymbolShape(left: string, right: string): boolean {
  const leftWords = splitIdentifierWords(left);
  const rightWords = splitIdentifierWords(right);

  if (leftWords.join('') === rightWords.join('')) {
    return true;
  }

  const [shorter, longer] = leftWords.length <= rightWords.length
    ? [leftWords, rightWords]
    : [rightWords, leftWords];

  return (
    shorter.length >= 3 &&
    longer.length - shorter.length <= 2 &&
    shorter[0] === longer[0] &&
    shorter.at(-1) === longer.at(-1) &&
    isSubsequence(shorter, longer)
  );
}

function canonicalGraphqlSymbol(value: string): string {
  const words = splitIdentifierWords(value);
  return words.map((word, index) => index === 0 ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
}

function splitIdentifierWords(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function isSubsequence(shorter: string[], longer: string[]): boolean {
  let shorterIndex = 0;

  for (const word of longer) {
    if (word === shorter[shorterIndex]) {
      shorterIndex += 1;
    }
  }

  return shorterIndex === shorter.length;
}
