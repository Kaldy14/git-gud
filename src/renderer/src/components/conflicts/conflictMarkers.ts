export type ConflictMarker = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  ours: string;
  theirs: string;
};

type SourceLine = {
  text: string;
  startOffset: number;
  endOffset: number;
};

export function parseConflictMarkers(source: string): ConflictMarker[] {
  const lines = splitSourceLines(source);
  const conflicts: ConflictMarker[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!isMarker(lines[index]?.text, '<<<<<<<')) {
      index += 1;
      continue;
    }

    const startIndex = index;
    let baseIndex: number | undefined;
    let dividerIndex: number | undefined;
    let endIndex: number | undefined;
    index += 1;

    while (index < lines.length) {
      const line = lines[index];

      if (!line) {
        break;
      }

      if (baseIndex === undefined && dividerIndex === undefined && isMarker(line.text, '|||||||')) {
        baseIndex = index;
      } else if (dividerIndex === undefined && isMarker(line.text, '=======')) {
        dividerIndex = index;
      } else if (dividerIndex !== undefined && isMarker(line.text, '>>>>>>>')) {
        endIndex = index;
        break;
      }

      index += 1;
    }

    const startLine = lines[startIndex];
    const dividerLine = dividerIndex === undefined ? undefined : lines[dividerIndex];
    const endLine = endIndex === undefined ? undefined : lines[endIndex];

    if (!startLine || !dividerLine || !endLine || dividerIndex === undefined || endIndex === undefined) {
      index = startIndex + 1;
      continue;
    }

    const oursEnd = baseIndex ?? dividerIndex;
    conflicts.push({
      startOffset: startLine.startOffset,
      endOffset: endLine.endOffset,
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      ours: joinLines(lines, startIndex + 1, oursEnd),
      theirs: joinLines(lines, dividerIndex + 1, endIndex)
    });
    index = endIndex + 1;
  }

  return conflicts;
}

export function resolveConflictMarker(
  source: string,
  conflict: ConflictMarker,
  choice: 'ours' | 'theirs'
): string {
  return `${source.slice(0, conflict.startOffset)}${conflict[choice]}${source.slice(conflict.endOffset)}`;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let startOffset = 0;

  while (startOffset < source.length) {
    const newlineIndex = source.indexOf('\n', startOffset);
    const endOffset = newlineIndex === -1 ? source.length : newlineIndex + 1;
    lines.push({ text: source.slice(startOffset, endOffset), startOffset, endOffset });
    startOffset = endOffset;
  }

  return lines;
}

function isMarker(line: string | undefined, marker: string): boolean {
  return line?.replace(/\r?\n$/, '').startsWith(marker) ?? false;
}

function joinLines(lines: SourceLine[], startIndex: number, endIndex: number): string {
  return lines.slice(startIndex, endIndex).map((line) => line.text).join('');
}
