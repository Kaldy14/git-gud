import { describe, expect, it } from 'vitest';
import { getHighlighterOptions } from '@pierre/diffs';

import { getDiffThemeName } from './diffTheme';

describe('diff theme', () => {
  it('keeps Git Gud Dark as the default-compatible bundled theme', () => {
    expect(getHighlighterOptions('typescript', { theme: getDiffThemeName('git-gud-dark') })).toMatchObject({
      langs: ['typescript'],
      themes: ['dark-plus']
    });
  });

  it('maps Tokyo Night Storm to the bundled Tokyo Night theme', () => {
    expect(getHighlighterOptions('typescript', { theme: getDiffThemeName('tokyo-night-storm') })).toMatchObject({
      langs: ['typescript'],
      themes: ['tokyo-night']
    });
  });
});
