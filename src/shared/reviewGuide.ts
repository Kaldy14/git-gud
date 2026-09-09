// Read actual patch rows, rather than trusting the line counts in hunk headers.
export function reviewGuidePatchLines(patch: string) {
  const rows: Array<{ hunk: number; left?: number; right?: number; text: string }> = [];
  let hunk = 0;
  let left = 0;
  let right = 0;
  for (const text of patch.split('\n')) {
    const header = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (header) {
      hunk++;
      left = Number(header[1]);
      right = Number(header[2]);
    } else if (hunk && text.startsWith('+')) {
      rows.push({ hunk, right: right++, text });
    } else if (hunk && text.startsWith('-')) {
      rows.push({ hunk, left: left++, text });
    } else if (hunk && text.startsWith(' ')) {
      rows.push({ hunk, left: left++, right: right++, text });
    }
  }
  return rows;
}

export function reviewGuidePatchAddsLine(patch: string, targetLine: number): boolean {
  return reviewGuidePatchChangesLine(patch, targetLine, 'right');
}

export function reviewGuidePatchContainsLine(patch: string, targetLine: number, side: 'left' | 'right'): boolean {
  return reviewGuidePatchLines(patch).some((row) => row[side] === targetLine);
}

export function reviewGuidePatchChangesRange(patch: string, start: number, end: number, side: 'left' | 'right'): boolean {
  const rows = reviewGuidePatchLines(patch);
  const first = rows.find((row) => row[side] === start);
  if (!first || !rows.some((row) => row.hunk === first.hunk && row[side] === end)) return false;
  // A useful explanation may include surrounding context, but must cover a change.
  return rows.some((row) => {
    const line = row[side];
    return row.hunk === first.hunk && line !== undefined && line >= start && line <= end &&
      row.text.startsWith(side === 'left' ? '-' : '+');
  });
}

export function reviewGuidePatchChangesLine(patch: string, targetLine: number, side: 'left' | 'right'): boolean {
  return reviewGuidePatchLines(patch).some((row) =>
    row[side] === targetLine && row.text.startsWith(side === 'left' ? '-' : '+'));
}
