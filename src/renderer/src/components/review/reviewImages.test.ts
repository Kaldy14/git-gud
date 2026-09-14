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

  it('keeps attachments while filtering known buttons and badges before URL resolution', () => {
    const button = 'https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui.svg';
    expect(getReviewImages([
      `<a href="https://app.coderabbit.ai/change-stack/org/repo/pull/1#gh-light-mode-only"><img src="${button}" alt="Review Change Stack"></a>`,
      `[![Build](https://img.shields.io/badge/build-passing-green)](https://example.com/build)`,
      '![Diagram](https://example.com/bot-diagram.svg)',
      '<img width="32" height="32" alt="Small screenshot" src="https://example.com/small.png">'
    ].join('\n\n'), { [button]: 'https://example.com/proxied.svg' })).toEqual([
      { alt: 'Diagram', src: 'https://example.com/bot-diagram.svg' },
      { alt: 'Small screenshot', src: 'https://example.com/small.png' }
    ]);
  });

  it('collects reference attachments but does not treat code examples as images', () => {
    expect(getReviewImages('```md\n![Example](https://example.com/code.png)\n```\n\n![Actual][screenshot]\n\n[screenshot]: https://example.com/real.png')).toEqual([
      { src: 'https://example.com/real.png', alt: 'Actual' }
    ]);
  });
});
