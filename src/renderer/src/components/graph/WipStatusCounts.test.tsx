import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { GraphFile } from '@shared/types';

import { WipStatusCounts } from './WipStatusCounts';

describe('WIP status counts', () => {
  it('counts and renders each graph file status independently', () => {
    const files: GraphFile[] = [
      { path: 'edited-a.ts', status: 'modified' },
      { path: 'edited-b.ts', status: 'modified' },
      { path: 'added.ts', status: 'added' },
      { path: 'deleted.ts', status: 'deleted' }
    ];
    const markup = renderToStaticMarkup(<WipStatusCounts files={files} />);

    expect(markup).toContain('aria-label="2 modified files"');
    expect(markup).toContain('aria-label="1 added file"');
    expect(markup).toContain('aria-label="1 deleted file"');
  });

  it('renders only non-zero categories with accessible labels', () => {
    const markup = renderToStaticMarkup(
      <WipStatusCounts
        files={[
          { path: 'edited.ts', status: 'modified' },
          { path: 'added.ts', status: 'added' }
        ]}
      />
    );

    expect(markup).toContain('aria-label="1 modified file"');
    expect(markup).toContain('lucide-pencil');
    expect(markup).toContain('aria-label="1 added file"');
    expect(markup).toContain('lucide-plus');
    expect(markup).not.toContain('deleted file');
    expect(markup).not.toContain('lucide-minus');
  });
});
