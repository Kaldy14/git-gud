import { describe, expect, it } from 'vitest';

import { getReviewImages } from './reviewImages';

describe('pull request image collection', () => {
  it('collects Markdown and HTML attachments and resolves private image URLs', () => {
    expect(getReviewImages(
      '![Before](https://example.com/before.png)\n<img alt="After &amp; details" src="https://github.com/user-attachments/after" />',
      { 'https://github.com/user-attachments/after': 'https://example.com/after.png?token=signed' }
    )).toEqual([
      { alt: 'Before', src: 'https://example.com/before.png' },
      { alt: 'After & details', src: 'https://example.com/after.png?token=signed' }
    ]);
  });

  it('omits local files and executable URLs from the image gallery', () => {
    expect(getReviewImages('![a](file:///tmp/private.png) ![b](javascript:alert)')).toEqual([]);
  });
});
