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
      preloadDiffSyntaxHighlighter('src/first.ts'),
      preloadDiffSyntaxHighlighter('src/second.ts')
    ]);
    await preloadDiffSyntaxHighlighter('src/third.ts');

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(1);
    expect(pierreDiffs.getHighlighterOptions).toHaveBeenCalledWith('typescript', {});
  });

  it('loads different languages independently', async () => {
    const { preloadDiffSyntaxHighlighter } = await import('./useDiffSyntaxHighlighter');

    await Promise.all([
      preloadDiffSyntaxHighlighter('src/component.tsx'),
      preloadDiffSyntaxHighlighter('src/service.ts')
    ]);

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(2);
  });

  it('allows a failed language load to be retried', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pierreDiffs.preloadHighlighter
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce();
    const { preloadDiffSyntaxHighlighter } = await import('./useDiffSyntaxHighlighter');

    await preloadDiffSyntaxHighlighter('src/first.ts');
    await preloadDiffSyntaxHighlighter('src/second.ts');

    expect(pierreDiffs.preloadHighlighter).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
