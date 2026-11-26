import type { GitHubPullRequestReviewComment } from '@shared/types';
import { isBotAuthor } from '../pullRequestTimeline';

export type PullRequestReviewThread = {
  id: number;
  author: string;
  authorAvatarUrl?: string;
  isBot: boolean;
  sentence: string;
  path: string;
  line?: number;
  side?: 'left' | 'right';
  createdAt: string;
  url: string;
  replies: number;
  isResolved: boolean;
  // The lines it was written on are gone from the current diff; it can only be read in Conversation.
  isOutdated: boolean;
};

/**
 * One entry per review thread (its root comment), oldest first. `resolutionKnown` is false when
 * GitHub's state is missing for any thread, so nothing can honestly be called unresolved.
 */
export function pullRequestReviewThreads(comments: readonly GitHubPullRequestReviewComment[]): {
  threads: PullRequestReviewThread[];
  resolutionKnown: boolean;
} {
  const roots = comments.filter((comment) => comment.inReplyToId === undefined);
  const replies = new Map<number, number>();
  for (const comment of comments) {
    if (comment.inReplyToId !== undefined) replies.set(comment.inReplyToId, (replies.get(comment.inReplyToId) ?? 0) + 1);
  }
  const threads = roots
    .map((root): PullRequestReviewThread => ({
      id: root.id,
      author: root.author,
      authorAvatarUrl: root.authorAvatarUrl,
      isBot: isBotAuthor(root.author),
      sentence: firstSentence(root.body),
      path: root.path,
      line: root.subjectType === 'line' ? root.line : undefined,
      side: root.subjectType === 'line' ? root.side : undefined,
      createdAt: root.createdAt,
      url: root.url,
      replies: replies.get(root.id) ?? 0,
      isResolved: root.isResolved === true,
      isOutdated: root.isOutdated === true
    }))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return { threads, resolutionKnown: roots.every((root) => root.isResolved !== undefined) };
}

const MAX_SENTENCE = 180;
const ESCAPED: Record<string, string> = { '*': '\uE000', _: '\uE001', '`': '\uE002' };
const RESTORED: Record<string, string> = { '\uE000': '*', '\uE001': '_', '\uE002': '`' };
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/**
 * The first sentence of a comment as plain text: markdown, HTML, collapsed details, badges and bot
 * metadata lines (such as `_⚠️ Potential issue_ | _🟠 Major_`) are dropped.
 */
export function firstSentence(markdown: string): string {
  const text = markdown
    // Escaped markdown characters stay literal: park them so emphasis rules below cannot see them.
    .replace(/\\([\\`*_{}[\]()#+\-.!'",|<>~])/gu, (_match, character: string) => ESCAPED[character] ?? character)
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, '')
    .replace(/<details[\s\S]*?(?:<\/details>|$)/giu, '')
    .replace(/```[\s\S]*?(?:```|$)/gu, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/gu, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    // Quote markers go first so a quoted blank line (`>`) still separates paragraphs.
    .replace(/^[ \t]{0,3}>[ \t]?/gmu, '')
    .replace(/^[ \t]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/gimu, '')
    // A heading stands alone: it should not run into the paragraph under it.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gmu, '\n\n$1\n\n');
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph
      .split('\n')
      .map((line) => line.replace(/^[ \t]{0,3}(?:[-*+][ \t]+|\d+[.)][ \t]+)/u, ''))
      .join(' ')
      .trim())
    .filter((paragraph) => paragraph.length > 0 && !isMetadataLine(paragraph));
  const plain = (paragraphs[0] ?? '')
    .replace(/(\*\*|__)(.+?)\1/gu, '$2')
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/gu, '$1$2')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/[\uE000-\uE002]/gu, (character) => RESTORED[character] ?? character)
    .replace(/&(amp|lt|gt|quot|#39);/gu, (_match, entity: string) => ENTITIES[entity] ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  const sentence = plain.match(/^.+?[.!?](?=\s|$)/u)?.[0] ?? plain;
  return sentence.length > MAX_SENTENCE ? `${sentence.slice(0, MAX_SENTENCE - 1).trimEnd()}…` : sentence;
}

// A paragraph made only of emphasised labels split by pipes, as review bots head their comments.
function isMetadataLine(paragraph: string): boolean {
  return /^(?:\s*(?:_[^_]+_|\*[^*]+\*)\s*\|?)+$/u.test(paragraph);
}
