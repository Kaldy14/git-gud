import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash2,
  Clock,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  House,
  Loader2,
  RefreshCw,
  Search,
  Workflow,
  X,
  XCircle
} from 'lucide-react';

import { workflowRunPresentation } from '@renderer/components/dashboard/workflowRunPresentation';
import { useGitHubWorkflowRunDetail } from '@renderer/queries/github';
import type {
  GitHubWorkflowJob,
  GitHubWorkflowRun,
  GitHubWorkflowStep
} from '@shared/types';

import {
  findWorkflowJobMatches,
  stepWorkflowJobMatch,
  workflowJobNameSegments
} from './workflowJobSearch';
import {
  isSkippedWorkflowJob,
  layoutWorkflowJobGraph,
  workflowGraphEdgePath
} from './workflowRunGraph';

const NO_JOBS: GitHubWorkflowJob[] = [];

type WorkflowJobSearchState = {
  query: string;
  matchJobIds: ReadonlySet<number>;
  activeJobId?: number;
};

type WorkflowRunViewProps = {
  profileId: string;
  owner: string;
  repository: string;
  run: GitHubWorkflowRun;
  onBack: () => void;
};

export function WorkflowRunView({
  profileId,
  owner,
  repository,
  run,
  onBack
}: WorkflowRunViewProps): ReactElement {
  const detailQuery = useGitHubWorkflowRunDetail({
    profileId,
    owner,
    repository,
    runId: run.id
  });
  const [selectedJobId, setSelectedJobId] = useState<number>();
  const jobs = detailQuery.data?.jobs ?? NO_JOBS;
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const completedJobs = detailQuery.data?.jobs.filter(
    (job) => job.status === 'completed'
  ).length;
  const totalJobs = detailQuery.data?.totalJobCount ?? 0;
  const [skippedJobsExpanded, setSkippedJobsExpanded] = useState(false);
  const activeJobs = useMemo(() => jobs.filter((job) => !isSkippedWorkflowJob(job)), [jobs]);
  const skippedJobs = useMemo(() => jobs.filter(isSkippedWorkflowJob), [jobs]);

  const sectionRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [activeMatchJobId, setActiveMatchJobId] = useState<number>();
  const [revealRequest, setRevealRequest] = useState<{ jobId: number; nonce: number }>();
  const matchJobIds = useMemo(
    () => (isSearchOpen ? findWorkflowJobMatches(jobs, searchQuery) : []),
    [isSearchOpen, jobs, searchQuery]
  );
  // Polling can reorder or drop jobs; fall back to the first match without moving the viewport.
  const storedMatchIndex =
    activeMatchJobId === undefined ? -1 : matchJobIds.indexOf(activeMatchJobId);
  const activeMatchIndex =
    storedMatchIndex >= 0 ? storedMatchIndex : matchJobIds.length > 0 ? 0 : -1;
  const search = useMemo<WorkflowJobSearchState | undefined>(
    () =>
      isSearchOpen && searchQuery.trim()
        ? {
            query: searchQuery,
            matchJobIds: new Set(matchJobIds),
            activeJobId: matchJobIds[activeMatchIndex]
          }
        : undefined,
    [activeMatchIndex, isSearchOpen, matchJobIds, searchQuery]
  );
  // Skipped jobs start collapsed, but a search hit or a selected skipped job must stay visible.
  const showSkipped =
    skippedJobsExpanded ||
    skippedJobs.some(
      (job) => job.id === selectedJobId || search?.matchJobIds.has(job.id) === true
    );

  const openSearchRef = useRef(() => {});

  useEffect(() => {
    openSearchRef.current = () => {
      if (!isSearchOpen) {
        const activeElement = document.activeElement;
        restoreFocusRef.current =
          activeElement instanceof HTMLElement && activeElement !== document.body
            ? activeElement
            : null;
        setIsSearchOpen(true);
      }
      setSearchFocusSignal((signal) => signal + 1);
    };
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'f'
      ) {
        return;
      }
      const section = sectionRef.current;
      // Modal surfaces mark the workspace inert; leave their keyboard handling alone.
      if (!section || section.closest('[inert]')) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        !section.contains(target) &&
        (isEditableElement(target) || target.closest('[role="dialog"], [role="menu"]'))
      ) {
        return;
      }

      // Capture phase keeps the workspace-wide commit search from also opening.
      event.preventDefault();
      event.stopPropagation();
      openSearchRef.current();
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    if (!revealRequest) {
      return;
    }
    const section = sectionRef.current;
    section
      ?.querySelectorAll<HTMLElement>(`[data-workflow-job-id="${revealRequest.jobId}"]`)
      .forEach((element) => {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
  }, [revealRequest]);

  function revealJob(jobId: number | undefined): void {
    if (jobId !== undefined) {
      setRevealRequest((previous) => ({ jobId, nonce: (previous?.nonce ?? 0) + 1 }));
    }
  }

  function handleSearchQueryChange(query: string): void {
    const nextMatches = findWorkflowJobMatches(jobs, query);
    setSearchQuery(query);
    setActiveMatchJobId(nextMatches[0]);
    revealJob(nextMatches[0]);
  }

  function handleStepMatch(direction: 1 | -1): void {
    const nextIndex = stepWorkflowJobMatch(activeMatchIndex, matchJobIds.length, direction);
    const nextJobId = matchJobIds[nextIndex];
    setActiveMatchJobId(nextJobId);
    revealJob(nextJobId);
  }

  function handleCloseSearch(): void {
    setIsSearchOpen(false);
    setSearchQuery('');
    setActiveMatchJobId(undefined);
    setRevealRequest(undefined);
    const restoreTarget = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restoreTarget?.isConnected) {
      restoreTarget.focus({ preventScroll: true });
    }
  }

  function renderJobNavItem(job: GitHubWorkflowJob): ReactElement {
    return (
      <button
        className="workflow-run-nav-item workflow-run-job-nav"
        data-active={selectedJobId === job.id}
        data-workflow-job-id={job.id}
        {...workflowJobSearchAttributes(job.id, search)}
        type="button"
        key={job.id}
        onClick={() => setSelectedJobId(job.id)}
      >
        <StatusIcon item={job} size={13} />
        <WorkflowJobName name={job.name} search={search} />
      </button>
    );
  }

  function handleSectionKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (isSearchOpen && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      handleCloseSearch();
    }
  }

  return (
    <section
      className="workflow-run-view"
      aria-label={`Workflow run ${run.displayTitle}`}
      ref={sectionRef}
      onKeyDown={handleSectionKeyDown}
    >
      <header className="workflow-run-view-header">
        <button className="workflow-run-back" type="button" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>{owner}/{repository}</span>
        </button>
        <span className="workflow-run-view-separator" aria-hidden="true">/</span>
        <div className="workflow-run-view-title">
          <StatusIcon item={run} size={19} />
          <h1>{run.displayTitle}</h1>
          <span>#{run.runNumber}</span>
        </div>
        <a
          className="btn-subtle workflow-run-github-link"
          href={run.url}
          target="_blank"
          rel="noreferrer"
        >
          Open on GitHub
          <ExternalLink size={12} />
        </a>
      </header>

      <div className="workflow-run-view-layout">
        <aside
          className="workflow-run-sidebar"
          aria-label="Workflow run navigation"
          data-searching={isSearchOpen || undefined}
        >
          {isSearchOpen ? (
            <WorkflowJobSearchBar
              query={searchQuery}
              matchCount={matchJobIds.length}
              activeMatchIndex={activeMatchIndex}
              focusSignal={searchFocusSignal}
              onQueryChange={handleSearchQueryChange}
              onPrevious={() => handleStepMatch(-1)}
              onNext={() => handleStepMatch(1)}
              onClose={handleCloseSearch}
            />
          ) : null}
          <button
            className="workflow-run-nav-item"
            data-active={selectedJobId === undefined}
            type="button"
            onClick={() => setSelectedJobId(undefined)}
          >
            <House size={14} />
            <span>Summary</span>
          </button>
          <div className="workflow-run-sidebar-heading">
            <span>All jobs</span>
            {totalJobs > 0 ? <span>{completedJobs ?? 0}/{totalJobs}</span> : null}
          </div>
          {activeJobs.map(renderJobNavItem)}
          {skippedJobs.length > 0 ? (
            <button
              className="workflow-run-nav-item workflow-run-skipped-nav"
              type="button"
              aria-expanded={showSkipped}
              onClick={() => setSkippedJobsExpanded(!showSkipped)}
            >
              {showSkipped ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>{skippedJobsLabel(skippedJobs.length)}</span>
            </button>
          ) : null}
          {showSkipped ? skippedJobs.map(renderJobNavItem) : null}
          {detailQuery.isLoading ? (
            <div className="workflow-run-sidebar-loading">
              <Loader2 size={13} className="animate-spin" /> Loading jobs…
            </div>
          ) : null}
        </aside>

        <main className="workflow-run-main">
          {detailQuery.error && !detailQuery.data ? (
            <div className="workflow-run-load-error" role="alert">
              <XCircle size={18} />
              <div>
                <strong>Could not load workflow jobs</strong>
                <span>{errorMessage(detailQuery.error)}</span>
              </div>
              <button className="btn-subtle" type="button" onClick={() => void detailQuery.refetch()}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : selectedJob ? (
            <WorkflowJobDetail job={selectedJob} />
          ) : (
            <WorkflowRunSummary
              run={run}
              owner={owner}
              jobs={jobs}
              dependencyGraphAvailable={
                detailQuery.data?.dependencyGraphAvailable === true
              }
              isLoading={detailQuery.isLoading}
              skippedJobCount={skippedJobs.length}
              showSkipped={showSkipped}
              search={search}
              onSelectJob={setSelectedJobId}
              onShowSkippedChange={setSkippedJobsExpanded}
            />
          )}
        </main>
      </div>
    </section>
  );
}

function WorkflowRunSummary({
  run,
  owner,
  jobs,
  dependencyGraphAvailable,
  isLoading,
  skippedJobCount,
  showSkipped,
  search,
  onSelectJob,
  onShowSkippedChange
}: {
  run: GitHubWorkflowRun;
  owner: string;
  jobs: GitHubWorkflowJob[];
  dependencyGraphAvailable: boolean;
  isLoading: boolean;
  skippedJobCount: number;
  showSkipped: boolean;
  search: WorkflowJobSearchState | undefined;
  onSelectJob: (jobId: number) => void;
  onShowSkippedChange: (showSkipped: boolean) => void;
}): ReactElement {
  const presentation = workflowRunPresentation(run);
  const duration = formatDuration(run.startedAt, run.updatedAt, run.status !== 'completed');

  return (
    <div className="workflow-run-summary-page">
      <section className="workflow-run-graph" aria-label={`${run.name} jobs`}>
        <header>
          <div className="workflow-run-graph-title">
            <Workflow size={14} />
            <strong>{run.name}</strong>
            <dl className="workflow-run-facts" aria-label="Workflow run facts">
              <div>
                <dt>Status</dt>
                <dd data-tone={presentation.tone}>{presentation.label}</dd>
              </div>
              <div>
                <dt>Trigger</dt>
                <dd>
                  {formatEvent(run.event)} by {run.actor ?? owner}
                </dd>
              </div>
              <div>
                <dt>Total duration</dt>
                <dd>
                  <Clock size={11} /> {duration}
                </dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd>
                  <GitCommitHorizontal size={11} /> {run.sha.slice(0, 7)}
                </dd>
              </div>
            </dl>
          </div>
          <div className="workflow-run-graph-actions">
            {skippedJobCount > 0 ? (
              <button
                className="btn-subtle workflow-run-skipped-toggle"
                type="button"
                aria-expanded={showSkipped}
                onClick={() => onShowSkippedChange(!showSkipped)}
              >
                {showSkipped ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showSkipped ? 'Hide' : 'Show'} {skippedJobsLabel(skippedJobCount)}
              </button>
            ) : null}
            {run.branch ? (
              <span className="workflow-run-branch-chip">
                <GitBranch size={11} /> {run.branch}
              </span>
            ) : null}
          </div>
        </header>
        {isLoading && jobs.length === 0 ? (
          <div className="workflow-run-graph-loading">
            <Loader2 size={18} className="animate-spin" />
            Loading workflow jobs…
          </div>
        ) : jobs.length > 0 ? (
          <WorkflowDependencyGraph
            jobs={jobs}
            showSkipped={showSkipped}
            search={search}
            onSelectJob={onSelectJob}
            onShowSkipped={() => onShowSkippedChange(true)}
          />
        ) : (
          <div className="workflow-run-graph-empty">
            <CircleSlash2 size={18} /> No jobs were reported for this run.
          </div>
        )}
      </section>
      {!isLoading && jobs.length > 0 && !dependencyGraphAvailable ? (
        <p className="workflow-run-graph-note">
          Dependency information was unavailable for this workflow revision.
        </p>
      ) : null}
    </div>
  );
}

type WorkflowGraphEdge = {
  sourceKey: string;
  targetKey: string;
  path: string;
};

function WorkflowDependencyGraph({
  jobs,
  showSkipped,
  search,
  onSelectJob,
  onShowSkipped
}: {
  jobs: GitHubWorkflowJob[];
  showSkipped: boolean;
  search: WorkflowJobSearchState | undefined;
  onSelectJob: (jobId: number) => void;
  onShowSkipped: () => void;
}): ReactElement {
  const { columns, nodeKeyByJobId } = useMemo(
    () => layoutWorkflowJobGraph(jobs, showSkipped),
    [jobs, showSkipped]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState<WorkflowGraphEdge[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const measuredContainer = container;
    let frame: number | undefined;
    let disposed = false;

    function measure(): void {
      frame = undefined;
      const containerBounds = measuredContainer.getBoundingClientRect();
      // Collapsed skipped jobs share one node, so their edges are rerouted to it and deduped.
      const seenEdgeKeys = new Set<string>();
      const nextEdges = jobs.flatMap((job) => {
        const targetKey = nodeKeyByJobId.get(job.id);
        const target = targetKey === undefined ? undefined : nodeRefs.current.get(targetKey);
        if (targetKey === undefined || !target) {
          return [];
        }
        const targetBounds = target.getBoundingClientRect();

        return job.dependencyJobIds.flatMap((dependencyJobId) => {
          const sourceKey = nodeKeyByJobId.get(dependencyJobId);
          const source = sourceKey === undefined ? undefined : nodeRefs.current.get(sourceKey);
          const edgeKey = `${sourceKey}->${targetKey}`;
          if (
            sourceKey === undefined ||
            !source ||
            sourceKey === targetKey ||
            seenEdgeKeys.has(edgeKey)
          ) {
            return [];
          }
          seenEdgeKeys.add(edgeKey);
          const sourceBounds = source.getBoundingClientRect();
          const sourceX = sourceBounds.right - containerBounds.left;
          const sourceY = sourceBounds.top - containerBounds.top + sourceBounds.height / 2;
          const targetX = targetBounds.left - containerBounds.left;
          const targetY = targetBounds.top - containerBounds.top + targetBounds.height / 2;

          return [
            {
              sourceKey,
              targetKey,
              path: workflowGraphEdgePath(sourceX, sourceY, targetX, targetY)
            }
          ];
        });
      });

      const width = measuredContainer.clientWidth;
      const height = measuredContainer.clientHeight;
      setCanvasSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
      setEdges((previous) => (sameWorkflowGraphEdges(previous, nextEdges) ? previous : nextEdges));
    }

    function scheduleMeasure(): void {
      if (!disposed && frame === undefined) {
        frame = window.requestAnimationFrame(measure);
      }
    }

    measure();
    // Wrapped job names change individual card heights (and so edge anchors) without
    // necessarily resizing the canvas, so every node is observed alongside the container.
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(measuredContainer);
    for (const node of nodeRefs.current.values()) {
      observer.observe(node);
    }
    window.addEventListener('resize', scheduleMeasure);
    void document.fonts?.ready.then(scheduleMeasure);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [jobs, columns, nodeKeyByJobId]);

  return (
    <div className="workflow-run-job-scroll">
      <div className="workflow-run-job-columns" ref={containerRef}>
        {edges.length > 0 ? (
          <svg
            className="workflow-run-job-edges"
            width={canvasSize.width}
            height={canvasSize.height}
            viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
            aria-hidden="true"
          >
            {edges.map((edge) => (
              <path
                d={edge.path}
                key={`${edge.sourceKey}->${edge.targetKey}`}
              />
            ))}
          </svg>
        ) : null}
        {columns.map((column, columnIndex) => (
          <div className="workflow-run-job-column" key={columnIndex}>
            {column.map((node) => {
              const ref = (element: HTMLButtonElement | null): void => {
                if (element) {
                  nodeRefs.current.set(node.key, element);
                } else {
                  nodeRefs.current.delete(node.key);
                }
              };
              if (node.kind === 'skipped') {
                return (
                  <button
                    className="workflow-run-job-card workflow-run-skipped-card"
                    type="button"
                    key={node.key}
                    ref={ref}
                    data-tone="neutral"
                    title={node.jobs.map((job) => job.name).join('\n')}
                    aria-label={`Show ${skippedJobsLabel(node.jobs.length)}`}
                    onClick={onShowSkipped}
                  >
                    <CircleSlash2 size={13} />
                    <span>{skippedJobsLabel(node.jobs.length)}</span>
                    <ChevronDown size={12} />
                  </button>
                );
              }
              const { job } = node;
              return (
                <button
                  className="workflow-run-job-card"
                  type="button"
                  key={node.key}
                  ref={ref}
                  data-tone={workflowRunPresentation(job).tone}
                  data-workflow-job-id={job.id}
                  {...workflowJobSearchAttributes(job.id, search)}
                  onClick={() => onSelectJob(job.id)}
                >
                  <StatusIcon item={job} size={13} />
                  <WorkflowJobName name={job.name} search={search} />
                  <small>
                    {formatDuration(
                      job.startedAt,
                      job.completedAt,
                      job.status !== 'completed'
                    )}
                  </small>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function sameWorkflowGraphEdges(
  previous: WorkflowGraphEdge[],
  next: WorkflowGraphEdge[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (edge, index) =>
        edge.path === next[index].path &&
        edge.sourceKey === next[index].sourceKey &&
        edge.targetKey === next[index].targetKey
    )
  );
}

function skippedJobsLabel(count: number): string {
  return `${count} skipped ${count === 1 ? 'job' : 'jobs'}`;
}

function WorkflowJobSearchBar({
  query,
  matchCount,
  activeMatchIndex,
  focusSignal,
  onQueryChange,
  onPrevious,
  onNext,
  onClose
}: {
  query: string;
  matchCount: number;
  activeMatchIndex: number;
  focusSignal: number;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.trim().length > 0;
  const noMatches = hasQuery && matchCount === 0;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [focusSignal]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    }
  }

  return (
    <div className="workflow-job-search" role="search" aria-label="Find jobs">
      <div className="workflow-job-search-field" data-empty={noMatches || undefined}>
        <Search size={12} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          autoComplete="off"
          spellCheck="false"
          aria-label="Find jobs by name"
          aria-invalid={noMatches || undefined}
          placeholder="Find jobs"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className="workflow-job-search-count" aria-live="polite">
          {noMatches
            ? 'No matches'
            : hasQuery
              ? `${activeMatchIndex + 1} of ${matchCount}`
              : ''}
        </span>
      </div>
      <button
        className="review-comment-action review-comment-icon-action"
        type="button"
        aria-label="Previous matching job"
        title="Previous match (Shift Enter)"
        disabled={matchCount === 0}
        onClick={onPrevious}
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="review-comment-action review-comment-icon-action"
        type="button"
        aria-label="Next matching job"
        title="Next match (Enter)"
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <ChevronDown size={14} />
      </button>
      <button
        className="review-comment-action review-comment-icon-action"
        type="button"
        aria-label="Close job search"
        title="Close (Escape)"
        onClick={onClose}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function WorkflowJobName({
  name,
  search
}: {
  name: string;
  search: WorkflowJobSearchState | undefined;
}): ReactElement {
  if (!search) {
    return <span className="workflow-run-job-name">{name}</span>;
  }
  return (
    <span className="workflow-run-job-name">
      {workflowJobNameSegments(name, search.query).map((segment, index) =>
        segment.match ? <mark key={index}>{segment.text}</mark> : segment.text
      )}
    </span>
  );
}

function workflowJobSearchAttributes(
  jobId: number,
  search: WorkflowJobSearchState | undefined
): Record<string, boolean | undefined> {
  if (!search) {
    return {};
  }
  return {
    'data-search-match': search.matchJobIds.has(jobId),
    'data-search-active': search.activeJobId === jobId || undefined
  };
}

function WorkflowJobDetail({ job }: { job: GitHubWorkflowJob }): ReactElement {
  const presentation = workflowRunPresentation(job);

  return (
    <article className="workflow-job-detail">
      <header>
        <StatusIcon item={job} size={19} />
        <div>
          <h2>{job.name}</h2>
          <span data-tone={presentation.tone}>{presentation.label}</span>
        </div>
        <a href={job.url} target="_blank" rel="noreferrer" className="btn-subtle">
          View job on GitHub <ExternalLink size={11} />
        </a>
      </header>
      <div className="workflow-job-meta">
        <span>Duration <strong>{formatDuration(job.startedAt, job.completedAt, job.status !== 'completed')}</strong></span>
        {job.runnerName ? <span>Runner <strong>{job.runnerName}</strong></span> : null}
        {job.labels.length > 0 ? <span>Labels <strong>{job.labels.join(', ')}</strong></span> : null}
      </div>
      <div className="workflow-step-list">
        {job.steps.map((step) => (
          <WorkflowStepRow step={step} key={step.number} />
        ))}
        {job.steps.length === 0 ? (
          <div className="workflow-step-empty">No step details are available for this job.</div>
        ) : null}
      </div>
    </article>
  );
}

function WorkflowStepRow({ step }: { step: GitHubWorkflowStep }): ReactElement {
  const presentation = workflowRunPresentation(step);
  return (
    <div className="workflow-step-row">
      <StatusIcon item={step} size={14} />
      <span>{step.name}</span>
      <small data-tone={presentation.tone}>{presentation.label}</small>
      <time>{formatDuration(step.startedAt, step.completedAt, step.status !== 'completed')}</time>
    </div>
  );
}

function StatusIcon({
  item,
  size
}: {
  item: Pick<GitHubWorkflowRun, 'status' | 'conclusion'>;
  size: number;
}): ReactElement {
  const presentation = workflowRunPresentation(item);
  if (presentation.icon === 'running') {
    return <Loader2 size={size} className="animate-spin" data-tone={presentation.tone} />;
  }
  if (presentation.icon === 'success') {
    return <CheckCircle2 size={size} data-tone={presentation.tone} />;
  }
  if (presentation.icon === 'failure') {
    return <XCircle size={size} data-tone={presentation.tone} />;
  }
  return <CircleSlash2 size={size} data-tone={presentation.tone} />;
}

function formatEvent(event: string): string {
  return event.replaceAll('_', ' ');
}

function formatDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
  running: boolean
): string {
  if (!startedAt) {
    return '–';
  }
  const start = Date.parse(startedAt);
  const end = running ? Date.now() : completedAt ? Date.parse(completedAt) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return '–';
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function isEditableElement(element: Element): boolean {
  return (
    (element instanceof HTMLElement && element.isContentEditable) ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
