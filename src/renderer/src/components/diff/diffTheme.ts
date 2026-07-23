import type { DiffsThemeNames } from '@pierre/diffs';
import type { DiffSyntaxTheme } from '@shared/types';

const DIFF_THEME_NAMES = {
  'git-gud-dark': 'dark-plus',
  'tokyo-night-storm': 'tokyo-night'
} as const satisfies Record<DiffSyntaxTheme, DiffsThemeNames>;

export function getDiffThemeName(theme: DiffSyntaxTheme): DiffsThemeNames {
  return DIFF_THEME_NAMES[theme];
}
