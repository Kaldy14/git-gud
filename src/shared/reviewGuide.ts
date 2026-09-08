export function reviewGuidePatchAddsLine(patch: string, targetLine: number): boolean {
  return reviewGuidePatchChangesLine(patch, targetLine, 'right');
}

export function reviewGuidePatchChangesRange(patch: string, start: number, end: number, side: 'left' | 'right'): boolean {
  return patch.split(/(?=^@@ )/mu).some((hunk) =>
    reviewGuidePatchChangesLine(hunk, start, side) && reviewGuidePatchChangesLine(hunk, end, side));
}

export function reviewGuidePatchChangesLine(patch: string, targetLine: number, side: 'left' | 'right'): boolean {
  let newLine = 0;
  let oldLine = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      if (side === 'right' && newLine === targetLine) {
        return true;
      }
      newLine += 1;
    } else if (line.startsWith('-')) {
      if (side === 'left' && oldLine === targetLine) return true;
      oldLine += 1;
    } else {
      newLine += 1;
      oldLine += 1;
    }
  }

  return false;
}
