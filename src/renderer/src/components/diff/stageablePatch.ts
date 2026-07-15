export type StageablePatchHunk = {
  id: string;
  header: string;
  patch: string;
  additions: number;
  deletions: number;
  preview: string;
};

export function parseStageablePatchHunks(patch: string | undefined): StageablePatchHunk[] {
  if (!patch) {
    return [];
  }

  const lines = splitPatchLines(patch);
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));

  if (firstHunkIndex === -1) {
    return [];
  }

  const headerLines = lines.slice(0, firstHunkIndex);

  if (hasUnsupportedPatchHeader(headerLines)) {
    return [];
  }

  const hunks: StageablePatchHunk[] = [];
  let hunkStart = firstHunkIndex;

  while (hunkStart < lines.length) {
    const hunkEnd = findNextHunkIndex(lines, hunkStart + 1);
    const hunkLines = lines.slice(hunkStart, hunkEnd);
    const header = hunkLines[0]?.trim() ?? '';
    const bodyLines = hunkLines.slice(1);
    const additions = bodyLines.filter(isPatchAdditionLine).length;
    const deletions = bodyLines.filter(isPatchDeletionLine).length;

    if (header && (additions > 0 || deletions > 0)) {
      hunks.push({
        id: `${hunkStart}:${header}`,
        header,
        patch: ensureTrailingNewline([...headerLines, ...hunkLines].join('')),
        additions,
        deletions,
        preview: previewPatchLine(bodyLines)
      });
    }

    hunkStart = hunkEnd;
  }

  return hunks;
}

function splitPatchLines(patch: string): string[] {
  const rawLines = patch.split('\n');
  return rawLines
    .map((line, index) => (index < rawLines.length - 1 ? `${line}\n` : line))
    .filter((line) => line.length > 0);
}

function findNextHunkIndex(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index]?.startsWith('@@')) {
      return index;
    }
  }

  return lines.length;
}

function hasUnsupportedPatchHeader(headerLines: string[]): boolean {
  return headerLines.some((line) =>
    /^(Binary files |GIT binary patch|rename from |rename to |copy from |copy to |similarity index |dissimilarity index )/.test(line)
  );
}

function isPatchAdditionLine(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++');
}

function isPatchDeletionLine(line: string): boolean {
  return line.startsWith('-') && !line.startsWith('---');
}

function previewPatchLine(lines: string[]): string {
  const changedLine = lines.find((line) => isPatchAdditionLine(line) || isPatchDeletionLine(line));
  return changedLine ? changedLine.slice(1).trim() : '';
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}
