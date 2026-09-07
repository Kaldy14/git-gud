import type { ComponentProps, ReactElement } from 'react';
import { createContext, useContext, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ReviewImageGallerySelection } from './ReviewImageGalleryDialog';
import { getReviewImages, resolveReviewImageMarkdown } from './reviewImages';

type ReviewImagePreviewContextValue = {
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
  onOpenImage
}: {
  body: string;
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
    <ReviewImagePreviewContext.Provider value={{ imageLoading, images, onOpenImage }}>
      <div className="review-line-comment-body" data-compact={compact}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            img: MarkdownImage
          }}
        >
          {renderedBody}
        </ReactMarkdown>
      </div>
    </ReviewImagePreviewContext.Provider>
  );
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
