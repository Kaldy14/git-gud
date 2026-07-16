import { normalizeReviewSymbol, type ReviewRenameCandidate } from './reviewRelationshipFacts';

type RenameRelationshipChunk = {
  id: string;
  renameCandidates: ReviewRenameCandidate[];
};

export type AcceptedRename = {
  fromKey: string;
  toKey: string;
  from: string;
  to: string;
  chunkIds: Set<string>;
  strength: number;
};

export function collectAcceptedRenames(
  chunks: RenameRelationshipChunk[],
  displays: Map<string, Set<string>>,
  structuralKeys: ReadonlySet<string>
): AcceptedRename[] {
  const candidates = new Map<string, {
    fromKey: string;
    toKey: string;
    fromDisplays: Set<string>;
    toDisplays: Set<string>;
    chunkIds: Set<string>;
    maxScore: number;
    totalScore: number;
    count: number;
  }>();

  for (const chunk of chunks) {
    for (const rename of chunk.renameCandidates) {
      const fromKey = normalizeReviewSymbol(rename.from);
      const toKey = normalizeReviewSymbol(rename.to);
      const key = `${fromKey}\0${toKey}`;
      const candidate = candidates.get(key) ?? {
        fromKey,
        toKey,
        fromDisplays: new Set<string>(),
        toDisplays: new Set<string>(),
        chunkIds: new Set<string>(),
        maxScore: 0,
        totalScore: 0,
        count: 0
      };

      candidate.fromDisplays.add(rename.from);
      candidate.toDisplays.add(rename.to);
      candidate.chunkIds.add(chunk.id);
      candidate.maxScore = Math.max(candidate.maxScore, rename.score);
      candidate.totalScore += rename.score;
      candidate.count += 1;
      candidates.set(key, candidate);
    }
  }

  const accepted = [...candidates.values()]
    .filter((candidate) =>
      structuralKeys.has(candidate.fromKey) &&
      structuralKeys.has(candidate.toKey) &&
      (
        candidate.maxScore >= 0.68 ||
        (candidate.chunkIds.size >= 2 && candidate.totalScore / candidate.count >= 0.68)
      )
    )
    .map((candidate) => {
      const fromDisplays = new Set([...(displays.get(candidate.fromKey) ?? []), ...candidate.fromDisplays]);
      const toDisplays = new Set([...(displays.get(candidate.toKey) ?? []), ...candidate.toDisplays]);

      return {
        fromKey: candidate.fromKey,
        toKey: candidate.toKey,
        from: selectRelationshipDisplay(fromDisplays, candidate.fromKey),
        to: selectRelationshipDisplay(toDisplays, candidate.toKey),
        chunkIds: candidate.chunkIds,
        strength: candidate.chunkIds.size * 10 + candidate.totalScore / candidate.count
      };
    });
  const strongestBySymbol = new Map<string, AcceptedRename>();

  for (const rename of accepted) {
    for (const key of [rename.fromKey, rename.toKey]) {
      const current = strongestBySymbol.get(key);

      if (!current || compareRenameStrength(rename, current) < 0) {
        strongestBySymbol.set(key, rename);
      }
    }
  }

  return accepted.filter((rename) =>
    strongestBySymbol.get(rename.fromKey) === rename &&
    strongestBySymbol.get(rename.toKey) === rename
  );
}

export function selectPrimaryRename(renames: AcceptedRename[]): AcceptedRename | undefined {
  return [...renames].sort((left, right) =>
    right.chunkIds.size - left.chunkIds.size ||
    right.to.length - left.to.length ||
    left.to.localeCompare(right.to)
  )[0];
}

export function selectRelationshipDisplay(displays: ReadonlySet<string>, fallbackKey: string): string {
  return [...displays].sort((left, right) =>
    displayRank(right) - displayRank(left) ||
    right.length - left.length ||
    left.localeCompare(right)
  )[0] ?? fallbackKey.split(':').map((word, index) =>
    index === 0 ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`
  ).join('');
}

function compareRenameStrength(left: AcceptedRename, right: AcceptedRename): number {
  return (
    right.strength - left.strength ||
    right.to.length - left.to.length ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to)
  );
}

function displayRank(value: string): number {
  return /^[A-Z][A-Za-z\d]*$/.test(value) ? 2 : /^[a-z][A-Za-z\d]*$/.test(value) ? 1 : 0;
}
