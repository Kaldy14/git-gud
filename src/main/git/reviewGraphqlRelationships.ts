import path from 'node:path';

import { normalizeReviewSymbol, reviewSymbolWords } from './reviewRelationshipFacts';

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

const graphqlOwnerPattern = /^\s*(?:extend\s+)?(?:query|mutation|subscription|fragment|type|input|interface|enum|scalar|union)\s+([_A-Za-z][_0-9A-Za-z]*)\b/;
const graphqlFieldPattern = /^\s*([_A-Za-z][_0-9A-Za-z]*)\s*(?:\([^)]*\))?\s*(?::|\{)/;
const graphqlSpreadPattern = /^\s*\.\.\.([_A-Za-z][_0-9A-Za-z]*)\b/;

export type GraphqlReviewFacts = {
  symbols: string[];
  qualifiedSymbols: string[];
};

export type GraphqlReviewOwnerContext = {
  oldOwner?: string;
  newOwner?: string;
};

type GraphqlSourceLine = {
  text: string;
  changed: boolean;
};

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

export function extractGraphqlReviewFacts(
  bodyLines: string[],
  functionContext?: string,
  ownerContext?: GraphqlReviewOwnerContext
): GraphqlReviewFacts {
  const symbols = new Set<string>();
  const qualifiedSymbols = new Set<string>();

  collectGraphqlFacts(
    toGraphqlSource(bodyLines, 'old', functionContext),
    symbols,
    qualifiedSymbols,
    ownerContext?.oldOwner
  );
  collectGraphqlFacts(
    toGraphqlSource(bodyLines, 'new', functionContext),
    symbols,
    qualifiedSymbols,
    ownerContext?.newOwner
  );

  return { symbols: [...symbols], qualifiedSymbols: [...qualifiedSymbols] };
}

export function extractGraphqlOwnerAtLine(contents: string, lineNumber: number): string | undefined {
  const owners: Array<{ depth: number; symbol: string }> = [];
  let depth = 0;

  for (const line of contents.split(/\r?\n/).slice(0, Math.max(0, lineNumber - 1))) {
    const ownerMatch = graphqlOwnerPattern.exec(line.trim());

    if (ownerMatch?.[1] && line.includes('{')) {
      owners.push({ depth: depth + braceDelta(line), symbol: canonicalGraphqlSymbol(ownerMatch[1]) });
    }

    depth += braceDelta(line);

    while (owners.length > 0 && depth < owners.at(-1)!.depth) {
      owners.pop();
    }
  }

  return owners.at(-1)?.symbol;
}

export function identifierMatchesGraphqlSymbol(identifier: string, symbol: string): boolean {
  const identifierWords = reviewSymbolWords(identifier);
  const symbolWords = reviewSymbolWords(symbol);

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
  const leftWords = reviewSymbolWords(left);
  const rightWords = reviewSymbolWords(right);

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
  const words = reviewSymbolWords(value);
  return words.map((word, index) => index === 0 ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
}

function collectGraphqlFacts(
  lines: GraphqlSourceLine[],
  symbols: Set<string>,
  qualifiedSymbols: Set<string>,
  initialOwner?: string
): void {
  const owners: Array<{ depth: number; symbol: string }> = initialOwner
    ? [{ depth: 0, symbol: initialOwner }]
    : [];
  let depth = 0;

  for (const sourceLine of lines) {
    const line = sourceLine.text;
    const trimmed = line.trim();
    const ownerMatch = graphqlOwnerPattern.exec(trimmed);
    const spreadMatch = graphqlSpreadPattern.exec(trimmed);
    const fieldMatch = graphqlFieldPattern.exec(trimmed);
    const activeOwner = owners.at(-1)?.symbol;

    if (ownerMatch?.[1]) {
      const owner = canonicalGraphqlSymbol(ownerMatch[1]);

      if (sourceLine.changed) {
        addGraphqlSymbol(owner, symbols);
      }

      if (line.includes('{')) {
        owners.push({ depth: depth + braceDelta(line), symbol: owner });
      }
    } else if (sourceLine.changed && spreadMatch?.[1]) {
      addGraphqlSymbol(spreadMatch[1], symbols);
    } else if (sourceLine.changed && fieldMatch?.[1] && activeOwner) {
      const field = canonicalGraphqlSymbol(fieldMatch[1]);
      addGraphqlSymbol(activeOwner, symbols);
      addGraphqlSymbol(field, symbols);
      qualifiedSymbols.add(`${activeOwner}.${field}`);
    }

    depth += braceDelta(line);

    while (owners.length > 0 && depth < owners.at(-1)!.depth) {
      owners.pop();
    }
  }
}

function addGraphqlSymbol(value: string, symbols: Set<string>): void {
  const symbol = canonicalGraphqlSymbol(value);

  if (normalizeReviewSymbol(symbol).length >= 3 && !ignoredGraphqlSymbols.has(symbol)) {
    symbols.add(symbol);
  }
}

function toGraphqlSource(
  bodyLines: string[],
  side: 'old' | 'new',
  functionContext?: string
): GraphqlSourceLine[] {
  const lines: GraphqlSourceLine[] = functionContext
    ? [{ text: functionContext, changed: false }]
    : [];

  for (const line of bodyLines) {
    if (line.startsWith(' ')) {
      lines.push({ text: line.slice(1), changed: false });
    } else if (side === 'old' && line.startsWith('-') && !line.startsWith('---')) {
      lines.push({ text: line.slice(1), changed: true });
    } else if (side === 'new' && line.startsWith('+') && !line.startsWith('+++')) {
      lines.push({ text: line.slice(1), changed: true });
    }
  }

  return lines;
}

function braceDelta(value: string): number {
  let depth = 0;

  for (const character of value) {
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
  }

  return depth;
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
