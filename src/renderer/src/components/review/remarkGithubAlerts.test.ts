import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ReviewCommentBody } from './ReviewCommentBody';

describe('GitHub alert blockquotes', () => {
  it('renders the marker as a titled callout instead of literal text', () => {
    const html = renderToStaticMarkup(createElement(ReviewCommentBody, { body: '> [!WARNING]\n> Do not merge yet.' }));
    expect(html).toContain('data-alert="warning"');
    expect(html).toContain('data-alert-title="Warning"');
    expect(html).toContain('Do not merge yet.');
    expect(html).not.toContain('[!WARNING]');
  });

  it('leaves ordinary blockquotes alone', () => {
    const html = renderToStaticMarkup(createElement(ReviewCommentBody, { body: '> Just a quote [!NOTE]' }));
    expect(html).not.toContain('data-alert');
  });
});
