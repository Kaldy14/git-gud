import type { GitReviewChunk } from '@shared/types';

export type VisibleReviewSection = {
  key: GitReviewChunk['reviewSection'];
  label: string;
  chunks: GitReviewChunk[];
};

export type VisibleReviewContext = {
  key: string;
  label: string;
  sections: VisibleReviewSection[];
  chunkCount: number;
};

const sectionLabels: Record<GitReviewChunk['reviewSection'], string> = {
  storage: 'Storage and migrations',
  definition: 'Definitions',
  api: 'API and GraphQL',
  generated: 'Generated artifacts',
  implementation: 'Implementations and consumers',
  tests: 'Tests and specs',
  translations: 'Translations',
  other: 'Related changes'
};

const sectionOrder: GitReviewChunk['reviewSection'][] = [
  'storage',
  'definition',
  'api',
  'generated',
  'implementation',
  'tests',
  'translations',
  'other'
];

export function createReviewSections(chunks: readonly GitReviewChunk[]): VisibleReviewSection[] {
  const chunksBySection = new Map<GitReviewChunk['reviewSection'], GitReviewChunk[]>();

  for (const chunk of chunks) {
    const sectionChunks = chunksBySection.get(chunk.reviewSection) ?? [];
    sectionChunks.push(chunk);
    chunksBySection.set(chunk.reviewSection, sectionChunks);
  }

  return sectionOrder.flatMap((key): VisibleReviewSection[] => {
    const sectionChunks = chunksBySection.get(key);

    return sectionChunks ? [{ key, label: sectionLabels[key], chunks: sectionChunks }] : [];
  });
}

export function createReviewContexts(chunks: readonly GitReviewChunk[]): VisibleReviewContext[] {
  const chunksByContext = new Map<string, GitReviewChunk[]>();

  for (const chunk of chunks) {
    const key = chunk.reviewContext ?? chunk.relationship;
    const contextChunks = chunksByContext.get(key) ?? [];
    contextChunks.push(chunk);
    chunksByContext.set(key, contextChunks);
  }

  return [...chunksByContext.entries()].map(([label, contextChunks]) => ({
    key: label,
    label,
    sections: createReviewSections(contextChunks),
    chunkCount: contextChunks.length
  }));
}
