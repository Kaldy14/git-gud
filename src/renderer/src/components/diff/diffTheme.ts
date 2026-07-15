export const DIFF_THEME_COLORS = {
  background: '#1c1e23',
  foreground: '#ffffff',
  muted: '#858585',
  keyword: '#679bd1',
  type: '#6ac6b1',
  string: '#c5947c',
  punctuation: '#f9d949',
  bracket: '#cc76d1'
} as const;

export const DIFF_TOKEN_COLOR_MAP = {
  '#08C0EF': DIFF_THEME_COLORS.foreground,
  '#5ECC71': DIFF_THEME_COLORS.string,
  '#636363': DIFF_THEME_COLORS.punctuation,
  '#68CDF2': DIFF_THEME_COLORS.keyword,
  '#69B1FF': DIFF_THEME_COLORS.keyword,
  '#737373': DIFF_THEME_COLORS.muted,
  '#9D6AFB': DIFF_THEME_COLORS.type,
  '#D568EA': DIFF_THEME_COLORS.type,
  '#FAFAFA': DIFF_THEME_COLORS.foreground,
  '#FF678D': DIFF_THEME_COLORS.keyword,
  '#FFA359': DIFF_THEME_COLORS.type
} as const;

export const DIFF_THEME_CSS = Object.entries(DIFF_TOKEN_COLOR_MAP)
  .map(
    ([source, target]) =>
      `[style*="--diffs-token-dark:${source}"] { --diffs-token-dark: ${target} !important; }`
  )
  .join('\n');
