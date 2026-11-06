import { describe, expect, it, vi } from 'vitest';
import { resolveTheme } from '@pierre/diffs';

import { applyDiffSyntaxTheme, getDiffThemeName } from './diffTheme';

function commentColor(theme: Awaited<ReturnType<typeof resolveTheme>>): string | undefined {
  return theme.settings.find((rule) => [rule.scope].flat().includes('comment') && rule.settings.foreground)?.settings.foreground;
}

describe('diff theme', () => {
  it('resolves readable copies of the bundled themes', async () => {
    const tokyo = await resolveTheme(getDiffThemeName('tokyo-night-storm'));
    const darkPlus = await resolveTheme(getDiffThemeName('git-gud-dark'));

    expect(tokyo.name).toBe('git-gud-tokyo-night');
    expect(darkPlus.name).toBe('git-gud-dark-plus');
    // Tokyo Night's #51597d comments read at 2.6:1 on the diff canvas; the copy lifts them to 4.5:1.
    expect(commentColor(await resolveTheme('tokyo-night'))?.toLowerCase()).toBe('#51597d');
    expect(commentColor(tokyo)).toBe('#9199b9');
  });

  it('applies the selected theme to a shared diff worker pool', async () => {
    const setRenderOptions = vi.fn().mockResolvedValue(undefined);

    await applyDiffSyntaxTheme({ setRenderOptions }, 'tokyo-night-storm');

    expect(setRenderOptions).toHaveBeenCalledWith({ theme: 'git-gud-tokyo-night' });
  });
});
