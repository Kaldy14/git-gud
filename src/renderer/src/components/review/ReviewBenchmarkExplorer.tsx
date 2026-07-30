import { useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  Beaker,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import type { DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import type {
  DiffSyntaxTheme,
  ReviewGroupingBenchmarkPreview,
  ReviewGroupingBenchmarkSummary
} from '@shared/types';

import {
  DEFAULT_REVIEW_PREFERENCES,
  type ReviewPreferences
} from './reviewFilters';
import { ReviewView } from './ReviewView';

type ReviewBenchmarkExplorerProps = {
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onClose: () => void;
};

type PreviewMode = 'expected' | 'actual';

const preferredInitialDatasetId = 'two-independent-features-cross-same-files';
const emptyBenchmarks: ReviewGroupingBenchmarkSummary[] = [];
const benchmarkReviewPreferences: ReviewPreferences = {
  ...DEFAULT_REVIEW_PREFERENCES,
  skipTests: false,
  skipGenerated: false
};

export function ReviewBenchmarkExplorer({
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onClose
}: ReviewBenchmarkExplorerProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<PreviewMode>('expected');
  const benchmarksQuery = useQuery({
    queryKey: ['dev-review-grouping-benchmarks'],
    queryFn: listReviewGroupingBenchmarks,
    staleTime: Number.POSITIVE_INFINITY
  });
  const benchmarks = benchmarksQuery.data ?? emptyBenchmarks;
  const activeSelectedId =
    selectedId ??
    benchmarks.find((item) => item.id === preferredInitialDatasetId)?.id ??
    benchmarks[0]?.id ??
    '';
  const previewQuery = useQuery({
    queryKey: ['dev-review-grouping-preview', activeSelectedId],
    queryFn: (): Promise<ReviewGroupingBenchmarkPreview> =>
      getReviewGroupingBenchmarkPreview(activeSelectedId),
    enabled: Boolean(activeSelectedId),
    staleTime: Number.POSITIVE_INFINITY
  });
  const preview = previewQuery.data;

  const selectedBenchmark = benchmarks.find(
    (benchmark) => benchmark.id === activeSelectedId
  );
  const plan = preview
    ? mode === 'expected'
      ? preview.expectedPlan
      : preview.actualPlan
    : undefined;

  return (
    <section
      className="fixed inset-x-0 bottom-0 top-9 z-50 flex min-h-0 flex-col border-t border-[var(--select-border)] bg-[var(--bg-app)] shadow-2xl shadow-black/70"
      aria-label="Review grouping benchmark explorer"
    >
      <header className="flex shrink-0 items-start justify-between gap-5 border-b border-[var(--border)] bg-[var(--bg-titlebar)] px-4 py-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--select-border)] bg-[var(--select-bg)] text-[var(--accent-2)]">
            <Beaker size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-semibold text-[var(--text-1)]">
                Review grouping benchmarks
              </h1>
              <span className="rounded border border-[var(--border)] bg-[var(--bg-field)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                Dev only
              </span>
            </div>
            <p className="mt-1 max-w-4xl text-[11px] leading-4 text-[var(--text-3)]">
              Expected shows the reviewer-authored grouping. Current shows the plan produced by Git Gud for the same real fixture diff.
            </p>
          </div>
        </div>
        <button
          className="icon-btn h-7 w-7 shrink-0"
          type="button"
          onClick={onClose}
          aria-label="Close review benchmark explorer"
          title="Close benchmark explorer"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph)] px-4 py-2">
        <label className="flex min-w-64 flex-1 items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
            Case
          </span>
          <select
            className="h-8 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-field)] px-2.5 text-xs text-[var(--text-1)] outline-none focus:border-[var(--select-border)]"
            value={activeSelectedId}
            disabled={benchmarksQuery.isLoading || benchmarks.length === 0}
            aria-label="Review grouping benchmark case"
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {benchmarks.map((benchmark) => (
              <option key={benchmark.id} value={benchmark.id}>
                {benchmark.title}
              </option>
            ))}
          </select>
        </label>

        <div className="segmented shrink-0" aria-label="Benchmark plan mode">
          <button
            type="button"
            data-active={mode === 'expected'}
            onClick={() => setMode('expected')}
          >
            Expected
          </button>
          <button
            type="button"
            data-active={mode === 'actual'}
            onClick={() => setMode('actual')}
          >
            Current
          </button>
        </div>

        <button
          className="icon-btn icon-btn-compact shrink-0"
          type="button"
          disabled={!activeSelectedId || previewQuery.isFetching}
          onClick={() => {
            void Promise.all([
              benchmarksQuery.refetch(),
              previewQuery.refetch()
            ]);
          }}
          aria-label="Reload review benchmark fixture"
          title="Reload benchmark after editing its fixture"
        >
          <RefreshCw
            size={13}
            className={previewQuery.isFetching ? 'animate-spin' : undefined}
          />
        </button>

        {preview ? (
          <div className="flex shrink-0 items-center gap-2 text-[10px] text-[var(--text-3)]">
            <span className="rounded border border-[var(--border)] bg-[var(--bg-field)] px-2 py-1">
              {preview.benchmark.expectedUnitCount} expected units · {preview.benchmark.chunkCount} chunks
            </span>
            <span
              className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-field)] px-2 py-1"
              title={`${preview.wronglySplit.length} wrongly split pairs and ${preview.wronglyMerged.length} wrongly merged pairs`}
            >
              <GitCompareArrows size={11} />
              Current match {formatScore(preview.score)}
            </span>
          </div>
        ) : null}
      </div>

      {selectedBenchmark ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-app)] px-4 py-2 text-[10px] text-[var(--text-3)]">
          <span className="mr-1 text-[11px] text-[var(--text-2)]">
            {selectedBenchmark.description}
          </span>
          {selectedBenchmark.tags.map((tag) => (
            <span
              className="rounded-full border border-[var(--border)] bg-[var(--bg-field)] px-1.5 py-0.5"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {benchmarksQuery.isLoading || previewQuery.isLoading ? (
          <BenchmarkMessage icon={<Loader2 size={16} className="animate-spin" />}>
            Materializing benchmark fixture…
          </BenchmarkMessage>
        ) : benchmarksQuery.error || previewQuery.error ? (
          <BenchmarkMessage icon={<AlertTriangle size={16} />} tone="danger">
            {errorMessage(benchmarksQuery.error ?? previewQuery.error)}
          </BenchmarkMessage>
        ) : plan ? (
          <ReviewView
            key={`${activeSelectedId}:${mode}`}
            repoPath={plan.repoPath}
            target={plan.target}
            plan={plan}
            initialPreferences={benchmarkReviewPreferences}
            reviewProgressKey={`benchmark:${activeSelectedId}:${mode}`}
            diffStyle={diffStyle}
            diffSyntaxTheme={diffSyntaxTheme}
            onSetDiffStyle={onSetDiffStyle}
            onClose={onClose}
            showCloseButton={false}
          />
        ) : (
          <BenchmarkMessage icon={<Beaker size={16} />}>
            No review grouping benchmarks are registered.
          </BenchmarkMessage>
        )}
      </div>
    </section>
  );
}

function BenchmarkMessage({
  children,
  icon,
  tone = 'default'
}: {
  children: ReactElement | string | undefined;
  icon: ReactElement;
  tone?: 'default' | 'danger';
}): ReactElement {
  return (
    <div
      className={`grid flex-1 place-items-center text-xs ${
        tone === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--text-3)]'
      }`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="flex items-center gap-2">
        {icon}
        {children}
      </span>
    </div>
  );
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function listReviewGroupingBenchmarks(): Promise<ReviewGroupingBenchmarkSummary[]> {
  const loadBenchmarks = window.api.listReviewGroupingBenchmarks;
  if (!loadBenchmarks) {
    return Promise.reject(new Error('Review grouping benchmarks are only available in development.'));
  }
  return loadBenchmarks();
}

function getReviewGroupingBenchmarkPreview(
  datasetId: string
): Promise<ReviewGroupingBenchmarkPreview> {
  const loadPreview = window.api.getReviewGroupingBenchmarkPreview;
  if (!loadPreview) {
    return Promise.reject(new Error('Review grouping benchmarks are only available in development.'));
  }
  return loadPreview(datasetId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load the review benchmark.';
}
