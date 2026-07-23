import { beforeEach, describe, expect, it, vi } from 'vitest';

const pierreDiffs = vi.hoisted(() => ({
  getFiletypeFromFileName: vi.fn((filePath: string) => filePath.endsWith('.tsx') ? 'tsx' : 'typescript'),
  getHighlighterOptions: vi.fn((language: string) => ({ langs: [language], themes: [] })),
  preloadHighlighter: vi.fn<() => Promise<void>>()
}));

vi.mock('@pierre/diffs', () => pierreDiffs);

describe('preloadDiffSyntaxHighlighter', () => {
  beforeEach(() => {
    vi.resetModules();
    pierreDiffs.getFiletypeFromFileName.mockClear();
    pierreDiffs.getHighlighterOptions.mockClear();
    pierreDiffs.preloadHighlighter.mockReset().mockResolvedValue();
  });

  it('deduplicates concurrent and completed loads by language', async () => {
    const { preloadDiffSyntaxHighlighter } = await import('./useDiffSyntaxHighlighter');

    await Promise.all([
      preloadDiffSyntaxHighlighter('src/first.ts', 'git-gud-dark'),
      preloadDiffSyntaxHighlighter('src/second.ts', 'git-gud-dark')
    ]);
    await preloadDiffSyntaxHighlighter('src/third.ts', 'git-gud-dark');

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(1);
    expect(pierreDiffs.getHighlighterOptions).toHaveBeenCalledWith('typescript', {
      theme: 'dark-plus'
    });
  });

  it('loads different languages independently', async () => {
    const { preloadDiffSyntaxHighlighter } = await import('./useDiffSyntaxHighlighter');

    await Promise.all([
      preloadDiffSyntaxHighlighter('src/component.tsx', 'git-gud-dark'),
      preloadDiffSyntaxHighlighter('src/service.ts', 'git-gud-dark')
    ]);

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(2);
  });

  it('loads the same language independently for each syntax theme', async () => {
    const { preloadDiffSyntaxHighlighter } = await import('./useDiffSyntaxHighlighter');

    await preloadDiffSyntaxHighlighter('src/service.ts', 'git-gud-dark');
    await preloadDiffSyntaxHighlighter('src/service.ts', 'tokyo-night-storm');

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(2);
    expect(pierreDiffs.getHighlighterOptions).toHaveBeenLastCalledWith('typescript', {
      theme: 'tokyo-night'
    });
  });

  it('allows a failed language load to be retried', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pierreDiffs.preloadHighlighter
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce();
    const { preloadDiffSyntaxHighlighter } = await import('./useDiffSyntaxHighlighter');

    await preloadDiffSyntaxHighlighter('src/first.ts', 'git-gud-dark');
    await preloadDiffSyntaxHighlighter('src/second.ts', 'git-gud-dark');

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
