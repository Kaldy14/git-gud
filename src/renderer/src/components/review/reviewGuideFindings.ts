import { reviewGuidePatchChangesLine } from '@shared/reviewGuide';
import type { VisibleReviewUnit } from './reviewFilters';
import type { ReviewLineComment } from './ReviewView';

export type ReviewGuideFinding = { comment: ReviewLineComment; severity: 'critical' | 'major' | 'minor' | 'nitpick' };

export function createReviewGuideFindings(units: readonly VisibleReviewUnit[], comments: readonly ReviewLineComment[]) {
  const result = new Map<string, ReviewGuideFinding[]>();
  for (const comment of comments) {
    if (comment.isDraft || comment.inReplyToId !== undefined || comment.isResolved || comment.isOutdated) continue;
    // Read explicit reviewer severity headers, never infer a defect from prose or AI complexity.
    if (!/^coderabbitai(?:\[bot\])?$/iu.test(comment.author)) continue;
    const header = comment.body.split(/```|<details/iu)[0]!.slice(0, 400);
    const label = header.match(/(?:🔴|🟠|🟡|🔵)\s*[*_]*(critical|major|minor|nitpick)(?=[*_\s|]|$)/iu)?.[1]?.toLowerCase();
    if (label !== 'critical' && label !== 'major' && label !== 'minor' && label !== 'nitpick') continue;
    const candidates = units.filter((unit) => unit.unit.chunks.some((chunk) => chunk.path === comment.path));
    const owner = candidates.find((unit) => comment.line !== undefined && unit.unit.chunks.some((chunk) =>
      chunk.path === comment.path && reviewGuidePatchChangesLine(chunk.patch, comment.line!, comment.side ?? 'right')
    )) ?? candidates[0];
    if (!owner) continue;
    const findings = result.get(owner.unit.id) ?? [];
    findings.push({ comment, severity: label });
    result.set(owner.unit.id, findings);
  }
  return result;
}

export function findingCounts(findings: readonly ReviewGuideFinding[]) {
  return (['critical', 'major', 'minor', 'nitpick'] as const).flatMap((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length;
    return count ? [{ severity, count }] : [];
  });
}
