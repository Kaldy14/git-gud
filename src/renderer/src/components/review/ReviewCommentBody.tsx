import type { ComponentProps, ReactElement } from 'react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ReviewCommentBody({
  body,
  compact = false
}: {
  body: string;
  compact?: boolean;
}): ReactElement {
  const withoutMetadata = body
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<details>[\s\S]*?<\/details>/gu, '')
    .trim();
  const visibleBody = withoutMetadata || body.trim();

  return (
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
        {visibleBody}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownImage({
  alt,
  src,
  title
}: ComponentProps<'img'>): ReactElement {
  const [didFail, setDidFail] = useState(false);

  if (didFail || !src) {
    return (
      <span className="review-markdown-image-fallback">
        {alt || 'Image unavailable'}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      onError={() => setDidFail(true)}
    />
  );
}
