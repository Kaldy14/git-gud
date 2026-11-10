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
  CircleDashed,
  CircleDotDashed,
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

import { isQueuedWorkflowRun, workflowRunPresentation } from '@renderer/components/dashboard/workflowRunPresentation';
import { useGitHubWorkflowRunDetail } from '@renderer/queries/github';
import type {
  GitHubWorkflowJob,
  GitHubWorkflowRun,
  GitHubWorkflowRunStatus,
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
  workflowFailureFlow
} from './workflowRunGraph';
import {
  computeWorkflowGraphGeometry,
  workflowGraphEdgeKey,
  type WorkflowGraphEdge,
  type WorkflowGraphRect
} from './workflowRunGraphLayout';
import {
  groupWorkflowJobsByState,
  workflowJobState,
  type WorkflowJobState
} from './workflowJobState';

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
  const jobGroups = useMemo(() => groupWorkflowJobsByState(jobs), [jobs]);
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
        data-state={workflowJobState(job)}
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
          {jobGroups.map((group) => (
            <div
              className="workflow-run-nav-group"
              role="group"
              aria-label={`${group.label} jobs`}
              key={group.state}
            >
              {/* One group needs no label: "All jobs" already says it. */}
              {jobGroups.length > 1 ? (
                <div className="workflow-run-nav-group-heading" data-state={group.state}>
                  <span>{group.label}</span>
                  <span>{group.jobs.length}</span>
                </div>
              ) : null}
              {group.jobs.map(renderJobNavItem)}
            </div>
          ))}
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

        <main className="workflow-run-main" data-view={selectedJob ? 'job' : 'summary'}>
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
  const duration = formatDuration(run.startedAt, run.updatedAt, run.status);
  const graphRef = useRef<HTMLElement>(null);
  const tallyCursor = useRef(new Map<WorkflowJobState, number>());
  const groups = useMemo(() => groupWorkflowJobsByState(jobs), [jobs]);

  // Each press moves to the next job in that state, so two failures are two presses apart.
  function revealNext(state: WorkflowJobState, jobIds: number[]): void {
    const next = ((tallyCursor.current.get(state) ?? -1) + 1) % jobIds.length;
    tallyCursor.current.set(state, next);
    const card = graphRef.current?.querySelector<HTMLElement>(
      `.workflow-run-job-card[data-workflow-job-id="${jobIds[next]}"]`
    );
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card?.focus({ preventScroll: true });
  }

  return (
    <div className="workflow-run-summary-page">
      <section className="workflow-run-graph" aria-label={`${run.name} jobs`} ref={graphRef}>
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
            {groups.length > 0 ? (
              <div className="workflow-run-tally" role="group" aria-label="Jobs by status">
                {groups.map((group) => {
                  const label = `${group.jobs.length} ${group.label.toLowerCase()}`;
                  // Passed jobs are the background; only the states worth finding are buttons.
                  return group.state === 'passed' ? (
                    <span className="workflow-run-tally-item" data-state={group.state} key={group.state}>
                      <WorkflowJobStateIcon state={group.state} size={12} />
                      {label}
                    </span>
                  ) : (
                    <button
                      className="workflow-run-tally-item"
                      data-state={group.state}
                      type="button"
                      key={group.state}
                      title={`Go to the next ${group.label.toLowerCase()} job`}
                      onClick={() =>
                        revealNext(
                          group.state,
                          group.jobs.map((job) => job.id)
                        )
                      }
                    >
                      <WorkflowJobStateIcon state={group.state} size={12} />
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
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
  const layout = useMemo(() => layoutWorkflowJobGraph(jobs, showSkipped), [jobs, showSkipped]);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<string, WorkflowCardSize>>(() => new Map());
  const [hoveredKey, setHoveredKey] = useState<string>();
  const [focusedKey, setFocusedKey] = useState<string>();

  // Polling replaces `jobs` on every refresh while the shape of the graph rarely moves,
  // so the geometry is keyed on that shape instead of on the array.
  const structureKey = useMemo(
    () =>
      JSON.stringify([
        layout.columns.map((column) => column.map((node) => node.key)),
        layout.edges.map((edge) => [edge.source, edge.target])
      ]),
    [layout]
  );
  const nodesByKey = useMemo(
    () => new Map(layout.columns.flat().map((node) => [node.key, node])),
    [layout]
  );

  // The flow around a failed job is always drawn: what it held up, in red, and what the
  // first failure of a chain was waiting for.
  const pinned = useMemo(() => {
    const failed = new Set(
      layout.columns.flatMap((column) =>
        column
          .filter((node) => node.kind === 'job' && workflowJobState(node.job) === 'failed')
          .map((node) => node.key)
      )
    );
    const edges = workflowFailureFlow(layout.edges, failed);
    return { failed, edges, key: edges.map(workflowGraphEdgeKey).join(' ') };
  }, [layout]);

  // Every other line appears on demand. Pointing at a job (or focusing it) draws all it
  // waits for and all that waits for it, and the rest of the graph steps back.
  const tracedKey = hoveredKey ?? focusedKey;
  const trace = useMemo(() => {
    if (tracedKey === undefined || !nodesByKey.has(tracedKey)) {
      return undefined;
    }
    const walk = (from: 'source' | 'target', to: 'source' | 'target'): Set<string> => {
      const reached = new Set<string>([tracedKey]);
      const queue = [tracedKey];
      while (queue.length > 0) {
        const current = queue.pop()!;
        for (const edge of layout.edges) {
          if (edge[from] === current && !reached.has(edge[to])) {
            reached.add(edge[to]);
            queue.push(edge[to]);
          }
        }
      }
      return reached;
    };
    const upstream = walk('target', 'source');
    const downstream = walk('source', 'target');
    return {
      keys: new Set([...upstream, ...downstream]),
      edges: layout.edges.filter(
        (edge) =>
          (upstream.has(edge.source) && upstream.has(edge.target)) ||
          (downstream.has(edge.source) && downstream.has(edge.target))
      )
    };
  }, [layout, nodesByKey, tracedKey]);

  const geometry = useMemo(
    () =>
      computeWorkflowGraphGeometry({
        columns: layout.columns.map((column) => column.map((node) => node.key)),
        heights: new Map([...sizes].map(([key, size]) => [key, size.height])),
        // A column is as wide as its longest name; one unmeasured card keeps it at full width.
        columnWidths: layout.columns.map((column) =>
          column.reduce<number | undefined>((width, node) => {
            const size = sizes.get(node.key);
            return width === undefined || !size ? undefined : Math.max(width, size.naturalWidth);
          }, 0)
        ),
        pinnedEdges: pinned.edges,
        tracedEdges: trace?.edges
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys stand in for layout, pinned and trace
    [structureKey, sizes, pinned.key, tracedKey]
  );

  // A card's height and the width its name needs are only known once it is in the
  // document. Measuring feeds the geometry, which sets the widths, so this re-runs until
  // nothing moves (a pass or two, before paint). The budget stops a size that never
  // settles from re-rendering forever.
  const [measureRequest, requestMeasure] = useState(0);
  const settleBudget = useRef(MEASURE_PASSES_PER_FRAME);
  useLayoutEffect(() => {
    let changed = sizes.size !== nodeRefs.current.size;
    const next = new Map<string, WorkflowCardSize>();
    for (const [key, element] of nodeRefs.current) {
      const size = measureWorkflowCard(element);
      const before = sizes.get(key);
      next.set(key, size);
      changed ||= before?.height !== size.height || before.naturalWidth !== size.naturalWidth;
    }
    if (!changed || settleBudget.current <= 0) {
      return;
    }
    if (settleBudget.current === MEASURE_PASSES_PER_FRAME) {
      window.requestAnimationFrame(() => {
        settleBudget.current = MEASURE_PASSES_PER_FRAME;
      });
    }
    settleBudget.current -= 1;
    setSizes(next);
    // `layout` changes with every refresh, when a longer duration can widen a card.
  }, [sizes, layout, measureRequest]);

  // Fonts and zoom change card sizes without a render, so they ask for a new pass.
  useEffect(() => {
    let frame: number | undefined;
    const schedule = (): void => {
      frame ??= window.requestAnimationFrame(() => {
        frame = undefined;
        requestMeasure((count) => count + 1);
      });
    };
    const observer = new ResizeObserver(schedule);
    for (const node of nodeRefs.current.values()) {
      observer.observe(node);
    }
    void document.fonts?.ready.then(schedule);
    return () => {
      observer.disconnect();
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [structureKey]);

  // Opening a run answers "what failed" (or "what is running") without scrolling: the
  // graph is often wider than the window and those jobs sit in its later columns.
  const revealedRef = useRef(false);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (revealedRef.current || !scroller || sizes.size === 0) {
      return;
    }
    revealedRef.current = true;
    const rectsIn = (state: WorkflowJobState): WorkflowGraphRect[] =>
      layout.columns.flatMap((column) =>
        column.flatMap((node) => {
          const rect = geometry.nodes.get(node.key);
          return rect && node.kind === 'job' && workflowJobState(node.job) === state ? [rect] : [];
        })
      );
    const failed = rectsIn('failed');
    const targets = failed.length > 0 ? failed : rectsIn('running');
    if (targets.length > 0) {
      revealWorkflowCards(scroller, targets);
    }
  }, [geometry, layout, sizes]);

  const pathOf = (edges: WorkflowGraphEdge[]): string =>
    edges
      .map((edge) => geometry.paths.get(workflowGraphEdgeKey(edge)))
      .filter((path) => path !== undefined)
      .join(' ');
  const inputPath = pathOf(pinned.edges.filter((edge) => !pinned.failed.has(edge.source)));
  const failedPath = pathOf(pinned.edges.filter((edge) => pinned.failed.has(edge.source)));
  const tracedPath = trace ? pathOf(trace.edges) : '';

  return (
    <div className="workflow-run-job-scroll" ref={scrollRef}>
      <div
        className="workflow-run-job-canvas"
        data-tracing={trace ? true : undefined}
        style={{ width: geometry.width, height: geometry.height }}
      >
        <svg
          className="workflow-run-job-edges"
          width={geometry.width}
          height={geometry.height}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          aria-hidden="true"
        >
          {inputPath ? <path className="workflow-run-job-edge" d={inputPath} /> : null}
          {failedPath ? (
            <path className="workflow-run-job-edge" data-state="failed" d={failedPath} />
          ) : null}
          {tracedPath ? (
            <path className="workflow-run-job-edge" data-state="traced" d={tracedPath} />
          ) : null}
        </svg>
        {layout.columns.flat().map((node) => {
          const { key } = node;
          const rect = geometry.nodes.get(key);
          if (!rect) {
            return null;
          }
          const placement = {
            style: { left: rect.x, top: rect.y, width: rect.width },
            'data-trace': trace
              ? key === tracedKey
                ? 'self'
                : trace.keys.has(key)
                  ? 'linked'
                  : undefined
              : undefined,
            ref: (element: HTMLButtonElement | null): void => {
              if (element) {
                nodeRefs.current.set(key, element);
              } else {
                nodeRefs.current.delete(key);
              }
            },
            onPointerEnter: () => setHoveredKey(key),
            onPointerLeave: () => setHoveredKey((current) => (current === key ? undefined : current)),
            onFocus: () => setFocusedKey(key),
            onBlur: () => setFocusedKey((current) => (current === key ? undefined : current))
          };
          if (node.kind === 'skipped') {
            return (
              <button
                className="workflow-run-job-card workflow-run-skipped-card"
                type="button"
                key={key}
                {...placement}
                data-state="skipped"
                title={node.jobs.map((job) => job.name).join('\n')}
                aria-label={`Show ${skippedJobsLabel(node.jobs.length)}`}
                onClick={onShowSkipped}
              >
                <CircleSlash2 size={13} />
                <span className="workflow-run-job-text">
                  <ChevronDown size={12} />
                  <span className="workflow-run-job-name">{skippedJobsLabel(node.jobs.length)}</span>
                </span>
              </button>
            );
          }
          const { job } = node;
          const state = workflowJobState(job);
          // A skipped job never ran, so it has no duration worth a column of "0s".
          const timing =
            state === 'queued'
              ? 'Queued'
              : state === 'skipped'
                ? ''
                : formatDuration(job.startedAt, job.completedAt, job.status);
          return (
            <button
              className="workflow-run-job-card"
              type="button"
              key={key}
              {...placement}
              data-state={state}
              data-workflow-job-id={job.id}
              {...workflowJobSearchAttributes(job.id, search)}
              aria-label={`${job.name}, ${workflowRunPresentation(job).label}${
                state === 'queued' || timing === '' || timing === '–' ? '' : `, ${timing}`
              }`}
              onClick={() => onSelectJob(job.id)}
            >
              <StatusIcon item={job} size={13} />
              {/* The time floats, so a long name wraps under it instead of beside it. */}
              <span className="workflow-run-job-text">
                <small>{timing}</small>
                <WorkflowJobName name={job.name} search={search} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MEASURE_PASSES_PER_FRAME = 6;

type WorkflowCardSize = { height: number; naturalWidth: number };

/**
 * A card's height at its current width, and the width it would need to keep its name
 * on one line. A name that already wraps asks for the full column.
 */
function measureWorkflowCard(card: HTMLElement): WorkflowCardSize {
  const text = card.querySelector<HTMLElement>('.workflow-run-job-text');
  const name = card.querySelector<HTMLElement>('.workflow-run-job-name');
  const aside = text?.firstElementChild;
  if (!text || !name || !aside) {
    return { height: card.offsetHeight, naturalWidth: Number.POSITIVE_INFINITY };
  }
  const lines = new Set([...name.getClientRects()].map((rect) => Math.round(rect.top)));
  if (lines.size > 1) {
    return { height: card.offsetHeight, naturalWidth: Number.POSITIVE_INFINITY };
  }
  const asideStyle = window.getComputedStyle(aside);
  return {
    height: card.offsetHeight,
    naturalWidth: Math.ceil(
      card.offsetWidth -
        text.clientWidth +
        name.getBoundingClientRect().width +
        aside.getBoundingClientRect().width +
        Number.parseFloat(asideStyle.marginLeft) +
        1
    )
  };
}

const REVEAL_MARGIN = 20;

/** Scrolls the least distance that brings the cards into view; the first wins if not all fit. */
function revealWorkflowCards(scroller: HTMLElement, rects: WorkflowGraphRect[]): void {
  const canvas = scroller.firstElementChild;
  if (!(canvas instanceof HTMLElement)) {
    return;
  }
  const originX = canvas.offsetLeft;
  const originY = canvas.offsetTop;
  const fits = (axis: 'x' | 'y', size: 'width' | 'height', viewport: number): number => {
    const first = rects[0][axis];
    let start = first;
    let end = first + rects[0][size];
    for (const rect of rects) {
      const nextStart = Math.min(start, rect[axis]);
      const nextEnd = Math.max(end, rect[axis] + rect[size]);
      if (nextEnd - nextStart + REVEAL_MARGIN * 2 <= viewport) {
        start = nextStart;
        end = nextEnd;
      }
    }
    const origin = axis === 'x' ? originX : originY;
    const current = axis === 'x' ? scroller.scrollLeft : scroller.scrollTop;
    const lowest = origin + end + REVEAL_MARGIN - viewport;
    const highest = origin + start - REVEAL_MARGIN;
    return Math.max(0, Math.min(Math.max(current, lowest), highest));
  };
  scroller.scrollTo({
    left: fits('x', 'width', scroller.clientWidth),
    top: fits('y', 'height', scroller.clientHeight)
  });
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
        <span>Duration <strong>{formatDuration(job.startedAt, job.completedAt, job.status)}</strong></span>
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
      <time>{formatDuration(step.startedAt, step.completedAt, step.status)}</time>
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
    // Waiting and working are both blue; the missing centre dot tells them apart.
    return isQueuedWorkflowRun(item) ? (
      <CircleDashed size={size} data-tone={presentation.tone} />
    ) : (
      <CircleDotDashed size={size} data-tone={presentation.tone} />
    );
  }
  if (presentation.icon === 'success') {
    return <CheckCircle2 size={size} data-tone={presentation.tone} />;
  }
  if (presentation.icon === 'failure') {
    return <XCircle size={size} data-tone={presentation.tone} />;
  }
  return <CircleSlash2 size={size} data-tone={presentation.tone} />;
}

function WorkflowJobStateIcon({
  state,
  size
}: {
  state: WorkflowJobState;
  size: number;
}): ReactElement {
  if (state === 'failed') {
    return <XCircle size={size} />;
  }
  if (state === 'running') {
    return <CircleDotDashed size={size} />;
  }
  if (state === 'queued') {
    return <CircleDashed size={size} />;
  }
  if (state === 'passed') {
    return <CheckCircle2 size={size} />;
  }
  return <CircleSlash2 size={size} />;
}

function formatEvent(event: string): string {
  return event.replaceAll('_', ' ');
}

function formatDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
  status: GitHubWorkflowRunStatus
): string {
  if (!startedAt || isQueuedWorkflowRun({ status })) {
    return '–';
  }
  const start = Date.parse(startedAt);
  const end = status === 'in-progress' ? Date.now() : completedAt ? Date.parse(completedAt) : start;
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
