import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

type CommitSearchBarProps = {
  query: string;
  resultCount: number;
  activeResultIndex: number;
  focusSignal: number;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function CommitSearchBar({
  query,
  resultCount,
  activeResultIndex,
  focusSignal,
  onQueryChange,
  onPrevious,
  onNext,
  onClose
}: CommitSearchBarProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultPosition = activeResultIndex >= 0 ? activeResultIndex + 1 : 0;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [focusSignal]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.currentTarget.select();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      if (event.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    }
  }

  return (
    <div className="commit-search-bar" role="search" aria-label="Search commit history">
      <Search size={17} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        autoComplete="off"
        spellCheck="false"
        aria-label="Search by commit SHA, title, or description"
        placeholder="SHA, title, or description"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="commit-search-count" aria-live="polite">
        {resultPosition} of {resultCount}
      </span>
      <button
        type="button"
        aria-label="Previous commit search result"
        title="Previous result (Shift Enter)"
        disabled={resultCount === 0}
        onClick={onPrevious}
      >
        <ChevronUp size={17} />
      </button>
      <button
        type="button"
        aria-label="Next commit search result"
        title="Next result (Enter)"
        disabled={resultCount === 0}
        onClick={onNext}
      >
        <ChevronDown size={17} />
      </button>
      <button type="button" aria-label="Close commit search" title="Close (Escape)" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
  );
}
