import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReviewTypeDefinitionDialog } from './ReviewTypeDefinitionDialog';

describe('ReviewTypeDefinitionDialog', () => {
  it('renders the resolved declaration and source location', () => {
    const markup = renderToStaticMarkup(
      <ReviewTypeDefinitionDialog
        result={{
          name: 'User',
          path: 'src/model.ts',
          kind: 'definition',
          declarationKind: 'interface',
          start: 0,
          end: 37,
          startLine: 1,
          startCharacter: 0,
          endLine: 3,
          endCharacter: 1,
          snippetStartLine: 1,
          snippetEndLine: 3,
          snippet: 'export interface User {\n  id: string;\n}'
        }}
        onClose={() => undefined}
      />
    );

    expect(markup).toContain('User');
    expect(markup).toContain('src/model.ts');
    expect(markup).toContain('Lines 1–3');
    expect(markup).toContain('gg-definition-file');
    expect(markup).toContain('Close definition preview');
  });
});
