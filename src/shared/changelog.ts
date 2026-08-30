export const releaseNoteCategories = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security'
] as const;

export type ReleaseNoteCategory = (typeof releaseNoteCategories)[number];

export type ReleaseNote = {
  category: ReleaseNoteCategory;
  text: string;
};

export type ReleaseNotes = {
  version: string;
  notes: ReleaseNote[];
};

export function extractReleaseNotes(markdown: string, version: string): ReleaseNotes {
  const normalizedVersion = version.trim().replace(/^v/, '');
  const releaseSection = findSection(markdown, normalizedVersion) ?? findSection(markdown, 'Unreleased');

  if (!releaseSection) {
    return { version: normalizedVersion, notes: [] };
  }

  const notes: ReleaseNote[] = [];
  let category: ReleaseNoteCategory = 'Changed';

  for (const line of releaseSection.split('\n')) {
    const categoryMatch = /^###\s+(.+?)\s*$/.exec(line);
    const matchedCategory = categoryMatch?.[1];

    if (matchedCategory && isReleaseNoteCategory(matchedCategory)) {
      category = matchedCategory;
      continue;
    }

    const noteMatch = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (noteMatch?.[1]) {
      notes.push({ category, text: noteMatch[1] });
      continue;
    }

    const continuation = /^\s{2,}(\S.+?)\s*$/.exec(line)?.[1];
    const previousNote = notes.at(-1);
    if (continuation && previousNote) {
      previousNote.text = `${previousNote.text} ${continuation}`;
    }
  }

  return { version: normalizedVersion, notes };
}

function findSection(markdown: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+\\[${escapedLabel}\\](?:\\s+-\\s+.+)?\\s*$`, 'm');
  const match = heading.exec(markdown);

  if (!match) {
    return undefined;
  }

  const sectionStart = match.index + match[0].length;
  const nextSectionOffset = markdown.slice(sectionStart).search(/^##\s+/m);
  const sectionEnd = nextSectionOffset === -1 ? markdown.length : sectionStart + nextSectionOffset;

  return markdown.slice(sectionStart, sectionEnd);
}

function isReleaseNoteCategory(value: string): value is ReleaseNoteCategory {
  return (releaseNoteCategories as readonly string[]).includes(value);
}
