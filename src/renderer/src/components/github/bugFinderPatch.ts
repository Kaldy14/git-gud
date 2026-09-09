import { reviewGuidePatchLines } from '@shared/reviewGuide';
import type { BugFindingContent } from '@shared/bugFinder';

export function bugFinderPatch(patch: string, location: BugFindingContent['location']): string | undefined {
  const hunk = reviewGuidePatchLines(patch).find(row => row[location.side] === location.line)?.hunk;
  if (!hunk) return undefined;
  // Keep original file headers (including rename/deletion metadata) and real
  // hunk coordinates so the PR renderer uses the correct language and gutters.
  const parts = patch.split(/(?=^@@ )/mu);
  return parts[0] + parts[hunk]!;
}
