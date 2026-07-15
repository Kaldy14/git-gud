import {
  identifierMatchesGraphqlSymbol,
  identifiersShareSymbolShape,
  isGraphqlReviewPath
} from './reviewGraphqlRelationships';

export type ReviewRelationshipChunk = {
  id: string;
  path: string;
  declarations: string[];
  enclosingSymbols: string[];
  graphqlSymbols: string[];
  identifiers: Set<string>;
};

type SymbolAnchor = {
  anchorIds: Set<string>;
  relatedIds: Set<string>;
  graphqlRelationship?: boolean;
};

export type SymbolAnchorIndex = {
  anchors: Map<string, SymbolAnchor>;
  preferredSymbolsByChunkId: Map<string, string>;
};

export function collectSymbolAnchors(chunks: ReviewRelationshipChunk[]): SymbolAnchorIndex {
  const declarations = new Map<string, Set<string>>();
  const enclosingOccurrences = new Map<string, Set<string>>();
  const graphqlAnchors = new Map<string, Set<string>>();
  const occurrences = new Map<string, Set<string>>();

  for (const chunk of chunks) {
    addValues(occurrences, chunk.identifiers, chunk.id);
    addValues(declarations, chunk.declarations, chunk.id);
    addValues(enclosingOccurrences, chunk.enclosingSymbols, chunk.id);
    addValues(graphqlAnchors, chunk.graphqlSymbols, chunk.id);
  }

  const anchors = collectDeclarationAnchors(declarations, occurrences);
  addEnclosingAnchors(anchors, declarations, enclosingOccurrences, occurrences, chunks);
  addGraphqlAnchors(anchors, declarations, graphqlAnchors, chunks);

  const preferredSymbolsByChunkId = linkEnclosingAnchorsToRenameGroups(
    anchors,
    declarations,
    enclosingOccurrences,
    occurrences
  );

  return { anchors, preferredSymbolsByChunkId };
}

export function selectChunkSymbol(
  chunk: ReviewRelationshipChunk,
  index: SymbolAnchorIndex
): string | undefined {
  const graphqlChunk = isGraphqlReviewPath(chunk.path);
  const candidates = [...index.anchors.entries()]
    .filter(([symbol, anchor]) =>
      anchor.anchorIds.has(chunk.id) ||
      (!graphqlChunk && (chunk.identifiers.has(symbol) || chunk.enclosingSymbols.includes(symbol))) ||
      (graphqlChunk && chunk.graphqlSymbols.includes(symbol)) ||
      (anchor.graphqlRelationship && chunkMatchesGraphqlSymbol(chunk, symbol))
    )
    .map(([symbol]) => symbol)
    .sort((left, right) => {
      const leftAnchor = index.anchors.get(left)!;
      const rightAnchor = index.anchors.get(right)!;
      const preferredSymbol = index.preferredSymbolsByChunkId.get(chunk.id);
      const leftPreferred = preferredSymbol === left ? 1 : 0;
      const rightPreferred = preferredSymbol === right ? 1 : 0;
      const leftDeclaredHere = leftAnchor.anchorIds.has(chunk.id) ? 1 : 0;
      const rightDeclaredHere = rightAnchor.anchorIds.has(chunk.id) ? 1 : 0;

      return (
        rightPreferred - leftPreferred ||
        rightAnchor.relatedIds.size - leftAnchor.relatedIds.size ||
        rightDeclaredHere - leftDeclaredHere ||
        right.length - left.length ||
        left.localeCompare(right)
      );
    });

  return candidates[0];
}

export function getSymbolAnchorIds(index: SymbolAnchorIndex, symbol: string): ReadonlySet<string> {
  return index.anchors.get(symbol)?.anchorIds ?? new Set<string>();
}

function collectDeclarationAnchors(
  declarations: Map<string, Set<string>>,
  occurrences: Map<string, Set<string>>
): Map<string, SymbolAnchor> {
  return new Map(
    [...declarations.entries()]
      .filter(([, anchorIds]) => anchorIds.size === 1)
      .map(([symbol, anchorIds]) => [
        symbol,
        {
          anchorIds: new Set(anchorIds),
          relatedIds: new Set([...anchorIds, ...(occurrences.get(symbol) ?? [])])
        }
      ])
  );
}

function addEnclosingAnchors(
  anchors: Map<string, SymbolAnchor>,
  declarations: Map<string, Set<string>>,
  enclosingOccurrences: Map<string, Set<string>>,
  occurrences: Map<string, Set<string>>,
  chunks: ReviewRelationshipChunk[]
): void {
  for (const [symbol, enclosingIds] of enclosingOccurrences) {
    const declarationIds = declarations.get(symbol);

    if (declarationIds && declarationIds.size > 1) {
      continue;
    }

    const anchorIds = new Set([...enclosingIds, ...(declarationIds ?? [])]);
    const anchorPaths = new Set(
      chunks.filter((chunk) => anchorIds.has(chunk.id)).map((chunk) => chunk.path)
    );
    const occurrenceIds = occurrences.get(symbol) ?? new Set<string>();
    const hasExternalUsage = [...occurrenceIds].some((id) => !anchorIds.has(id));

    if (anchorPaths.size !== 1 || !hasExternalUsage) {
      continue;
    }

    anchors.set(symbol, {
      anchorIds,
      relatedIds: new Set([...anchorIds, ...occurrenceIds])
    });
  }
}

function addGraphqlAnchors(
  anchors: Map<string, SymbolAnchor>,
  declarations: Map<string, Set<string>>,
  graphqlAnchors: Map<string, Set<string>>,
  chunks: ReviewRelationshipChunk[]
): void {
  for (const [symbol, graphqlIds] of graphqlAnchors) {
    const declarationIds = declarations.get(symbol);

    if (declarationIds && declarationIds.size > 1) {
      continue;
    }

    const relatedIds = new Set(graphqlIds);

    for (const chunk of chunks) {
      if (!isGraphqlReviewPath(chunk.path) && chunkMatchesGraphqlSymbol(chunk, symbol)) {
        relatedIds.add(chunk.id);
      }
    }

    if (relatedIds.size === graphqlIds.size) {
      continue;
    }

    anchors.set(symbol, {
      anchorIds: new Set([...graphqlIds, ...(declarationIds ?? [])]),
      relatedIds,
      graphqlRelationship: true
    });
  }
}

function linkEnclosingAnchorsToRenameGroups(
  anchors: Map<string, SymbolAnchor>,
  declarations: Map<string, Set<string>>,
  enclosingOccurrences: Map<string, Set<string>>,
  occurrences: Map<string, Set<string>>
): Map<string, string> {
  const preferredSymbolsByChunkId = new Map<string, string>();

  for (const [symbol, enclosingIds] of enclosingOccurrences) {
    const definitionIds = new Set([...enclosingIds, ...(declarations.get(symbol) ?? [])]);
    const externalUsageIds = new Set(
      [...(occurrences.get(symbol) ?? [])].filter((id) => !definitionIds.has(id))
    );

    if (externalUsageIds.size < 2) {
      continue;
    }

    const candidates = [...anchors.entries()]
      .filter(([candidate]) => candidate !== symbol && identifiersShareSymbolShape(symbol, candidate))
      .map(([candidate, anchor]) => ({
        anchor,
        candidate,
        overlap: intersectionSize(externalUsageIds, anchor.relatedIds)
      }))
      .filter(({ overlap }) => overlap >= 2 && overlap / externalUsageIds.size >= 0.5)
      .sort((left, right) =>
        right.overlap - left.overlap ||
        right.anchor.relatedIds.size - left.anchor.relatedIds.size ||
        Number(Boolean(right.anchor.graphqlRelationship)) - Number(Boolean(left.anchor.graphqlRelationship)) ||
        right.candidate.length - left.candidate.length ||
        left.candidate.localeCompare(right.candidate)
      );
    const preferred = candidates[0];

    if (!preferred) {
      continue;
    }

    for (const id of externalUsageIds) {
      if (preferred.anchor.relatedIds.has(id)) {
        preferredSymbolsByChunkId.set(id, preferred.candidate);
      }
    }

    for (const id of definitionIds) {
      preferred.anchor.anchorIds.add(id);
      preferred.anchor.relatedIds.add(id);
      preferredSymbolsByChunkId.set(id, preferred.candidate);
    }
  }

  return preferredSymbolsByChunkId;
}

function chunkMatchesGraphqlSymbol(chunk: ReviewRelationshipChunk, symbol: string): boolean {
  return (
    chunk.graphqlSymbols.includes(symbol) ||
    [...chunk.identifiers, ...chunk.enclosingSymbols].some((identifier) =>
      identifierMatchesGraphqlSymbol(identifier, symbol)
    )
  );
}

function addValues(
  target: Map<string, Set<string>>,
  values: Iterable<string>,
  chunkId: string
): void {
  for (const value of values) {
    const ids = target.get(value) ?? new Set<string>();
    ids.add(chunkId);
    target.set(value, ids);
  }
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;

  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}
