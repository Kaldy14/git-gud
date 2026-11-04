/** Fields of a commit or stash row, kept apart so each can match in its own way. */
export type QuickJumpCommitFields = {
  subject: string;
  sha: string;
  authorName: string;
  authorEmail?: string;
  stashSelector?: string;
};

export type QuickJumpSearchable = {
  scoreTarget: string;
  commit?: QuickJumpCommitFields;
};

const MIN_SHA_PREFIX_LENGTH = 4;
const WORD_START_SCORE = 80;
const SUBSTRING_SCORE = 70;
const SHA_SCORE = 90;
const AUTHOR_SCORE = 60;

export function filterQuickJumpItems<Item extends QuickJumpSearchable>(items: readonly Item[], query: string, limit: number): Item[] {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return items.slice(0, limit);
  }

  return items
    .map((item, index) => ({ item, index, score: quickJumpScore(item, normalizedQuery) }))
    .filter((entry) => entry.score >= 0)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function quickJumpScore(item: QuickJumpSearchable, query: string): number {
  return item.commit ? commitScore(item.commit, query) : fuzzyScore(query, normalizeSearch(item.scoreTarget));
}

/**
 * History holds thousands of long strings, so nearly any word is a scattered subsequence of
 * some subject. Each query word must instead appear intact, and the row's score is its weakest word.
 */
function commitScore(commit: QuickJumpCommitFields, query: string): number {
  const subject = normalizeSearch(commit.subject);
  const author = normalizeSearch(`${commit.authorName} ${commit.authorEmail ?? ''}`);
  const sha = normalizeSearch(commit.sha);
  const stashSelector = normalizeSearch(commit.stashSelector ?? '');
  let score = Number.POSITIVE_INFINITY;

  for (const word of query.split(/\s+/)) {
    score = Math.min(score, commitWordScore(word, subject, author, sha, stashSelector));

    if (score < 0) {
      return -1;
    }
  }

  return score;
}

function commitWordScore(word: string, subject: string, author: string, sha: string, stashSelector: string): number {
  if (word.length >= MIN_SHA_PREFIX_LENGTH && sha.startsWith(word)) {
    return SHA_SCORE;
  }

  if (hasWordStart(subject, word) || stashSelector.includes(word)) {
    return WORD_START_SCORE;
  }

  if (subject.includes(word)) {
    return SUBSTRING_SCORE;
  }

  return hasWordStart(author, word) ? AUTHOR_SCORE : -1;
}

function hasWordStart(text: string, word: string): boolean {
  let index = text.indexOf(word);

  while (index !== -1) {
    if (index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1] ?? '')) {
      return true;
    }

    index = text.indexOf(word, index + 1);
  }

  return false;
}

function fuzzyScore(query: string, target: string): number {
  const directIndex = target.indexOf(query);

  if (directIndex !== -1) {
    return 100 - directIndex - target.length * 0.001;
  }

  let queryIndex = 0;
  let score = 0;
  let lastMatch = -2;

  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] !== query[queryIndex]) {
      continue;
    }

    const boundaryBonus = index === 0 || /[\s/_-]/.test(target[index - 1] ?? '') ? 4 : 0;
    const contiguousBonus = index === lastMatch + 1 ? 3 : 0;
    score += 1 + boundaryBonus + contiguousBonus;
    lastMatch = index;
    queryIndex += 1;
  }

  return queryIndex === query.length ? score - target.length * 0.001 : -1;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
