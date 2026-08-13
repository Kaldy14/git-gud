import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash2,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  House,
  Loader2,
  RefreshCw,
  Workflow,
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
  arrangeWorkflowJobGraph,
  workflowGraphEdgePath
} from './workflowRunGraph';

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
  const selectedJob = detailQuery.data?.jobs.find((job) => job.id === selectedJobId);
  const completedJobs = detailQuery.data?.jobs.filter(
    (job) => job.status === 'completed'
  ).length;
  const totalJobs = detailQuery.data?.totalJobCount ?? 0;

  return (
    <section className="workflow-run-view" aria-label={`Workflow run ${run.displayTitle}`}>
      <header className="workflow-run-view-header">
        <button className="workflow-run-back" type="button" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>{owner}/{repository}</span>
        </button>
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
        <aside className="workflow-run-sidebar" aria-label="Workflow run navigation">
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
          {detailQuery.data?.jobs.map((job) => (
            <button
              className="workflow-run-nav-item workflow-run-job-nav"
              data-active={selectedJobId === job.id}
              type="button"
              key={job.id}
              onClick={() => setSelectedJobId(job.id)}
            >
              <StatusIcon item={job} size={13} />
              <span title={job.name}>{job.name}</span>
            </button>
          ))}
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
              jobs={detailQuery.data?.jobs ?? []}
              dependencyGraphAvailable={
                detailQuery.data?.dependencyGraphAvailable === true
              }
              isLoading={detailQuery.isLoading}
              onSelectJob={setSelectedJobId}
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
  onSelectJob
}: {
  run: GitHubWorkflowRun;
  owner: string;
  jobs: GitHubWorkflowJob[];
  dependencyGraphAvailable: boolean;
  isLoading: boolean;
  onSelectJob: (jobId: number) => void;
}): ReactElement {
  const presentation = workflowRunPresentation(run);
  const duration = formatDuration(run.startedAt, run.updatedAt, run.status !== 'completed');

  return (
    <div className="workflow-run-summary-page">
      <section className="workflow-run-facts" aria-label="Workflow run facts">
        <div>
          <span>Triggered via {formatEvent(run.event)}</span>
          <strong>{run.actor ?? owner} triggered this run</strong>
        </div>
        <div>
          <span>Status</span>
          <strong data-tone={presentation.tone}>{presentation.label}</strong>
        </div>
        <div>
          <span>Total duration</span>
          <strong>{duration}</strong>
        </div>
        <div>
          <span>Commit</span>
          <strong className="workflow-run-fact-ref">
            <GitCommitHorizontal size={12} /> {run.sha.slice(0, 7)}
          </strong>
        </div>
      </section>

      <section className="workflow-run-graph" aria-label={`${run.name} jobs`}>
        <header>
          <div>
            <Workflow size={15} />
            <span>
              <strong>{run.name}</strong>
              <small>on: {formatEvent(run.event)}</small>
            </span>
          </div>
          {run.branch ? (
            <span className="workflow-run-branch-chip">
              <GitBranch size={11} /> {run.branch}
            </span>
          ) : null}
        </header>
        {isLoading && jobs.length === 0 ? (
          <div className="workflow-run-graph-loading">
            <Loader2 size={18} className="animate-spin" />
            Loading workflow jobs…
          </div>
        ) : jobs.length > 0 ? (
          <WorkflowDependencyGraph jobs={jobs} onSelectJob={onSelectJob} />
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
  sourceJobId: number;
  targetJobId: number;
  path: string;
};

function WorkflowDependencyGraph({
  jobs,
  onSelectJob
}: {
  jobs: GitHubWorkflowJob[];
  onSelectJob: (jobId: number) => void;
}): ReactElement {
  const columns = useMemo(() => arrangeWorkflowJobGraph(jobs), [jobs]);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, HTMLButtonElement>());
  const [edges, setEdges] = useState<WorkflowGraphEdge[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const measuredContainer = container;

    function measure(): void {
      const containerBounds = measuredContainer.getBoundingClientRect();
      const nextEdges = jobs.flatMap((job) => {
        const target = nodeRefs.current.get(job.id);
        if (!target) {
          return [];
        }
        const targetBounds = target.getBoundingClientRect();

        return job.dependencyJobIds.flatMap((dependencyJobId) => {
          const source = nodeRefs.current.get(dependencyJobId);
          if (!source) {
            return [];
          }
          const sourceBounds = source.getBoundingClientRect();
          const sourceX = sourceBounds.right - containerBounds.left;
          const sourceY = sourceBounds.top - containerBounds.top + sourceBounds.height / 2;
          const targetX = targetBounds.left - containerBounds.left;
          const targetY = targetBounds.top - containerBounds.top + targetBounds.height / 2;

          return [
            {
              sourceJobId: dependencyJobId,
              targetJobId: job.id,
              path: workflowGraphEdgePath(sourceX, sourceY, targetX, targetY)
            }
          ];
        });
      });

      setCanvasSize({
        width: Math.max(
          measuredContainer.scrollWidth,
          measuredContainer.clientWidth
        ),
        height: Math.max(
          measuredContainer.scrollHeight,
          measuredContainer.clientHeight
        )
      });
      setEdges(nextEdges);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measuredContainer);
    return () => observer.disconnect();
  }, [jobs, columns]);

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
                key={`${edge.sourceJobId}:${edge.targetJobId}`}
              />
            ))}
          </svg>
        ) : null}
        {columns.map((column, columnIndex) => (
          <div className="workflow-run-job-column" key={columnIndex}>
            {column.map((job) => (
              <button
                className="workflow-run-job-card"
                type="button"
                key={job.id}
                ref={(node) => {
                  if (node) {
                    nodeRefs.current.set(job.id, node);
                  } else {
                    nodeRefs.current.delete(job.id);
                  }
                }}
                data-tone={workflowRunPresentation(job).tone}
                onClick={() => onSelectJob(job.id)}
              >
                <StatusIcon item={job} size={13} />
                <span title={job.name}>{job.name}</span>
                <small>
                  {formatDuration(
                    job.startedAt,
                    job.completedAt,
                    job.status !== 'completed'
                  )}
                </small>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
