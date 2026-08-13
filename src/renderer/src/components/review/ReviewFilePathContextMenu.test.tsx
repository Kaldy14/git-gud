import { describe, expect, it, vi } from 'vitest';

import { copyReviewFilePath } from './reviewFilePathClipboard';

describe('copyReviewFilePath', () => {
  it('copies the complete repository-relative path', async () => {
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    };

    await copyReviewFilePath('apps/storefront/src/product.ts', clipboard);

    expect(clipboard.writeText).toHaveBeenCalledOnce();
    expect(clipboard.writeText).toHaveBeenCalledWith('apps/storefront/src/product.ts');
  });
});
