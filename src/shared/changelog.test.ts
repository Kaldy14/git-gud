import { describe, expect, it } from 'vitest';

import { extractReleaseNotes } from './changelog';

const changelog = `# Changelog

## [Unreleased]

### Added

- A future feature.

## [1.2.0] - 2026-08-30

### Added

- A new review mode.

### Fixed

- A long fix description that
  continues on the next line.

## [1.1.0] - 2026-08-20

### Changed

- An older change.
`;

describe('extractReleaseNotes', () => {
  it('extracts categorized notes for the packaged version', () => {
    expect(extractReleaseNotes(changelog, 'v1.2.0')).toEqual({
      version: '1.2.0',
      notes: [
        { category: 'Added', text: 'A new review mode.' },
        {
          category: 'Fixed',
          text: 'A long fix description that continues on the next line.'
        }
      ]
    });
  });

  it('uses Unreleased notes for a version not finalized in the changelog yet', () => {
    expect(extractReleaseNotes(changelog, '1.3.0')).toEqual({
      version: '1.3.0',
      notes: [{ category: 'Added', text: 'A future feature.' }]
    });
  });

  it('returns an empty release when neither section exists', () => {
    expect(extractReleaseNotes('# Changelog', '1.3.0')).toEqual({
      version: '1.3.0',
      notes: []
    });
  });
});
