import type { ReviewImageGallerySelection } from './ReviewImageGalleryDialog';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const markdown = unified().use(remarkParse).use(remarkGfm);

// Match known assets, not image dimensions or authors: bots can attach useful diagrams too.
function isDecorativeImage(src: string): boolean {
  try {
    const url = new URL(src);
    return (url.hostname === 'storage.googleapis.com' &&
      /^\/coderabbit_public_assets\/review-stack-in-coderabbit-ui(?:-dark)?\.svg$/u.test(url.pathname)) ||
      url.hostname === 'img.shields.io' ||
      (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/actions\/workflows\/.+\/badge\.svg$/u.test(url.pathname));
  } catch {
    return false;
  }
}

export function getReviewImages(body: string, imageUrls: Record<string, string> = {}): ReviewImageGallerySelection['images'] {
  return extractMarkdownImages(resolveReviewImageMarkdown(body, imageUrls))
    .filter((image) => /^(https?:|data:image\/)/iu.test(image.src))
    .map(({ src, alt }) => ({ src, alt }));
}

function convertHtmlImagesToMarkdown(body: string): string {
  const seenActions = new Set<string>();
  // Preserve the action behind HTML image buttons when raw HTML is skipped by the renderer.
  const withLinks = body.replace(/<a\b([^>]*)>\s*(<img\b[^>]*>)\s*<\/a>/giu, (original, attributes: string, tag: string) => {
    const src = readHtmlAttribute(tag, 'src');
    const href = readHtmlAttribute(`<a ${attributes}>`, 'href');
    if (!src || !href || !isDecorativeImage(src)) return original;
    // GitHub includes both theme variants. A text link works in either theme.
    const target = href.replace(/#gh-(?:light|dark)-mode-only$/u, '');
    const alt = readHtmlAttribute(tag, 'alt') || 'Open details';
    const key = `${target}\n${alt}`;
    if (seenActions.has(key)) return '';
    seenActions.add(key);
    return `[${escapeMarkdownAlt(alt)}](<${target.replaceAll('>', '%3E')}>)`;
  });
  return withLinks.replace(/<img\b[^>]*>/giu, (tag) => {
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

function extractMarkdownImages(body: string) {
  const root = markdown.parse(body);
  const nodes = [...root.children];
  const definitions = new Map<string, string>();
  const images = [];
  // Traverse Markdown rather than matching code examples or missing reference-style images.
  for (const node of nodes) {
    if ('children' in node) nodes.push(...node.children);
    if (node.type === 'definition') definitions.set(node.identifier, node.url);
  }
  for (const node of nodes) {
    if (node.type !== 'image' && node.type !== 'imageReference') continue;
    const src = node.type === 'image' ? node.url : definitions.get(node.identifier);
    if (src) images.push({ src, alt: node.alt ?? '', position: node.position });
  }
  return images.sort((a, b) => (a.position?.start.offset ?? 0) - (b.position?.start.offset ?? 0));
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
  let converted = convertHtmlImagesToMarkdown(body);
  // Filter before proxy/private URL resolution hides the original asset's identity.
  for (const image of extractMarkdownImages(converted).reverse()) {
    const start = image.position?.start.offset;
    const end = image.position?.end.offset;
    if (isDecorativeImage(image.src) && start !== undefined && end !== undefined) {
      converted = converted.slice(0, start) + escapeMarkdownAlt(image.alt || 'Badge') + converted.slice(end);
    }
  }
  return resolveImageUrls(converted, imageUrls);
}
