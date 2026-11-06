import {
  registerCustomTheme,
  resolveTheme,
  type DiffsThemeNames,
  type ThemeRegistrationResolved
} from '@pierre/diffs';
import type { DiffSyntaxTheme } from '@shared/types';

type BaseTheme = 'dark-plus' | 'tokyo-night';

// Readable copies of the bundled Shiki themes. Each mapped colour is the original, lightened in
// OKLab with its hue kept, until it reaches 4.5:1 on the `.gg-diff` canvas, on added and removed
// lines, and on word emphasis (tints in main.css). Comment colours only need 4.5:1 on whole
// lines so they stay a dimmer tier than code. Re-derive these if the canvas or tints change.
const READABLE_COLORS: Record<BaseTheme, Record<string, string>> = {
  'dark-plus': {
    '#000080': '#96baff',
    '#6a9955': '#77a563',
    '#569cd6': '#82c0f6',
    '#646695': '#b5b8e0',
    '#f44747': '#ffa298',
    '#ce9178': '#e7ad95',
    '#6796e6': '#91bdff',
    '#808080': '#bababa',
    '#d16969': '#ffa19f',
    '#4ec9b0': '#56ceb5',
    '#c586c0': '#e3a8dd',
    '#4fc1ff': '#57c6ff'
  },
  'tokyo-night': {
    '#a9b1d6': '#b1b9dd',
    '#51597d': '#9199b9',
    '#5a638c': '#8f97bd',
    '#646e9c': '#8d97c1',
    '#ff9e64': '#ffa56c',
    '#9aa5ce': '#afbae1',
    '#ff5370': '#ff9fae',
    '#bb9af7': '#caabff',
    '#9d7cd8': '#c8adff',
    '#0db9d7': '#44cae7',
    '#f7768e': '#ff9fb2',
    '#de5971': '#ff9fae',
    '#ba3c97': '#ff98dc',
    '#e0af68': '#e3b26c',
    '#41a6b5': '#73c8d5',
    '#7aa2f7': '#94baff',
    '#fc7b7b': '#ffa09e',
    '#449dab': '#7cc6d2',
    '#914c54': '#e6abb0',
    '#6183bb': '#9dbbed',
    '#4e5579': '#b2b9d6',
    '#61bdf2': '#6ac3f8',
    '#6d91de': '#99bbff',
    '#747ca1': '#b1b8d9',
    '#db4b4b': '#ffa099',
    '#b267e6': '#e1a1ff'
  }
};

const DIFF_THEMES = {
  'git-gud-dark': { name: 'git-gud-dark-plus', base: 'dark-plus' },
  'tokyo-night-storm': { name: 'git-gud-tokyo-night', base: 'tokyo-night' }
} as const satisfies Record<DiffSyntaxTheme, { name: string; base: BaseTheme }>;

function readableColor(color: string | undefined, colors: Record<string, string>): string | undefined {
  return color ? colors[color.toLowerCase()] ?? color : color;
}

export function createReadableTheme(
  theme: ThemeRegistrationResolved,
  name: string,
  colors: Record<string, string>
): ThemeRegistrationResolved {
  // Build new rule objects so the cached bundled theme stays untouched.
  const readableRules = <T extends { settings?: { foreground?: string } }>(rules: T[]): T[] =>
    rules.map((rule) =>
      rule.settings?.foreground
        ? { ...rule, settings: { ...rule.settings, foreground: readableColor(rule.settings.foreground, colors) } }
        : rule
    );
  const editorForeground = theme.colors?.['editor.foreground'];

  return {
    ...theme,
    name,
    fg: readableColor(theme.fg, colors) ?? theme.fg,
    colors: editorForeground
      ? { ...theme.colors, 'editor.foreground': readableColor(editorForeground, colors) ?? editorForeground }
      : theme.colors,
    settings: readableRules(theme.settings),
    tokenColors: theme.tokenColors ? readableRules(theme.tokenColors) : theme.tokenColors
  };
}

// Themes resolve on the main thread and are handed to the diff workers, so registering here is enough.
for (const { name, base } of Object.values(DIFF_THEMES)) {
  registerCustomTheme(name, async () => createReadableTheme(await resolveTheme(base), name, READABLE_COLORS[base]));
}

type DiffThemeTarget = {
  setRenderOptions: (options: { theme: DiffsThemeNames }) => Promise<void>;
};

export function getDiffThemeName(theme: DiffSyntaxTheme): DiffsThemeNames {
  return DIFF_THEMES[theme].name;
}

export function applyDiffSyntaxTheme(
  target: DiffThemeTarget,
  theme: DiffSyntaxTheme
): Promise<void> {
  return target.setRenderOptions({ theme: getDiffThemeName(theme) });
}
