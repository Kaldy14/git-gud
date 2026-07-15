import { describe, expect, it } from 'vitest';

import { DIFF_THEME_COLORS, DIFF_THEME_CSS, DIFF_TOKEN_COLOR_MAP } from './diffTheme';

describe('diff theme', () => {
  it('keeps the GitKraken syntax palette paired with its dark code background', () => {
    expect(new Set(Object.values(DIFF_THEME_COLORS))).toEqual(
      new Set(['#1c1e23', '#ffffff', '#858585', '#679bd1', '#6ac6b1', '#c5947c', '#f9d949', '#cc76d1'])
    );
    expect(DIFF_TOKEN_COLOR_MAP).toMatchObject({
      '#5ECC71': DIFF_THEME_COLORS.string,
      '#636363': DIFF_THEME_COLORS.punctuation,
      '#FF678D': DIFF_THEME_COLORS.keyword,
      '#FFA359': DIFF_THEME_COLORS.type
    });
    expect(DIFF_THEME_CSS).toContain('--diffs-token-dark:#FF678D');
    expect(DIFF_THEME_CSS).toContain('--diffs-token-dark: #679bd1 !important');
  });
});
