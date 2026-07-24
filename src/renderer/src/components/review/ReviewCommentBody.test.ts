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
});
