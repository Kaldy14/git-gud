import type { DiffSyntaxTheme } from '@shared/types';
import { AiMessageCodeBlock } from './AiMessageCodeBlock';
import { EvidenceFileLink } from './EvidenceFileLink';
import { parseCodeReference, type CodeReference } from '@shared/codeReference';
import type { ComponentProps, ReactElement } from 'react';
import { createContext, useContext, useState } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ReviewImageGallerySelection } from './ReviewImageGalleryDialog';
import { getReviewImages, resolveReviewImageMarkdown } from './reviewImages';

type ReviewImagePreviewContextValue = {
  aiMessageTheme?: DiffSyntaxTheme;
  imageLoading: 'eager' | 'lazy';
  images: ReviewImageGallerySelection['images'];
  onOpenImage?: (selection: ReviewImageGallerySelection) => void;
};

const ReviewImagePreviewContext = createContext<ReviewImagePreviewContextValue>({
  imageLoading: 'lazy',
  images: []
});

export function ReviewCommentBody({
  body,
  compact = false,
  imageUrls = {},
  imageLoading = 'lazy',
  onOpenImage,
  onOpenFile,
  aiMessageTheme
}: {
  body: string;
  aiMessageTheme?: DiffSyntaxTheme;
  onOpenFile?: (reference: CodeReference) => void;
  compact?: boolean;
  imageUrls?: Record<string, string>;
  imageLoading?: 'eager' | 'lazy';
  onOpenImage?: (selection: ReviewImageGallerySelection) => void;
}): ReactElement {
  const withoutMetadata = body
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<details>[\s\S]*?<\/details>/gu, '')
    .trim();
  const visibleBody = withoutMetadata || body.trim();
  const renderedBody = resolveReviewImageMarkdown(visibleBody, imageUrls);
  const images = getReviewImages(renderedBody);

  return (
    <ReviewImagePreviewContext.Provider value={{ imageLoading, images, onOpenImage, aiMessageTheme }}>
      <div className={`review-line-comment-body${aiMessageTheme ? ' ai-message-body' : ''}`} data-compact={compact}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ children, href }) => {
              const reference = onOpenFile && href ? parseCodeReference(href) : undefined;
              if (reference && onOpenFile) return <EvidenceFileLink reference={reference} onOpen={onOpenFile} />;
              return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
            },
            code: ({ children, className }) => {
              const reference = onOpenFile && !className && typeof children === 'string' ? parseCodeReference(children) : undefined;
              if (reference && onOpenFile) return <EvidenceFileLink reference={reference} onOpen={onOpenFile} />;
              return <code className={className}>{children}</code>;
            },
            pre: MarkdownPre,
            table: ({ children }) => aiMessageTheme ? <div className="ai-message-table"><table>{children}</table></div> : <table>{children}</table>,
            img: MarkdownImage
          }}
        >
          {renderedBody}
        </ReactMarkdown>
      </div>
    </ReviewImagePreviewContext.Provider>
  );
}

// Stable component identity preserves wrap/copy state when findings refresh.
function MarkdownPre({ children, node }: ComponentProps<'pre'> & ExtraProps) {
  const { aiMessageTheme } = useContext(ReviewImagePreviewContext);
  const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code');
  if (!aiMessageTheme || code?.type !== 'element') return <pre>{children}</pre>;
  const contents = code.children.map(child => child.type === 'text' ? child.value : '').join('');
  const classes = code.properties.className;
  const language = Array.isArray(classes) ? String(classes.find(value => String(value).startsWith('language-')) ?? '').replace(/^language-/, '') : '';
  return <AiMessageCodeBlock key={contents} code={contents} language={language} theme={aiMessageTheme} />;
}

function MarkdownImage({
  alt,
  src,
  title
}: ComponentProps<'img'>): ReactElement {
  const [failedSrc, setFailedSrc] = useState<string>();
  const { imageLoading, images, onOpenImage } = useContext(ReviewImagePreviewContext);

  if (!src || failedSrc === src) {
    return (
      <span className="review-markdown-image-fallback">
        {alt || 'Image unavailable'}
      </span>
    );
  }

  const openImage = (): void => {
    if (!onOpenImage) {
      return;
    }

    const index = images.findIndex((image) => image.src === src);
    onOpenImage({
      images: index >= 0 ? images : [{ src, alt: alt ?? '' }],
      index: Math.max(index, 0)
    });
  };

  return (
    <img
      src={src}
      alt={alt ?? ''}
      title={title}
      loading={imageLoading}
      data-expandable={Boolean(onOpenImage)}
      role={onOpenImage ? 'button' : undefined}
      tabIndex={onOpenImage ? 0 : undefined}
      aria-label={onOpenImage ? `Open ${alt || 'image'} preview` : undefined}
      onClick={openImage}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openImage();
        }
      }}
      onError={() => setFailedSrc(src)}
    />
  );
}
