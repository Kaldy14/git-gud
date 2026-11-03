import { useMemo, type ReactElement } from 'react';
import type { DiffLineAnnotation } from '@pierre/diffs';
import { PatchDiff } from '@pierre/diffs/react';
import { ArrowUpRight } from 'lucide-react';

import type { PullRequestTourExcerpt, PullRequestTourExcerptSlice } from '@shared/pullRequestTour';
import type { DiffSyntaxTheme } from '@shared/types';
import { createDiffOptionsBase } from '../../commit/fileDetailUtils';
import { PullRequestLineStats } from '../PullRequestLineStats';

export type GuideNoteMarker = { marker: string; title: string; line: number };
export type GuideCodeLocation = { path: string; line?: number; endLine?: number; side?: 'left' | 'right' };

// One excerpt: a caption, a file header that opens the full file in Code, and only the excerpted rows.
export function GuideExcerpt({ excerpt, slice, markers, diffSyntaxTheme, onOpenFile, onRevealNote }: {
  excerpt: PullRequestTourExcerpt;
  slice: PullRequestTourExcerptSlice | undefined;
  markers: readonly GuideNoteMarker[];
  diffSyntaxTheme: DiffSyntaxTheme;
  onOpenFile: (location: GuideCodeLocation) => void;
  onRevealNote: (marker: string) => void;
}): ReactElement {
  const side = excerpt.side === 'new' ? 'right' : 'left';
  // Excerpts are short slices: always unified, and scroll long lines instead of wrapping
  // them back to column 0, as in T3 Code.
  const options = useMemo(() => ({
    ...createDiffOptionsBase<GuideNoteMarker[]>(diffSyntaxTheme),
    diffStyle: 'unified' as const,
    overflow: 'scroll' as const,
    disableFileHeader: true,
    hunkSeparators: 'simple' as const
  }), [diffSyntaxTheme]);
  const lineAnnotations = useMemo<DiffLineAnnotation<GuideNoteMarker[]>[]>(() => {
    const byLine = new Map<number, GuideNoteMarker[]>();
    for (const marker of markers) byLine.set(marker.line, [...(byLine.get(marker.line) ?? []), marker]);
    return [...byLine].map(([lineNumber, metadata]) => ({
      side: excerpt.side === 'new' ? 'additions' : 'deletions',
      lineNumber,
      metadata
    }));
  }, [markers, excerpt.side]);

  return (
    <figure className="pr-guide-excerpt">
      {excerpt.caption ? <figcaption>{excerpt.caption}</figcaption> : null}
      <div className="pr-guide-excerpt-frame">
        <header>
          <button
            type="button"
            className="pr-guide-file-link"
            title="Show these lines in the Code tab"
            onClick={() => onOpenFile({ path: excerpt.path, line: excerpt.start, endLine: excerpt.end, side })}
          >
            <span className="pr-guide-path">
              {excerpt.path.includes('/') ? <span className="pr-guide-path-dir">{excerpt.path.slice(0, excerpt.path.lastIndexOf('/') + 1)}</span> : null}
              <span className="pr-guide-path-base">{excerpt.path.split('/').at(-1)}</span>
            </span>
            <span className="pr-guide-range">
              {excerpt.side === 'old' ? 'removed ' : ''}{excerpt.end !== excerpt.start ? `lines ${excerpt.start}–${excerpt.end}` : `line ${excerpt.start}`}
            </span>
            <ArrowUpRight size={12} aria-hidden="true" />
          </button>
          {slice ? <PullRequestLineStats additions={slice.additions} deletions={slice.deletions} /> : null}
        </header>
        {slice ? (
          <PatchDiff<GuideNoteMarker[]>
            className="gg-diff"
            patch={slice.patch}
            options={options}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => (
              <div className="pr-guide-inline-markers">
                {annotation.metadata.map((marker) => (
                  <button
                    type="button"
                    key={marker.marker}
                    data-guide-marker-row={marker.marker}
                    title={`Read note ${marker.marker}`}
                    onClick={() => onRevealNote(marker.marker)}
                  >
                    <GuideMarker marker={marker.marker} />{marker.title}
                  </button>
                ))}
              </div>
            )}
          />
        ) : (
          <p className="pr-guide-excerpt-missing">
            These lines are not in the loaded diff, likely because the pull request changed after the guide was written.
          </p>
        )}
      </div>
    </figure>
  );
}

export function GuideMarker({ marker }: { marker: string }): ReactElement {
  return <span className="pr-guide-marker" aria-hidden="true">{marker}</span>;
}
