import type { DiffsThemeNames } from '@pierre/diffs';
import type { DiffSyntaxTheme } from '@shared/types';

const DIFF_THEME_NAMES = {
  'git-gud-dark': 'dark-plus',
  'tokyo-night-storm': 'tokyo-night'
} as const satisfies Record<DiffSyntaxTheme, DiffsThemeNames>;

type DiffThemeTarget = {
  setRenderOptions: (options: { theme: DiffsThemeNames }) => Promise<void>;
};

export function getDiffThemeName(theme: DiffSyntaxTheme): DiffsThemeNames {
  return DIFF_THEME_NAMES[theme];
}

export function applyDiffSyntaxTheme(
  target: DiffThemeTarget,
  theme: DiffSyntaxTheme
): Promise<void> {
  return target.setRenderOptions({ theme: getDiffThemeName(theme) });
}
