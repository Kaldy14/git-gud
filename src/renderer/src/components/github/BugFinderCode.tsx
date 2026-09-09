import { EvidenceFileLink } from '../review/EvidenceFileLink';
import { useMemo } from 'react';
import { FileDiff, PatchDiff } from '@pierre/diffs/react';
import type { BugFindingContent } from '@shared/bugFinder';
import type { DiffSyntaxTheme, GitHubPullRequestDetail } from '@shared/types';
import { reviewGuidePatchContainsLine } from '@shared/reviewGuide';
import { createDiffOptionsBase, type DiffStyle } from '../commit/fileDetailUtils';
import { prepareReviewDiff } from '../review/reviewContextDiff';
import { createReviewContextOptions } from '../review/reviewContextExpansion';
import { bugFinderPatch } from './bugFinderPatch';

export function BugFinderCode({ detail, location, diffSyntaxTheme, diffStyle, onOpenFile }: {
  onOpenFile?: () => void;
  detail: GitHubPullRequestDetail;
  location: BugFindingContent['location'];
  diffSyntaxTheme: DiffSyntaxTheme;
  diffStyle: DiffStyle;
}) {
  const file = detail.files.find((f) => f.path === location.path);
  const patch = file?.patch ? bugFinderPatch(file.patch, location) : undefined;
  const plan = detail.reviewPlan;
  const findingPath = location.path;
  const findingLine = location.line;
  const findingSide = location.side;
  const preparedDiff = useMemo(() => {
    const chunk = plan.units.flatMap(unit => unit.chunks).find(chunk =>
      chunk.path === findingPath &&
      reviewGuidePatchContainsLine(chunk.patch, findingLine, findingSide)
    );
    if (!chunk) return undefined;
    const context = plan.fileContexts.find(context => context.id === chunk.fileContextId);
    return prepareReviewDiff(chunk, context, plan.targetKey);
  }, [plan, findingPath, findingLine, findingSide]);
  const diffOptions = useMemo(() => {
    const options = {
      ...createDiffOptionsBase(diffSyntaxTheme),
      diffStyle,
      disableFileHeader: true
    };
    return preparedDiff?.expandable
      ? createReviewContextOptions(options, preparedDiff.expandable, findingPath)
      : options;
  }, [diffSyntaxTheme, diffStyle, preparedDiff, findingPath]);
  const selectedLines = {
    start: location.line,
    end: location.endLine,
    side: location.side === 'right' ? 'additions' as const : 'deletions' as const
  };
  return (
    <div className="bug-finder-code">
      <header>
        {onOpenFile ? <EvidenceFileLink reference={{ path: location.path, line: location.line }} onOpen={onOpenFile} /> : location.path} · {location.side} side
      </header>
      {preparedDiff ? (
        <FileDiff
          className="gg-diff"
          fileDiff={preparedDiff.fileDiff}
          options={diffOptions}
          selectedLines={selectedLines}
        />
      ) : patch ? (
        <PatchDiff
          className="gg-diff"
          patch={patch}
          options={diffOptions}
          selectedLines={selectedLines}
        />
      ) : <p className="bug-finder-empty">Diff context is unavailable at this location.</p>}
    </div>
  );
}
