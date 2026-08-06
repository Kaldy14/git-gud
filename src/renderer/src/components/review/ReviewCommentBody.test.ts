import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReviewCommentBody } from './ReviewCommentBody';

describe('review comment Markdown', () => {
  it('renders GitHub-flavored Markdown structures and safe external links', () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewCommentBody, {
        body: [
          '## Summary',
          '',
          '- **Ready**',
          '- [x] Tested',
          '',
          '| File | Result |',
          '| --- | --- |',
          '| `app.ts` | Pass |',
          '',
          '[Open details](https://github.com/acme/widgets/pull/42)',
          '',
          '```ts',
          'const ready = true;',
          '```'
        ].join('\n')
      })
    );

    expect(markup).toContain('<h2>Summary</h2>');
    expect(markup).toContain('<ul class="contains-task-list">');
    expect(markup).toContain('<table>');
    expect(markup).toContain('<code class="language-ts">');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it('does not render raw HTML or hidden metadata', () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewCommentBody, {
        body: 'Visible **comment** with an [unsafe link](javascript:alert(1)).\n\n<!-- secret -->\n<details>hidden metadata</details>\n<script>alert(1)</script>'
      })
    );

    expect(markup).toContain('<strong>comment</strong>');
    expect(markup).not.toContain('secret');
    expect(markup).not.toContain('hidden metadata');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('alert(1)');
    expect(markup).not.toContain('javascript:');
  });

  it('renders GitHub HTML image tags with authenticated attachment URLs', () => {
    const sourceUrl = 'https://github.com/user-attachments/assets/image-id';
    const resolvedUrl = 'https://private-user-images.githubusercontent.com/1/image-id.png?jwt=signed';
    const markup = renderToStaticMarkup(
      createElement(ReviewCommentBody, {
        body: `Screenshot\n\n<img width="900" alt="Permissions overview" src="${sourceUrl}" />`,
        imageUrls: { [sourceUrl]: resolvedUrl },
        imageLoading: 'eager',
        onOpenImage: () => undefined
      })
    );

    expect(markup).toContain('<p>Screenshot</p>');
    expect(markup).toContain(`src="${resolvedUrl.replaceAll('&', '&amp;')}"`);
    expect(markup).toContain('alt="Permissions overview"');
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Open Permissions overview preview"');
    expect(markup).not.toContain('<img width=');
  });
});
