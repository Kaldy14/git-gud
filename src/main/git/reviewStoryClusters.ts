import { normalizeReviewSymbol, reviewSymbolWords } from './reviewRelationshipFacts';
import type { ReviewSyntaxIdentifier } from './reviewStructure';

export type ReviewStoryChunk = {
  id: string;
  path: string;
  declarations: string[];
  enclosingSymbols: string[];
  graphqlSymbols: string[];
  syntaxQualifiedSymbols: string[];
  syntaxIdentifiers: ReviewSyntaxIdentifier[];
  changedSyntaxIdentifiers: ReviewSyntaxIdentifier[];
  identifiers: Set<string>;
  changedIdentifiers: Set<string>;
  storySignals: Set<string>;
  structuralFingerprints: string[];
  pathConcepts: Set<string>;
  generated: boolean;
  category: 'source' | 'test' | 'spec';
  contentKind: 'code' | 'imports';
  changeType: 'added' | 'deleted' | 'modified';
};

export type ReviewStoryGroup = {
  key: string;
  kind: 'relationship' | 'file' | 'translations';
  symbols: string[];
  chunks: ReviewStoryChunk[];
};

export type ReviewStoryCluster = {
  key: string;
  groupKeys: string[];
};

type GroupFacts = {
  group: ReviewStoryGroup;
  paths: Set<string>;
  concepts: Set<string>;
  identifiers: Set<string>;
  storySignalCounts: Map<string, number>;
  storyChunkCount: number;
  structuralFingerprints: Set<string>;
  symbols: Set<string>;
  symbolWords: Set<string>;
  broadAcrossFeatures: boolean;
  proseOnly: boolean;
};

type StoryEdge = {
  left: string;
  right: string;
  score: number;
};

const ignoredStoryWords = new Set([
  'data',
  'admin',
  'authenticated',
  'client',
  'common',
  'config',
  'core',
  'description',
  'error',
  'field',
  'fields',
  'hub',
  'item',
  'items',
  'name',
  'node',
  'poc',
  'shared',
  'state',
  'status',
  'title',
  'type',
  'value',
  'values',
  'web'
]);

const maxStoryGroups = 8;
const maxStoryChunks = 40;
const maxStoryFiles = 25;

export function clusterReviewStories(groups: ReviewStoryGroup[]): ReviewStoryCluster[] {
  const facts = new Map(groups.map((group) => [group.key, collectGroupFacts(group)]));
  const union = new StoryUnion(groups.map((group) => group.key));
  const edges = collectStoryEdges([...facts.values()]);

  for (const edge of edges) {
    const leftKeys = union.members(edge.left);
    const rightKeys = union.members(edge.right);

    if (leftKeys.some((key) => rightKeys.includes(key))) {
      continue;
    }

    const combinedKeys = [...leftKeys, ...rightKeys];
    const combinedFacts = combinedKeys.map((key) => facts.get(key)!);
    const chunkIds = new Set(combinedFacts.flatMap((entry) => entry.group.chunks.map((chunk) => chunk.id)));
    const paths = new Set(combinedFacts.flatMap((entry) => entry.group.chunks.map((chunk) => chunk.path)));

    if (
      combinedKeys.length > maxStoryGroups ||
      chunkIds.size > maxStoryChunks ||
      paths.size > maxStoryFiles
    ) {
      continue;
    }

    union.join(edge.left, edge.right);
  }

  return union.groups().map((groupKeys) => ({
    key: groupKeys.length === 1 ? groupKeys[0]! : `story:${groupKeys.slice().sort().join('&')}`,
    groupKeys: groupKeys.slice().sort()
  }));
}

export function createReviewStoryTitle(groups: ReviewStoryGroup[], fallback: string): string {
  if (groups.length <= 1) {
    return fallback;
  }

  const conceptCounts = new Map<string, { count: number; firstSeen: number }>();
  let conceptSequence = 0;

  groups.forEach((group) => {
    const primaryChunks = group.chunks.filter((chunk) =>
      !chunk.generated &&
      chunk.category === 'source' &&
      chunk.contentKind === 'code' &&
      chunk.changeType !== 'deleted'
    );
    const concepts = new Set(primaryChunks.flatMap((chunk) => [...chunk.pathConcepts]));

    for (const concept of concepts) {
      if (ignoredStoryWords.has(concept)) {
        continue;
      }

      const current = conceptCounts.get(concept);
      conceptCounts.set(concept, {
        count: (current?.count ?? 0) + 1,
        firstSeen: current?.firstSeen ?? conceptSequence
      });
      conceptSequence += 1;
    }
  });

  const minimumCount = Math.max(2, Math.ceil(groups.length / 3));
  const concepts = [...conceptCounts.entries()]
    .filter(([, value]) => value.count >= minimumCount)
    .sort((left, right) =>
      right[1].count - left[1].count ||
      left[1].firstSeen - right[1].firstSeen ||
      left[0].localeCompare(right[0])
    )
    .slice(0, 3)
    .sort((left, right) => left[1].firstSeen - right[1].firstSeen || left[0].localeCompare(right[0]))
    .map(([concept]) => formatConcept(concept));

  return concepts.length >= 2 ? concepts.join(' ') : fallback;
}

function collectStoryEdges(groups: GroupFacts[]): StoryEdge[] {
  const edges: StoryEdge[] = [];

  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const left = groups[leftIndex]!;
      const right = groups[rightIndex]!;

      if (left.group.kind === 'translations' || right.group.kind === 'translations') {
        continue;
      }

      if (left.broadAcrossFeatures || right.broadAcrossFeatures) {
        continue;
      }

      const sharedPaths = intersectionSize(left.paths, right.paths);
      const sharedConcepts = intersectionSize(left.concepts, right.concepts);
      const sharedIdentifiers = intersectionSize(left.identifiers, right.identifiers);
      const sharedFingerprints = intersectionSize(left.structuralFingerprints, right.structuralFingerprints);
      const crossReferences = crossReferenceCount(left, right);
      const sharedStorySignals = collectSharedStorySignals(left, right);
      const distinctiveSharedWords = sharedStorySignals.words.filter((word) =>
        !left.concepts.has(word) || !right.concepts.has(word)
      );
      const bothRelationships =
        left.group.kind === 'relationship' &&
        right.group.kind === 'relationship';
      const relationshipSignalMatch = !bothRelationships ||
        sharedStorySignals.signals.some((signal) => {
          const signalWords = storySignalWords(signal);
          const commonSymbolWords = intersection(left.symbolWords, right.symbolWords);

          return signalWords.size > 1 && intersects(signalWords, new Set([
            ...left.symbolWords,
            ...right.symbolWords
          ])) && (
            [...signalWords].some((word) => !commonSymbolWords.has(word)) ||
            [...signalWords].some((word) =>
              !left.concepts.has(word) || !right.concepts.has(word)
            )
          );
        });
      const semanticSignalsCanMerge =
        !(left.proseOnly && right.proseOnly) &&
        relationshipSignalMatch &&
        (
          sharedFingerprints === 0 ||
          sharedConcepts > 0 ||
          crossReferences > 0
        );
      const focusedSameFiles =
        sharedPaths >= 2 &&
        left.paths.size === sharedPaths &&
        right.paths.size === sharedPaths &&
        sharedPaths <= 2 &&
        sharedConcepts >= 2;
      const shouldMerge =
        (semanticSignalsCanMerge && (
          sharedStorySignals.exact > 0 ||
          sharedStorySignals.pairs > 0 ||
          distinctiveSharedWords.length >= 2 ||
          (
            distinctiveSharedWords.length > 0 &&
            (
              sharedConcepts > 0 ||
              distinctiveSharedWords.some((word) =>
                left.symbolWords.has(word) || right.symbolWords.has(word)
              )
            )
          )
        )) ||
        focusedSameFiles ||
        (crossReferences > 0 && (sharedPaths > 0 || sharedConcepts > 0)) ||
        (sharedFingerprints > 0 && (sharedPaths > 0 || sharedConcepts > 0 || crossReferences > 0));

      if (!shouldMerge) {
        continue;
      }

      edges.push({
        left: left.group.key,
        right: right.group.key,
        score:
          sharedStorySignals.exact * 70 +
          sharedStorySignals.pairs * 50 +
          distinctiveSharedWords.length * 20 +
          sharedFingerprints * 25 +
          crossReferences * 20 +
          sharedPaths * 8 +
          sharedIdentifiers * 5 +
          sharedConcepts * 3
      });
    }
  }

  return edges.sort((left, right) =>
    right.score - left.score ||
    left.left.localeCompare(right.left) ||
    left.right.localeCompare(right.right)
  );
}

function collectGroupFacts(group: ReviewStoryGroup): GroupFacts {
  const relationshipChunks = group.chunks.filter((chunk) =>
    !chunk.generated &&
    chunk.category === 'source' &&
    chunk.contentKind === 'code' &&
    chunk.changeType !== 'deleted'
  );
  const evidenceChunks = relationshipChunks.length > 0 ? relationshipChunks : [];
  const storyChunks = group.chunks.filter((chunk) => !chunk.generated);
  const identifiers = normalizedValues(evidenceChunks.flatMap((chunk) => [
    ...chunk.declarations,
    ...chunk.enclosingSymbols,
    ...chunk.graphqlSymbols,
    ...chunk.syntaxQualifiedSymbols,
    ...chunk.changedIdentifiers
  ]));

  for (const word of ignoredStoryWords) {
    identifiers.delete(normalizeReviewSymbol(word));
  }

  const storyPaths = new Set(storyChunks.map((chunk) => chunk.path));
  const conceptPathCounts = new Map<string, Set<string>>();

  for (const chunk of storyChunks) {
    for (const concept of chunk.pathConcepts) {
      if (ignoredStoryWords.has(concept)) {
        continue;
      }

      const conceptPaths = conceptPathCounts.get(concept) ?? new Set<string>();
      conceptPaths.add(chunk.path);
      conceptPathCounts.set(concept, conceptPaths);
    }
  }

  const dominantConceptCoverage = Math.max(
    0,
    ...[...conceptPathCounts.values()].map((conceptPaths) => conceptPaths.size / Math.max(storyPaths.size, 1))
  );
  const storySignalCounts = new Map<string, number>();

  for (const chunk of storyChunks) {
    for (const signal of chunk.storySignals) {
      storySignalCounts.set(signal, (storySignalCounts.get(signal) ?? 0) + 1);
    }
  }

  return {
    group,
    paths: storyPaths,
    concepts: new Set(
      storyChunks.flatMap((chunk) =>
        [...chunk.pathConcepts].filter((concept) => !ignoredStoryWords.has(concept))
      )
    ),
    identifiers,
    storySignalCounts,
    storyChunkCount: storyChunks.length,
    structuralFingerprints: new Set(evidenceChunks.flatMap((chunk) => chunk.structuralFingerprints)),
    symbols: normalizedValues(group.symbols),
    symbolWords: new Set(group.symbols.flatMap(reviewSymbolWords)),
    broadAcrossFeatures:
      group.kind === 'relationship' &&
      storyPaths.size >= 12 &&
      dominantConceptCoverage < 0.7,
    proseOnly:
      storyChunks.length > 0 &&
      storyChunks.every((chunk) => isProseReviewPath(chunk.path))
  };
}

function collectSharedStorySignals(
  left: GroupFacts,
  right: GroupFacts
): {
  exact: number;
  pairs: number;
  words: string[];
  signals: string[];
} {
  let exact = 0;
  let pairs = 0;
  const words: string[] = [];
  const signals: string[] = [];

  for (const [signal, leftCount] of left.storySignalCounts) {
    const rightCount = right.storySignalCounts.get(signal);

    if (
      !rightCount ||
      !hasStorySignalCoverage(leftCount, left.storyChunkCount) ||
      !hasStorySignalCoverage(rightCount, right.storyChunkCount)
    ) {
      continue;
    }

    signals.push(signal);

    if (signal.startsWith('exact:')) {
      exact += 1;
    } else if (signal.startsWith('pair:')) {
      pairs += 1;
    } else if (signal.startsWith('word:')) {
      words.push(signal.slice('word:'.length));
    }
  }

  return { exact, pairs, words, signals };
}

function hasStorySignalCoverage(count: number, chunkCount: number): boolean {
  return chunkCount > 0 && count / chunkCount >= 0.5;
}

function isProseReviewPath(filePath: string): boolean {
  return /\.(?:adoc|md|mdx|rst|txt)$/iu.test(filePath);
}

function storySignalWords(signal: string): Set<string> {
  return new Set(signal.slice(signal.indexOf(':') + 1).split(':'));
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  return new Set([...smaller].filter((value) => larger.has(value)));
}

function crossReferenceCount(left: GroupFacts, right: GroupFacts): number {
  return Number(intersects(left.identifiers, right.symbols)) + Number(intersects(right.identifiers, left.symbols));
}

function normalizedValues(values: Iterable<string>): Set<string> {
  return new Set([...values].map(normalizeReviewSymbol).filter(Boolean));
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;

  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}

function formatConcept(value: string): string {
  return value === 'seo'
    ? 'SEO'
    : value === 'sdk'
      ? 'SDK'
      : value === 'graphql'
        ? 'GraphQL'
        : reviewSymbolWords(value).map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ');
}

class StoryUnion {
  private readonly parent = new Map<string, string>();

  constructor(keys: string[]) {
    for (const key of keys) {
      this.parent.set(key, key);
    }
  }

  find(key: string): string {
    const parent = this.parent.get(key) ?? key;

    if (parent === key) {
      return key;
    }

    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  join(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);

    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }

  members(key: string): string[] {
    const root = this.find(key);
    return [...this.parent.keys()].filter((candidate) => this.find(candidate) === root);
  }

  groups(): string[][] {
    const groups = new Map<string, string[]>();

    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const members = groups.get(root) ?? [];
      members.push(key);
      groups.set(root, members);
    }

    return [...groups.values()];
  }
}
