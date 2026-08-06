import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReviewImageGalleryDialog } from './ReviewImageGalleryDialog';

describe('review image gallery', () => {
  it('renders the selected image with gallery navigation', () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewImageGalleryDialog, {
        selection: {
          images: [
            { src: 'https://private-user-images.githubusercontent.com/1/first.png', alt: 'First screen' },
            { src: 'https://private-user-images.githubusercontent.com/1/second.png', alt: 'Second screen' }
          ],
          index: 1
        },
        onClose: () => undefined
      })
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('<h2');
    expect(markup).toContain('Second screen');
    expect(markup).toContain('2 / 2');
    expect(markup).toContain('aria-label="Show previous image"');
    expect(markup).toContain('aria-label="Show next image"');
    expect(markup).toContain('aria-label="Show image 1 of 2"');
  });
});
