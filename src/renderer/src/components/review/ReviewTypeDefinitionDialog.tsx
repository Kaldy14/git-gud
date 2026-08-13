import type { ReactElement } from 'react';
import { useId } from 'react';
import { AlertTriangle, Braces, Loader2, X } from 'lucide-react';

import { File } from '@pierre/diffs/react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import { getDiffThemeName } from '@renderer/components/diff/diffTheme';
import type { DiffSyntaxTheme, GitReviewTypeDefinitionResult } from '@shared/types';

export function ReviewTypeDefinitionDialog({
  result,
  token,
  sourcePath,
  isLoading = false,
  errorMessage,
  syntaxTheme = 'git-gud-dark',
  onClose
}: {
  result?: GitReviewTypeDefinitionResult;
  token?: string;
  sourcePath?: string;
  isLoading?: boolean;
  errorMessage?: string;
  syntaxTheme?: DiffSyntaxTheme;
  onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const lineLabel = result
    ? result.snippetStartLine === result.snippetEndLine
      ? `Line ${result.snippetStartLine}`
      : `Lines ${result.snippetStartLine}–${result.snippetEndLine}`
    : undefined;
  const title = result?.name ?? token ?? 'Definition';

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="review-type-definition-dialog"
      onClose={onClose}
    >
      <header>
        <span className="review-type-definition-icon" aria-hidden="true">
          <Braces size={16} />
        </span>
        <div>
          <span>{result?.kind === 'type-definition' ? 'Type definition' : 'Definition'}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        {result ? <span className="badge-mini">{result.declarationKind}</span> : null}
        <button
          className="icon-btn icon-btn-regular"
          type="button"
          data-modal-initial-focus="true"
          onClick={onClose}
          aria-label="Close definition preview"
        >
          <X size={15} />
        </button>
      </header>

      <div className="review-type-definition-location" id={descriptionId}>
        <code title={result?.path ?? sourcePath}>{result?.path ?? sourcePath}</code>
        {lineLabel ? <span>{lineLabel}</span> : null}
      </div>

      <div className="review-type-definition-code">
        {result ? (
          <File
            className="gg-definition-file"
            file={{
              name: result.path,
              contents: result.snippet,
              cacheKey: `review-definition:${result.path}:${result.start}:${result.end}`
            }}
            options={{
              theme: getDiffThemeName(syntaxTheme),
              themeType: 'dark',
              disableFileHeader: true,
              stickyHeader: false,
              overflow: 'scroll'
            }}
          />
        ) : (
          <div className="review-type-definition-message" role={errorMessage ? 'alert' : 'status'}>
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <AlertTriangle size={18} />}
            <span>{isLoading ? 'Resolving this TypeScript symbol…' : errorMessage}</span>
          </div>
        )}
      </div>

      <footer>
        <span>Read-only preview from the reviewed TypeScript snapshot.</span>
        <button className="btn-primary h-8 text-xs" type="button" onClick={onClose}>Close</button>
      </footer>
    </ModalSurface>
  );
}
