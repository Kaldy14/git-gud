export function reviewGuidePatchAddsLine(patch: string, targetLine: number): boolean {
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      if (newLine === targetLine) {
        return true;
      }
      newLine += 1;
    } else if (!line.startsWith('-')) {
      newLine += 1;
    }
  }

  return false;
}
