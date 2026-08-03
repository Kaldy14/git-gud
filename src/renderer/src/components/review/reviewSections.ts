import type { GitReviewChunk } from '@shared/types';

export type VisibleReviewSection = {
  key: GitReviewChunk['reviewSection'];
  label: string;
  files: VisibleReviewFile[];
};

export type VisibleReviewFile = {
  key: string;
  chunks: GitReviewChunk[];
  additions: number;
  deletions: number;
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
  const filesBySection = new Map<GitReviewChunk['reviewSection'], VisibleReviewFile[]>();

  for (const file of groupReviewFiles(chunks)) {
    const reviewSection = file.chunks[0].reviewSection;
    const sectionFiles = filesBySection.get(reviewSection) ?? [];
    sectionFiles.push(file);
    filesBySection.set(reviewSection, sectionFiles);
  }

  return sectionOrder.flatMap((key): VisibleReviewSection[] => {
    const sectionFiles = filesBySection.get(key);

    return sectionFiles ? [{ key, label: sectionLabels[key], files: sectionFiles }] : [];
  });
}

export function groupReviewFiles(chunks: readonly GitReviewChunk[]): VisibleReviewFile[] {
  const files: VisibleReviewFile[] = [];
  const filesByIdentity = new Map<string, VisibleReviewFile>();

  for (const chunk of chunks) {
    const key = getReviewFileIdentity(chunk);
    const existing = filesByIdentity.get(key);

    if (existing) {
      existing.chunks.push(chunk);
      existing.additions += chunk.additions;
      existing.deletions += chunk.deletions;
      continue;
    }

    const file = {
      key,
      chunks: [chunk],
      additions: chunk.additions,
      deletions: chunk.deletions
    };
    files.push(file);
    filesByIdentity.set(key, file);
  }

  return files;
}

export function getReviewFileIdentity(chunk: GitReviewChunk): string {
  return chunk.fileContextId
    ? `context:${chunk.fileContextId}`
    : `source:${chunk.source}\u0000original:${chunk.originalPath ?? ''}\u0000path:${chunk.path}`;
}
