import { isGraphqlReviewPath } from './reviewGraphqlRelationships';
import {
  codeMatchesGraphqlSymbol,
  normalizeReviewSymbol,
  reviewSymbolWords,
  type ReviewRenameCandidate
} from './reviewRelationshipFacts';
import {
  collectAcceptedRenames,
  selectPrimaryRename,
  selectRelationshipDisplay,
  type AcceptedRename
} from './reviewRenameRelationships';
import type { ReviewSyntaxIdentifier } from './reviewStructure';

export type ReviewRelationshipChunk = {
  id: string;
  path: string;
  category: 'source' | 'test' | 'spec';
  declarations: string[];
  enclosingSymbols: string[];
  graphqlSymbols: string[];
  graphqlQualifiedSymbols: string[];
  syntaxQualifiedSymbols: string[];
  syntaxIdentifiers: ReviewSyntaxIdentifier[];
  identifiers: Set<string>;
  renameCandidates: ReviewRenameCandidate[];
  pathConcepts: Set<string>;
  generated: boolean;
};

export type ReviewRelationshipGroup = {
  key: string;
  symbol: string;
  title: string;
  explanation: string;
  confidence: 'exact' | 'strong';
};

export type IndexedRelationshipGroup = ReviewRelationshipGroup & {
  primaryKey: string;
  aliasKeys: Set<string>;
  aliases: Set<string>;
  renameKeys: Set<string>;
  graphqlRelationship: boolean;
  relatedChunkCount: number;
};

export type ReviewRelationshipGroups = {
  groups: Map<string, IndexedRelationshipGroup>;
  occurrences: Map<string, Set<string>>;
};

type RelationshipMaps = {
  sourceDeclarations: Map<string, Set<string>>;
  sourceDeclarationNames: Map<string, Set<string>>;
  sourceEnclosing: Map<string, Set<string>>;
  sourceQualified: Map<string, Set<string>>;
  graphql: Map<string, Set<string>>;
  graphqlQualified: Map<string, Set<string>>;
  occurrences: Map<string, Set<string>>;
  displays: Map<string, Set<string>>;
};

const genericSymbols = new Set([
  'data',
  'description',
  'description:meta',
  'error',
  'errors',
  'field',
  'fields',
  'image',
  'item',
  'items',
  'keywords',
  'locale',
  'message',
  'name',
  'node',
  'nodes',
  'seo',
  'request',
  'response',
  'result',
  'state',
  'status',
  'title',
  'type',
  'value',
  'values'
]);

const genericSuffixes = new Set([
  'description',
  'image',
  'keywords',
  'locale',
  'request',
  'response',
  'result',
  'state',
  'status',
  'title',
  'value'
]);

export function buildReviewRelationshipGroups(chunks: ReviewRelationshipChunk[]): ReviewRelationshipGroups {
  const maps = collectRelationshipMaps(chunks);
  const structuralKeys = new Set([
    ...maps.sourceDeclarations.keys(),
    ...maps.sourceEnclosing.keys(),
    ...maps.sourceQualified.keys(),
    ...maps.graphql.keys(),
    ...maps.graphqlQualified.keys()
  ]);
  const acceptedRenames = collectAcceptedRenames(chunks, maps.displays, structuralKeys);
  const union = new SymbolUnion();
  const candidateKeys = new Set<string>();

  for (const source of [
    maps.sourceDeclarations,
    maps.sourceEnclosing,
    maps.sourceQualified,
    maps.graphql,
    maps.graphqlQualified
  ]) {
    for (const key of source.keys()) {
      candidateKeys.add(key);
      union.add(key);
    }
  }

  for (const rename of acceptedRenames) {
    candidateKeys.add(rename.fromKey);
    candidateKeys.add(rename.toKey);
    union.join(rename.fromKey, rename.toKey);
  }

  joinGraphqlCodeSymbols(
    union,
    maps,
    new Set(acceptedRenames.flatMap((rename) => [rename.fromKey, rename.toKey]))
  );

  const keysByRoot = new Map<string, Set<string>>();

  for (const key of candidateKeys) {
    const root = union.find(key);
    const keys = keysByRoot.get(root) ?? new Set<string>();
    keys.add(key);
    keysByRoot.set(root, keys);
  }

  return {
    groups: createGroups(chunks, maps, acceptedRenames, keysByRoot),
    occurrences: maps.occurrences
  };
}

function collectRelationshipMaps(chunks: ReviewRelationshipChunk[]): RelationshipMaps {
  const maps: RelationshipMaps = {
    sourceDeclarations: new Map(),
    sourceDeclarationNames: new Map(),
    sourceEnclosing: new Map(),
    sourceQualified: new Map(),
    graphql: new Map(),
    graphqlQualified: new Map(),
    occurrences: new Map(),
    displays: new Map()
  };

  for (const chunk of chunks) {
    addValues(maps.occurrences, maps.displays, chunk.identifiers, chunk.id);
    addValues(
      maps.occurrences,
      maps.displays,
      chunk.syntaxIdentifiers
        .filter((identifier) => identifier.role !== 'declaration' && identifier.role !== 'member')
        .flatMap((identifier) => identifier.qualifiedName ? [identifier.qualifiedName] : []),
      chunk.id
    );

    if (!chunk.generated) {
      addValues(maps.graphql, maps.displays, chunk.graphqlSymbols, chunk.id);
      addValues(maps.graphqlQualified, maps.displays, chunk.graphqlQualifiedSymbols, chunk.id);
      addValues(maps.sourceDeclarations, maps.displays, chunk.declarations, chunk.id);
      addNames(maps.sourceDeclarationNames, chunk.declarations);
      addValues(maps.sourceEnclosing, maps.displays, chunk.enclosingSymbols, chunk.id);
      addValues(maps.sourceQualified, maps.displays, chunk.syntaxQualifiedSymbols, chunk.id);
    }
  }

  return maps;
}

function createGroups(
  chunks: ReviewRelationshipChunk[],
  maps: RelationshipMaps,
  acceptedRenames: AcceptedRename[],
  keysByRoot: Map<string, Set<string>>
): Map<string, IndexedRelationshipGroup> {
  const groups = new Map<string, IndexedRelationshipGroup>();

  for (const aliasKeys of keysByRoot.values()) {
    const renames = acceptedRenames.filter((rename) => aliasKeys.has(rename.fromKey) && aliasKeys.has(rename.toKey));
    const sourceDeclarationIds = valuesForKeys(maps.sourceDeclarations, aliasKeys);
    const sourceEnclosingIds = valuesForKeys(maps.sourceEnclosing, aliasKeys);
    const sourceQualifiedIds = valuesForKeys(maps.sourceQualified, aliasKeys);
    const graphqlIds = new Set([
      ...valuesForKeys(maps.graphql, aliasKeys),
      ...valuesForKeys(maps.graphqlQualified, aliasKeys)
    ]);
    const occurrenceIds = valuesForKeys(maps.occurrences, aliasKeys);
    const relatedChunkCount = new Set([
      ...sourceDeclarationIds,
      ...sourceEnclosingIds,
      ...sourceQualifiedIds,
      ...graphqlIds,
      ...occurrenceIds
    ]).size;
    const anchorIds = new Set([
      ...sourceDeclarationIds,
      ...sourceEnclosingIds,
      ...sourceQualifiedIds,
      ...graphqlIds
    ]);
    const externalIds = new Set([...occurrenceIds].filter((id) => !anchorIds.has(id)));
    const sourceAnchorPaths = new Set(
      chunks
        .filter((chunk) =>
          sourceDeclarationIds.has(chunk.id) ||
          sourceEnclosingIds.has(chunk.id) ||
          sourceQualifiedIds.has(chunk.id)
        )
        .map((chunk) => chunk.path)
    );
    const hasRename = renames.length > 0;
    const ambiguousDeclarations = hasAmbiguousDeclarations(chunks, sourceDeclarationIds);
    const ambiguousIdentity = !hasRename && valuesForKeys(maps.sourceDeclarationNames, aliasKeys).size > 1;
    const graphqlExternalIds = collectGraphqlExternalIds(chunks, aliasKeys, graphqlIds);
    const hasUniqueSourceAnchor = sourceAnchorPaths.size === 1 &&
      !ambiguousDeclarations &&
      (sourceDeclarationIds.size > 0 || sourceQualifiedIds.size > 0 || externalIds.size > 0);
    const hasGraphqlRelationship = graphqlIds.size > 0 && graphqlExternalIds.size > 0;
    const primaryKey = selectPrimaryKey(aliasKeys, renames, maps);
    const tooGeneric = isOverlyGeneric(primaryKey, occurrenceIds.size, chunks.length);

    if (
      (!hasRename && !hasUniqueSourceAnchor && !hasGraphqlRelationship) ||
      ambiguousIdentity ||
      (tooGeneric && !hasRename && (
        (sourceDeclarationIds.size === 0 && sourceQualifiedIds.size === 0) || occurrenceIds.size > 4
      ))
    ) {
      continue;
    }

    const aliases = new Set([...aliasKeys].flatMap((key) => [...(maps.displays.get(key) ?? [])]));
    const rename = selectPrimaryRename(renames);
    const symbol = rename?.to ?? selectPrimaryDisplay(primaryKey, aliases, maps);
    const key = `relationship:${[...aliasKeys].sort().join('|')}`;

    groups.set(key, {
      key,
      symbol,
      title: rename ? `${rename.from} → ${rename.to}` : symbol,
      explanation: rename
        ? 'Detected rename with structural definition and reference evidence'
        : hasGraphqlRelationship
          ? 'Qualified GraphQL ownership and matching code references'
          : 'Declaration and matching references',
      confidence: rename ? 'exact' : 'strong',
      primaryKey,
      aliasKeys,
      aliases,
      renameKeys: new Set(renames.flatMap((candidate) => [candidate.fromKey, candidate.toKey])),
      graphqlRelationship: hasGraphqlRelationship,
      relatedChunkCount
    });
  }

  return groups;
}

function hasAmbiguousDeclarations(
  chunks: ReviewRelationshipChunk[],
  declarationIds: ReadonlySet<string>
): boolean {
  if (declarationIds.size <= 1) {
    return false;
  }

  const scopeKeys = chunks
    .filter((chunk) => declarationIds.has(chunk.id))
    .map((chunk) => normalizedScopeKey(chunk.enclosingSymbols));

  return scopeKeys.some((scope) => !scope) || new Set(scopeKeys).size > 1;
}

function normalizedScopeKey(symbols: Iterable<string>): string {
  return [...symbols].map(normalizeReviewSymbol).filter(Boolean).sort().join('|');
}

function collectGraphqlExternalIds(
  chunks: ReviewRelationshipChunk[],
  aliasKeys: ReadonlySet<string>,
  graphqlIds: ReadonlySet<string>
): Set<string> {
  if (graphqlIds.size === 0) {
    return new Set();
  }

  const aliases = [...aliasKeys].map((key) => key.replaceAll(':', ''));
  return new Set(
    chunks
      .filter((chunk) => !graphqlIds.has(chunk.id) && !isGraphqlReviewPath(chunk.path))
      .filter((chunk) =>
        [...chunk.identifiers, ...chunk.enclosingSymbols, ...chunk.syntaxQualifiedSymbols].some((identifier) =>
          aliases.some((alias) => codeMatchesGraphqlSymbol(identifier, alias))
        )
      )
      .map((chunk) => chunk.id)
  );
}

function selectPrimaryKey(
  aliasKeys: ReadonlySet<string>,
  renames: AcceptedRename[],
  maps: RelationshipMaps
): string {
  const primaryRename = selectPrimaryRename(renames);

  if (primaryRename) {
    return primaryRename.toKey;
  }

  const qualifiedCodeKey = [...aliasKeys]
    .filter((key) =>
      maps.graphqlQualified.has(key) &&
      (maps.sourceDeclarations.has(key) || maps.sourceEnclosing.has(key) || maps.sourceQualified.has(key))
    )
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0];

  if (qualifiedCodeKey) {
    return qualifiedCodeKey;
  }

  const graphqlKey = [...aliasKeys]
    .filter((key) => maps.graphql.has(key))
    .sort((left, right) =>
      reviewSymbolWords(left).length - reviewSymbolWords(right).length ||
      left.length - right.length ||
      left.localeCompare(right)
    )[0];

  if (graphqlKey) {
    return graphqlKey;
  }

  return [...aliasKeys].sort((left, right) =>
    (maps.displays.get(right)?.size ?? 0) - (maps.displays.get(left)?.size ?? 0) ||
    reviewSymbolWords(right).length - reviewSymbolWords(left).length ||
    right.length - left.length ||
    left.localeCompare(right)
  )[0]!;
}

function joinGraphqlCodeSymbols(
  union: SymbolUnion,
  maps: RelationshipMaps,
  protectedRenameKeys: ReadonlySet<string>
): void {
  const codeKeys = new Set([
    ...maps.sourceDeclarations.keys(),
    ...maps.sourceEnclosing.keys(),
    ...maps.sourceQualified.keys()
  ]);

  for (const graphqlKey of maps.graphql.keys()) {
    if (genericSymbols.has(graphqlKey)) {
      continue;
    }

    const graphqlDisplays = maps.displays.get(graphqlKey) ?? new Set([graphqlKey]);

    for (const codeKey of codeKeys) {
      if (
        graphqlKey !== codeKey &&
        (protectedRenameKeys.has(graphqlKey) || protectedRenameKeys.has(codeKey))
      ) {
        continue;
      }

      const graphqlWordCount = reviewSymbolWords(graphqlKey).length;
      const codeWordCount = reviewSymbolWords(codeKey).length;

      if (graphqlWordCount === 1 && codeWordCount - graphqlWordCount > 1) {
        continue;
      }

      const codeDisplays = maps.displays.get(codeKey) ?? new Set([codeKey]);
      const matches = [...codeDisplays].some((codeDisplay) =>
        [...graphqlDisplays].some((graphqlDisplay) => codeMatchesGraphqlSymbol(codeDisplay, graphqlDisplay))
      );

      if (matches) {
        union.join(graphqlKey, codeKey);
      }
    }
  }
}

function isOverlyGeneric(symbolKey: string, occurrenceCount: number, chunkCount: number): boolean {
  const words = reviewSymbolWords(symbolKey);
  return (
    genericSymbols.has(symbolKey) ||
    (words.length <= 2 && genericSuffixes.has(words.at(-1) ?? '') && occurrenceCount >= 12) ||
    (words.length <= 2 && occurrenceCount >= 8 && occurrenceCount / Math.max(chunkCount, 1) >= 0.15)
  );
}

function valuesForKeys(source: Map<string, Set<string>>, keys: ReadonlySet<string>): Set<string> {
  return new Set([...keys].flatMap((key) => [...(source.get(key) ?? [])]));
}

function addValues(
  target: Map<string, Set<string>>,
  displays: Map<string, Set<string>>,
  values: Iterable<string>,
  chunkId: string
): void {
  for (const value of values) {
    const key = normalizeReviewSymbol(value);

    if (!key) {
      continue;
    }

    const ids = target.get(key) ?? new Set<string>();
    const names = displays.get(key) ?? new Set<string>();
    ids.add(chunkId);
    names.add(value);
    target.set(key, ids);
    displays.set(key, names);
  }
}

function addNames(target: Map<string, Set<string>>, values: Iterable<string>): void {
  for (const value of values) {
    const key = normalizeReviewSymbol(value);

    if (!key) {
      continue;
    }

    const names = target.get(key) ?? new Set<string>();
    names.add(value);
    target.set(key, names);
  }
}

function selectPrimaryDisplay(
  primaryKey: string,
  displays: ReadonlySet<string>,
  maps: RelationshipMaps
): string {
  if (
    maps.sourceDeclarations.has(primaryKey) ||
    maps.sourceEnclosing.has(primaryKey) ||
    maps.sourceQualified.has(primaryKey)
  ) {
    return selectRelationshipDisplay(displays, primaryKey);
  }

  if (maps.graphql.has(primaryKey)) {
    return [...displays].sort((left, right) =>
      Number(/^[a-z]/.test(right)) - Number(/^[a-z]/.test(left)) ||
      left.length - right.length ||
      left.localeCompare(right)
    )[0] ?? selectRelationshipDisplay(displays, primaryKey);
  }

  return selectRelationshipDisplay(displays, primaryKey);
}

class SymbolUnion {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: string): string {
    this.add(value);
    const parent = this.parent.get(value)!;

    if (parent === value) {
      return value;
    }

    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  join(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);

    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}
