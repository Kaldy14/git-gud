import type { GitTagRef } from '@shared/types';

const RECENT_TAG_LIMIT = 10;
const MIN_PATTERN_LENGTH = 2;
const NUMBER_PART = /^\d+$/;

type ParsedTagName = {
  name: string;
  parts: string[];
  numbers: bigint[];
  signature: string;
};

export function suggestNextTagName(tags: readonly GitTagRef[]): string | undefined {
  const recentTags = [...tags]
    .sort((left, right) => right.name.localeCompare(left.name, 'en', { numeric: true, sensitivity: 'base' }))
    .slice(0, RECENT_TAG_LIMIT);
  const latest = recentTags[0] ? parseTagName(recentTags[0].name) : undefined;

  if (!latest) {
    return undefined;
  }

  const matchingTags = recentTags
    .map((tag) => parseTagName(tag.name))
    .filter((tag): tag is ParsedTagName => tag?.signature === latest.signature);
  const candidates = latest.numbers.flatMap((_, index) => {
    const family = matchingTags.filter((tag) =>
      tag.numbers.every((value, numberIndex) => numberIndex === index || value === latest.numbers[numberIndex])
    );
    const distinctValues = new Set(family.map((tag) => tag.numbers[index]));

    return family.length >= MIN_PATTERN_LENGTH && distinctValues.size >= MIN_PATTERN_LENGTH
      ? [{ index, family }]
      : [];
  });
  const strongestFamilySize = Math.max(0, ...candidates.map((candidate) => candidate.family.length));
  const strongestCandidates = candidates.filter((candidate) => candidate.family.length === strongestFamilySize);

  if (strongestCandidates.length !== 1) {
    return undefined;
  }

  const [{ index, family }] = strongestCandidates;
  const latestValue = latest.numbers[index];

  if (family.some((tag) => tag.numbers[index] > latestValue)) {
    return undefined;
  }

  const suggestion = replaceNumberPart(latest, index, latestValue + 1n);

  return tags.some((tag) => tag.name === suggestion) ? undefined : suggestion;
}

function parseTagName(name: string): ParsedTagName | undefined {
  const parts = name.split(/(\d+)/);
  const numberParts = parts.filter((part) => NUMBER_PART.test(part));

  if (numberParts.length === 0) {
    return undefined;
  }

  return {
    name,
    parts,
    numbers: numberParts.map((part) => BigInt(part)),
    signature: parts.map((part) => (NUMBER_PART.test(part) ? '#' : part)).join('\0')
  };
}

function replaceNumberPart(tag: ParsedTagName, numberIndex: number, value: bigint): string {
  let currentNumberIndex = 0;

  return tag.parts
    .map((part) => {
      if (!NUMBER_PART.test(part)) {
        return part;
      }

      const partIndex = currentNumberIndex;
      currentNumberIndex += 1;

      if (partIndex !== numberIndex) {
        return part;
      }

      const nextPart = value.toString();
      return part.length > 1 && part.startsWith('0') ? nextPart.padStart(part.length, '0') : nextPart;
    })
    .join('');
}
