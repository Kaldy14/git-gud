import { isGraphqlReviewPath } from './reviewGraphqlRelationships';
import {
  buildReviewRelationshipGroups,
  type IndexedRelationshipGroup,
  type ReviewRelationshipChunk,
  type ReviewRelationshipGroup
} from './reviewRelationshipGroups';
import {
  codeMatchesGraphqlSymbol,
  normalizeReviewSymbol,
  reviewSymbolWords
} from './reviewRelationshipFacts';
import type { ReviewSyntaxIdentifier, ReviewSyntaxIdentifierRole } from './reviewStructure';

export type { ReviewRelationshipChunk, ReviewRelationshipGroup } from './reviewRelationshipGroups';

export type ReviewGroupSelection = {
  group: ReviewRelationshipGroup;
  role: 'anchor' | 'usage';
  relationship: string;
};

export type SymbolAnchorIndex = {
  selectionsByChunkId: Map<string, ReviewGroupSelection>;
};

type ScoredGroup = {
  group: IndexedRelationshipGroup;
  score: number;
  evidenceRank: number;
  role: ReviewGroupSelection['role'];
  relationship: string;
};

const minimumRelationshipScore = 48;

export function collectSymbolAnchors(chunks: ReviewRelationshipChunk[]): SymbolAnchorIndex {
  const { groups, occurrences } = buildReviewRelationshipGroups(chunks);
  const selectionsByChunkId = new Map<string, ReviewGroupSelection>();

  for (const chunk of chunks) {
    const selection = selectBestGroup(chunk, groups, occurrences);

    if (selection) {
      selectionsByChunkId.set(chunk.id, selection);
    }
  }

  return { selectionsByChunkId };
}

export function selectChunkReviewGroup(
  chunk: ReviewRelationshipChunk,
  index: SymbolAnchorIndex
): ReviewGroupSelection | undefined {
  return index.selectionsByChunkId.get(chunk.id);
}

function selectBestGroup(
  chunk: ReviewRelationshipChunk,
  groups: Map<string, IndexedRelationshipGroup>,
  occurrences: Map<string, Set<string>>
): ReviewGroupSelection | undefined {
  const candidates = [...groups.values()]
    .map((group) => scoreChunkForGroup(chunk, group, occurrences))
    .filter((candidate): candidate is ScoredGroup => candidate !== undefined)
    .sort((left, right) =>
      right.evidenceRank - left.evidenceRank ||
      right.group.relatedChunkCount - left.group.relatedChunkCount ||
      right.score - left.score ||
      right.group.aliasKeys.size - left.group.aliasKeys.size ||
      right.group.symbol.length - left.group.symbol.length ||
      left.group.title.localeCompare(right.group.title)
    );
  let best = candidates[0];

  if (best && chunk.category !== 'source') {
    const broaderProductionRelationship = candidates
      .filter((candidate) =>
        candidate.score >= minimumRelationshipScore &&
        candidate.group.relatedChunkCount > best!.group.relatedChunkCount
      )
      .sort((left, right) =>
        right.group.relatedChunkCount - left.group.relatedChunkCount ||
        right.evidenceRank - left.evidenceRank ||
        right.score - left.score ||
        left.group.title.localeCompare(right.group.title)
      )[0];

    if (broaderProductionRelationship) {
      best = broaderProductionRelationship;
    }
  }

  if (best?.role === 'anchor' && best.group.renameKeys.size === 0) {
    const broaderReference = candidates
      .filter((candidate) =>
        candidate.role === 'usage' &&
        candidate.evidenceRank >= 2 &&
        candidate.group.relatedChunkCount > best!.group.relatedChunkCount
      )
      .sort((left, right) =>
        right.group.relatedChunkCount - left.group.relatedChunkCount ||
        right.evidenceRank - left.evidenceRank ||
        right.score - left.score ||
        left.group.title.localeCompare(right.group.title)
      )[0];

    if (broaderReference) {
      best = broaderReference;
    }
  }

  const next = candidates[1];

  if (!best || best.score < minimumRelationshipScore) {
    return undefined;
  }

  if (
    next &&
    next.group.key !== best.group.key &&
    best.evidenceRank === next.evidenceRank &&
    best.group.relatedChunkCount === next.group.relatedChunkCount &&
    best.score - next.score < 10
  ) {
    return undefined;
  }

  return {
    group: best.group,
    role: best.role,
    relationship: best.relationship
  };
}

function scoreChunkForGroup(
  chunk: ReviewRelationshipChunk,
  group: IndexedRelationshipGroup,
  occurrences: Map<string, Set<string>>
): ScoredGroup | undefined {
  const declarationKeys = normalizedValues(chunk.declarations);
  const enclosingKeys = normalizedValues(chunk.enclosingSymbols);
  const qualifiedCodeKeys = normalizedValues(chunk.syntaxQualifiedSymbols);
  const graphqlKeys = normalizedValues(chunk.graphqlSymbols);
  const qualifiedGraphqlKeys = normalizedValues(chunk.graphqlQualifiedSymbols);
  const identifierKeys = normalizedValues(chunk.identifiers);
  const renamedHere = chunk.renameCandidates.some((rename) =>
    group.renameKeys.has(normalizeReviewSymbol(rename.from)) &&
    group.renameKeys.has(normalizeReviewSymbol(rename.to))
  );
  const declares = intersects(declarationKeys, group.aliasKeys);
  const encloses = intersects(enclosingKeys, group.aliasKeys);
  const qualifiedCode = intersects(qualifiedCodeKeys, group.aliasKeys);
  const definesPrimary = declarationKeys.has(group.primaryKey) ||
    enclosingKeys.has(group.primaryKey) ||
    qualifiedCodeKeys.has(group.primaryKey);
  const definesRename = intersects(declarationKeys, group.renameKeys) ||
    intersects(enclosingKeys, group.renameKeys) ||
    intersects(qualifiedCodeKeys, group.renameKeys);
  const qualifiedGraphql = intersects(qualifiedGraphqlKeys, group.aliasKeys);
  const graphql = intersects(graphqlKeys, group.aliasKeys);
  const exactIdentifierKeys = isGraphqlReviewPath(chunk.path)
    ? new Set<string>()
    : intersection(identifierKeys, group.aliasKeys);
  const syntaxRole = strongestMatchingSyntaxRole(chunk.syntaxIdentifiers, group.aliasKeys);
  let score = 0;
  let evidenceRank = 0;
  let role: ReviewGroupSelection['role'] = 'usage';
  let relationship = `References ${group.symbol}`;

  if (renamedHere) {
    score = 130;
    evidenceRank = 4;
    relationship = `Renames ${group.title}`;
  }

  if (declares || encloses) {
    const isDefinition = !chunk.generated && (definesPrimary || definesRename);
    score = Math.max(score, chunk.generated ? 92 : isDefinition ? (declares ? 120 : 110) : 96);
    evidenceRank = Math.max(evidenceRank, isDefinition ? 4 : 3);
    role = isDefinition ? 'anchor' : 'usage';
    relationship = chunk.generated
      ? `Generated from ${group.symbol}`
      : isDefinition && declares
        ? `Defines ${group.symbol}`
        : isDefinition
          ? `Changes ${group.symbol}`
          : `References ${group.symbol}`;
  }

  if (qualifiedCode) {
    const isDefinition = !chunk.generated && (definesPrimary || definesRename);
    score = Math.max(score, isDefinition ? 115 : 98);
    evidenceRank = Math.max(evidenceRank, isDefinition ? 4 : 3);
    role = isDefinition ? 'anchor' : 'usage';
    relationship = isDefinition
      ? `Changes scoped symbol ${group.symbol}`
      : `References scoped symbol ${group.symbol}`;
  }

  if (syntaxRole) {
    const isDefinition = syntaxRole === 'declaration' || syntaxRole === 'member';
    const roleScore = syntaxRoleScore(syntaxRole);
    score = Math.max(score, chunk.generated ? Math.min(roleScore, 92) : roleScore);
    evidenceRank = Math.max(evidenceRank, isDefinition ? 4 : syntaxRole === 'import' ? 2 : 3);
    role = !chunk.generated && isDefinition ? 'anchor' : 'usage';
    relationship = chunk.generated
      ? `Generated from ${group.symbol}`
      : syntaxRoleRelationship(syntaxRole, group.symbol);
  }

  if (qualifiedGraphql) {
    score = Math.max(score, chunk.generated ? 92 : 105);
    evidenceRank = Math.max(evidenceRank, chunk.generated ? 3 : 4);
    role = chunk.generated ? 'usage' : 'anchor';
    relationship = chunk.generated
      ? `Generated from ${group.symbol}`
      : `Changes GraphQL owner ${group.symbol}`;
  } else if (graphql) {
    score = Math.max(score, chunk.generated ? 76 : 82);
    evidenceRank = Math.max(evidenceRank, 3);
    role = chunk.generated ? 'usage' : 'anchor';
    relationship = chunk.generated
      ? `Generated from ${group.symbol}`
      : `Changes GraphQL symbol ${group.symbol}`;
  }

  for (const key of exactIdentifierKeys) {
    const frequency = occurrences.get(key)?.size ?? 1;
    const exactScore = group.renameKeys.has(key) ? 50 : Math.max(42, 70 - frequency * 2);

    score = Math.max(score, exactScore);
    evidenceRank = Math.max(evidenceRank, group.renameKeys.has(key) ? 1 : 2);
  }

  if (
    group.graphqlRelationship &&
    group.renameKeys.size === 0 &&
    score < 82 &&
    chunkMatchesGraphqlGroup(chunk, group)
  ) {
    score = Math.max(score, 58);
    evidenceRank = Math.max(evidenceRank, 2);
    relationship = `Matches qualified GraphQL symbol ${group.symbol}`;
  }

  if (score >= minimumRelationshipScore) {
    const symbolWords = new Set(reviewSymbolWords(group.symbol));
    const pathOverlap = [...chunk.pathConcepts].filter((concept) => symbolWords.has(concept)).length;
    score += Math.min(8, pathOverlap * 3);
  }

  return score > 0 ? { group, score, evidenceRank, role, relationship } : undefined;
}

function chunkMatchesGraphqlGroup(
  chunk: ReviewRelationshipChunk,
  group: IndexedRelationshipGroup
): boolean {
  return [...chunk.identifiers, ...chunk.enclosingSymbols, ...chunk.syntaxQualifiedSymbols].some((identifier) =>
    [...group.aliases].some((alias) => codeMatchesGraphqlSymbol(identifier, alias))
  );
}

function normalizedValues(values: Iterable<string>): Set<string> {
  return new Set([...values].map(normalizeReviewSymbol).filter(Boolean));
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([...left].filter((value) => right.has(value)));
}

function strongestMatchingSyntaxRole(
  identifiers: readonly ReviewSyntaxIdentifier[],
  aliases: ReadonlySet<string>
): ReviewSyntaxIdentifierRole | undefined {
  return identifiers
    .filter((identifier) =>
      aliases.has(normalizeReviewSymbol(identifier.qualifiedName ?? '')) ||
      aliases.has(normalizeReviewSymbol(identifier.name))
    )
    .map((identifier) => identifier.role)
    .sort((left, right) => syntaxRoleRank(left) - syntaxRoleRank(right))[0];
}

function syntaxRoleRank(role: ReviewSyntaxIdentifierRole): number {
  return role === 'declaration'
    ? 0
    : role === 'member'
      ? 1
      : role === 'type-reference'
        ? 2
        : role === 'decorator'
          ? 3
          : role === 'call'
            ? 4
            : role === 'reference'
              ? 5
              : 6;
}

function syntaxRoleScore(role: ReviewSyntaxIdentifierRole): number {
  return role === 'declaration'
    ? 120
    : role === 'member'
      ? 115
      : role === 'type-reference'
        ? 80
        : role === 'decorator'
          ? 76
          : role === 'call'
            ? 74
            : role === 'reference'
              ? 70
              : 58;
}

function syntaxRoleRelationship(role: ReviewSyntaxIdentifierRole, symbol: string): string {
  return role === 'declaration'
    ? `Defines ${symbol}`
    : role === 'member'
      ? `Changes member ${symbol}`
      : role === 'type-reference'
        ? `Uses type ${symbol}`
        : role === 'decorator'
          ? `Uses decorator ${symbol}`
          : role === 'call'
            ? `Calls ${symbol}`
            : role === 'import'
              ? `Imports ${symbol}`
              : `References ${symbol}`;
}
