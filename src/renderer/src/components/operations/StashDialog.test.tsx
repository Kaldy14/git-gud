import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { GitFileChangeDetail } from '@shared/types';

import {
  buildStashPushInput,
  createInitialStashSelection,
  setStashIncludeUntracked,
  StashDialog,
  toggleAllStashPaths,
  toggleStashPath
} from './StashDialog';

const files: GitFileChangeDetail[] = [
  file('src/tracked.ts', 'modified'),
  file('src/added.ts', 'added'),
  file('notes.txt', 'untracked'),
  { ...file('src/conflicted.ts', 'conflicted'), conflicted: true }
];

describe('StashDialog selection', () => {
  it('initially selects tracked files and excludes untracked and conflicted files', () => {
    expect(createInitialStashSelection(files)).toEqual({
      includeUntracked: false,
      selectedPaths: ['src/tracked.ts', 'src/added.ts']
    });
  });

  it('can start with one requested file selected, including an untracked file', () => {
    expect(createInitialStashSelection(files, ['notes.txt'])).toEqual({
      includeUntracked: true,
      selectedPaths: ['notes.txt']
    });
    expect(createInitialStashSelection(files, ['src/tracked.ts'])).toEqual({
      includeUntracked: false,
      selectedPaths: ['src/tracked.ts']
    });
  });

  it('selects untracked files when enabled and deselects them when disabled', () => {
    const initial = toggleStashPath(createInitialStashSelection(files), 'src/added.ts');
    const included = setStashIncludeUntracked(files, initial, true);

    expect(included).toEqual({
      includeUntracked: true,
      selectedPaths: ['src/tracked.ts', 'notes.txt']
    });
    expect(setStashIncludeUntracked(files, included, false)).toEqual({
      includeUntracked: false,
      selectedPaths: ['src/tracked.ts']
    });
  });

  it('toggles all currently eligible files without selecting disabled untracked files', () => {
    const initial = createInitialStashSelection(files);
    const noneSelected = toggleAllStashPaths(files, initial);

    expect(noneSelected.selectedPaths).toEqual([]);
    expect(toggleAllStashPaths(files, noneSelected).selectedPaths).toEqual(['src/tracked.ts', 'src/added.ts']);

    const withUntracked = setStashIncludeUntracked(files, noneSelected, true);
    expect(toggleAllStashPaths(files, withUntracked).selectedPaths).toEqual([
      'src/tracked.ts',
      'src/added.ts',
      'notes.txt'
    ]);
  });

  it('builds a stable stash input from selected eligible paths', () => {
    const selection = toggleStashPath(setStashIncludeUntracked(files, createInitialStashSelection(files), true), 'src/added.ts');

    expect(buildStashPushInput(files, selection, '  focused work  ')).toEqual({
      message: 'focused work',
      includeUntracked: true,
      paths: ['src/tracked.ts', 'notes.txt']
    });
  });
});

describe('StashDialog presentation', () => {
  it('renders accessible controls, disables untracked files, and omits conflicts', () => {
    const markup = renderToStaticMarkup(
      <StashDialog
        files={files}
        defaultMessage="WIP"
        isBusy={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(markup).toContain('Stash changes');
    expect(markup).toContain('value="WIP"');
    expect(markup).toContain('aria-label="Select all eligible files"');
    expect(markup).toContain('aria-label="Stash notes.txt"');
    expect(markup).toContain('Include untracked files');
    expect(markup).not.toContain('src/conflicted.ts');
  });

  it('disables submission when no tracked path is selected', () => {
    const markup = renderToStaticMarkup(
      <StashDialog
        files={[file('notes.txt', 'untracked')]}
        defaultMessage=""
        isBusy={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(markup).toContain('Stash selected</button>');
    expect(markup).toContain('type="submit" disabled=""');
  });

  it('announces a mixed select-all state for a single-file stash', () => {
    const markup = renderToStaticMarkup(
      <StashDialog
        files={files}
        defaultMessage="WIP: src/tracked.ts"
        initialPaths={['src/tracked.ts']}
        isBusy={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('1 of 2 selected');
  });
});

function file(path: string, status: GitFileChangeDetail['status']): GitFileChangeDetail {
  return {
    path,
    status,
    staged: status === 'added',
    unstaged: status !== 'added',
    conflicted: false
  };
}
