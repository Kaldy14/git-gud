import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReviewGuideFailureMessage } from './ReviewView';

describe('ReviewView AI guide failures', () => {
  it('renders the error persistently instead of hiding it in a hover title', () => {
    const markup = renderToStaticMarkup(
      <ReviewGuideFailureMessage errorMessage="Pi could not be found in the app environment." />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('AI guide failed');
    expect(markup).toContain('Pi could not be found in the app environment.');
  });
});
