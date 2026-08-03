import type { GitTagRef } from '@shared/types';

const RECENT_TAG_LIMIT = 10;
const MIN_PATTERN_LENGTH = 2;
const NUMBER_PART = /^\d+$/;
const MONTHLY_RELEASE_TAG = /^v(\d{4})\.(\d{1,2})\.(\d+)$/;

type ParsedTagName = {
  name: string;
  parts: string[];
  numbers: bigint[];
  signature: string;
};

type MonthlyReleaseTag = {
  year: bigint;
  month: bigint;
  release: bigint;
};

export function suggestNextTagName(
  tags: readonly GitTagRef[],
  now: Date = new Date()
): string | undefined {
  const recentTags = [...tags]
    .sort((left, right) => right.name.localeCompare(left.name, 'en', { numeric: true, sensitivity: 'base' }))
    .slice(0, RECENT_TAG_LIMIT);
  const latest = recentTags[0] ? parseTagName(recentTags[0].name) : undefined;

  if (!latest) {
    return undefined;
  }

  const monthlyReleaseSuggestion = suggestMonthlyReleaseTag(tags, latest.name, now);

  if (monthlyReleaseSuggestion) {
    return monthlyReleaseSuggestion;
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

function suggestMonthlyReleaseTag(
  tags: readonly GitTagRef[],
  latestName: string,
  now: Date
): string | undefined {
  if (!parseMonthlyReleaseTag(latestName)) {
    return undefined;
  }

  const matchingTags = tags
    .map((tag) => parseMonthlyReleaseTag(tag.name))
    .filter((tag): tag is MonthlyReleaseTag => tag !== undefined);

  if (matchingTags.length < MIN_PATTERN_LENGTH) {
    return undefined;
  }

  const year = BigInt(now.getFullYear());
  const month = BigInt(now.getMonth() + 1);
  const currentMonthTags = matchingTags.filter(
    (tag) => tag.year === year && tag.month === month
  );
  const nextRelease = currentMonthTags.reduce(
    (highest, tag) => (tag.release > highest ? tag.release : highest),
    0n
  ) + 1n;

  return `v${year}.${month}.${nextRelease}`;
}

function parseMonthlyReleaseTag(name: string): MonthlyReleaseTag | undefined {
  const match = MONTHLY_RELEASE_TAG.exec(name);

  if (!match) {
    return undefined;
  }

  const [, yearPart, monthPart, releasePart] = match;

  if (yearPart === undefined || monthPart === undefined || releasePart === undefined) {
    return undefined;
  }

  const year = BigInt(yearPart);
  const month = BigInt(monthPart);
  const release = BigInt(releasePart);

  return year >= 2000n && month >= 1n && month <= 12n && release >= 1n
    ? { year, month, release }
    : undefined;
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
