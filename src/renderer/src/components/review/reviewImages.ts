import type { ReviewImageGallerySelection } from './ReviewImageGalleryDialog';

export function getReviewImages(body: string, imageUrls: Record<string, string> = {}): ReviewImageGallerySelection['images'] {
  return extractMarkdownImages(resolveReviewImageMarkdown(body, imageUrls))
    .filter((image) => /^(https?:|data:image\/)/iu.test(image.src));
}

function convertHtmlImagesToMarkdown(body: string): string {
  return body.replace(/<img\b[^>]*>/giu, (tag) => {
    const src = readHtmlAttribute(tag, 'src');
    if (!src) {
      return '';
    }

    const alt = readHtmlAttribute(tag, 'alt') ?? '';
    return `\n\n![${escapeMarkdownAlt(alt)}](<${src.replaceAll('>', '%3E')}>)\n\n`;
  });
}

function resolveImageUrls(body: string, imageUrls: Record<string, string>): string {
  return Object.entries(imageUrls).reduce(
    (resolvedBody, [sourceUrl, resolvedUrl]) => resolvedBody.replaceAll(sourceUrl, resolvedUrl),
    body
  );
}

function extractMarkdownImages(body: string): ReviewImageGallerySelection['images'] {
  return [...body.matchAll(/!\[((?:\\.|[^\]])*)\]\(\s*(?:<([^>]+)>|([^\s)]+))/gu)]
    .map((match) => ({
      alt: match[1]?.replace(/\\(.)/gu, '$1') ?? '',
      src: match[2] ?? match[3] ?? ''
    }))
    .filter((image) => image.src.length > 0);
}

function readHtmlAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'iu'
  ).exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value
    ?.replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function escapeMarkdownAlt(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(']', '\\]');
}

export function resolveReviewImageMarkdown(body: string, imageUrls: Record<string, string>): string {
  return resolveImageUrls(convertHtmlImagesToMarkdown(body), imageUrls);
}
