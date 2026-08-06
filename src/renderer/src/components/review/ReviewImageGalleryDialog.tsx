import type { ReactElement } from 'react';
import { useEffect, useId, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';

export type ReviewGalleryImage = {
  src: string;
  alt: string;
};

export type ReviewImageGallerySelection = {
  images: ReviewGalleryImage[];
  index: number;
};

export function ReviewImageGalleryDialog({
  selection,
  onClose
}: {
  selection: ReviewImageGallerySelection;
  onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const [activeIndex, setActiveIndex] = useState(
    Math.min(Math.max(selection.index, 0), Math.max(selection.images.length - 1, 0))
  );
  const [failedSrc, setFailedSrc] = useState<string>();
  const image = selection.images[activeIndex];
  const hasMultipleImages = selection.images.length > 1;

  function moveImage(direction: -1 | 1): void {
    setActiveIndex((current) =>
      (current + direction + selection.images.length) % selection.images.length
    );
  }

  useEffect(() => {
    if (!hasMultipleImages) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex((current) =>
          (current - 1 + selection.images.length) % selection.images.length
        );
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % selection.images.length);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasMultipleImages, selection.images.length]);

  const title = image?.alt || 'Pull request image';

  return (
    <ModalSurface
      labelledBy={titleId}
      className="review-image-gallery"
      backdropClassName="review-image-gallery-backdrop"
      onClose={onClose}
    >
      <header>
        <span className="review-image-gallery-icon" aria-hidden="true">
          <Images size={15} />
        </span>
        <div>
          <span>Pull request image</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        {hasMultipleImages ? (
          <span className="review-image-gallery-count" aria-live="polite">
            {activeIndex + 1} / {selection.images.length}
          </span>
        ) : null}
        <button
          className="icon-btn icon-btn-regular"
          type="button"
          data-modal-initial-focus="true"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <X size={15} />
        </button>
      </header>

      <div className="review-image-gallery-stage">
        {image && failedSrc !== image.src ? (
          <img
            key={image.src}
            src={image.src}
            alt={image.alt}
            onError={() => setFailedSrc(image.src)}
          />
        ) : (
          <p role="alert">This image could not be displayed.</p>
        )}
        {hasMultipleImages ? (
          <>
            <button
              className="review-image-gallery-previous"
              type="button"
              onClick={() => moveImage(-1)}
              aria-label="Show previous image"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              className="review-image-gallery-next"
              type="button"
              onClick={() => moveImage(1)}
              aria-label="Show next image"
            >
              <ChevronRight size={22} />
            </button>
          </>
        ) : null}
      </div>

      {hasMultipleImages ? (
        <footer aria-label="Image gallery thumbnails">
          {selection.images.map((galleryImage, index) => (
            <button
              key={`${galleryImage.src}:${index}`}
              type="button"
              aria-label={`Show image ${index + 1} of ${selection.images.length}`}
              aria-current={index === activeIndex ? 'true' : undefined}
              onClick={() => setActiveIndex(index)}
            >
              <img src={galleryImage.src} alt="" loading="lazy" />
            </button>
          ))}
        </footer>
      ) : null}
    </ModalSurface>
  );
}
