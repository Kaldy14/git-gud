import type { GitHubWorkflowJob } from '@shared/types';

import type { WorkflowGraphEdge } from './workflowRunGraphLayout';

function workflowJobDepths(jobs: GitHubWorkflowJob[]): Map<number, number> {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const depthByJobId = new Map<number, number>();

  function jobDepth(jobId: number, visiting = new Set<number>()): number {
    const cached = depthByJobId.get(jobId);
    if (cached !== undefined) {
      return cached;
    }
    const job = jobsById.get(jobId);
    if (!job || visiting.has(jobId)) {
      return 0;
    }

    const dependencies = job.dependencyJobIds.filter((dependencyJobId) =>
      jobsById.has(dependencyJobId)
    );
    if (dependencies.length === 0) {
      depthByJobId.set(jobId, 0);
      return 0;
    }

    const nextVisiting = new Set(visiting).add(jobId);
    const depth = Math.max(
      ...dependencies.map(
        (dependencyJobId) => jobDepth(dependencyJobId, nextVisiting) + 1
      )
    );
    depthByJobId.set(jobId, depth);
    return depth;
  }

  for (const job of jobs) {
    jobDepth(job.id);
  }
  return depthByJobId;
}

export function arrangeWorkflowJobGraph(
  jobs: GitHubWorkflowJob[]
): GitHubWorkflowJob[][] {
  const depths = workflowJobDepths(jobs);
  const columns: GitHubWorkflowJob[][] = [];
  for (const job of jobs) {
    (columns[depths.get(job.id) ?? 0] ??= []).push(job);
  }

  return columns;
}

/**
 * The dependencies worth drawing: one that a longer chain already implies is dropped
 * (`deploy` needing `detect` and `build`, when `build` itself needs `detect`), since the
 * job waits for the chain either way. Workflows that list every upstream job in `needs`
 * otherwise bury the real order under redundant lines.
 *
 * With `bypassSkipped`, a job that ran is linked to the nearest jobs that ran before it:
 * a skipped job in between is looked through, so collapsed skipped jobs only ever end
 * a line and never relay one.
 */
export function reduceWorkflowJobDependencies(
  jobs: GitHubWorkflowJob[],
  bypassSkipped = false
): Map<number, number[]> {
  const depths = workflowJobDepths(jobs);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const dependenciesOf = (job: GitHubWorkflowJob): number[] => [
    ...new Set(
      job.dependencyJobIds.filter(
        // A dependency always sits in an earlier column; anything else is a cycle.
        (id) => jobsById.has(id) && (depths.get(id) ?? 0) < (depths.get(job.id) ?? 0)
      )
    )
  ];

  const ancestorsById = new Map<number, Set<number>>();
  function ancestors(jobId: number): Set<number> {
    const cached = ancestorsById.get(jobId);
    if (cached) {
      return cached;
    }
    const result = new Set<number>();
    for (const dependencyId of dependenciesOf(jobsById.get(jobId)!)) {
      result.add(dependencyId);
      for (const ancestor of ancestors(dependencyId)) {
        result.add(ancestor);
      }
    }
    ancestorsById.set(jobId, result);
    return result;
  }

  function nearestRan(job: GitHubWorkflowJob, found = new Set<number>()): Set<number> {
    for (const dependencyId of dependenciesOf(job)) {
      const dependency = jobsById.get(dependencyId)!;
      if (isSkippedWorkflowJob(dependency)) {
        nearestRan(dependency, found);
      } else {
        found.add(dependencyId);
      }
    }
    return found;
  }

  return new Map(
    jobs.map((job) => {
      const dependencies =
        bypassSkipped && !isSkippedWorkflowJob(job) ? [...nearestRan(job)] : dependenciesOf(job);
      return [
        job.id,
        dependencies.filter(
          (id) => !dependencies.some((other) => other !== id && ancestors(other).has(id))
        )
      ];
    })
  );
}

export function isSkippedWorkflowJob(job: GitHubWorkflowJob): boolean {
  return job.status === 'completed' && job.conclusion === 'skipped';
}

/**
 * The lines drawn without hovering: what each failed job held up, and what the first
 * failure of a chain was waiting for. A job that failed after one of its dependencies
 * failed only passes that failure on, so its other inputs stay hidden.
 */
export function workflowFailureFlow(
  edges: WorkflowGraphEdge[],
  failed: ReadonlySet<string>
): WorkflowGraphEdge[] {
  const inherited = new Set(
    edges.filter((edge) => failed.has(edge.source) && failed.has(edge.target)).map((edge) => edge.target)
  );
  return edges.filter(
    (edge) => failed.has(edge.source) || (failed.has(edge.target) && !inherited.has(edge.target))
  );
}

export type WorkflowGraphNode =
  | { kind: 'job'; key: string; job: GitHubWorkflowJob }
  | { kind: 'skipped'; key: string; jobs: GitHubWorkflowJob[] };

export type WorkflowGraphLayout = {
  columns: WorkflowGraphNode[][];
  /** Maps every job id to the key of the node that currently represents it. */
  nodeKeyByJobId: Map<number, string>;
  /** Reduced dependencies between nodes; collapsed skipped jobs share their node's lines. */
  edges: WorkflowGraphEdge[];
};

/**
 * Keeps each job in its dependency column, but folds a column's skipped jobs into a
 * single trailing node unless expanded so large conditional workflows stay readable.
 */
export function layoutWorkflowJobGraph(
  jobs: GitHubWorkflowJob[],
  showSkipped: boolean
): WorkflowGraphLayout {
  const nodeKeyByJobId = new Map<number, string>();
  const columns = arrangeWorkflowJobGraph(jobs).map((column, columnIndex) => {
    const nodes: WorkflowGraphNode[] = [];
    const skipped: GitHubWorkflowJob[] = [];
    for (const job of column) {
      if (!showSkipped && isSkippedWorkflowJob(job)) {
        skipped.push(job);
        continue;
      }
      const key = `job:${job.id}`;
      nodeKeyByJobId.set(job.id, key);
      nodes.push({ kind: 'job', key, job });
    }
    if (skipped.length > 0) {
      const key = `skipped:${columnIndex}`;
      for (const job of skipped) {
        nodeKeyByJobId.set(job.id, key);
      }
      nodes.push({ kind: 'skipped', key, jobs: skipped });
    }
    return nodes;
  });

  const edges: WorkflowGraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const [jobId, dependencyJobIds] of reduceWorkflowJobDependencies(jobs, !showSkipped)) {
    const target = nodeKeyByJobId.get(jobId);
    for (const dependencyJobId of dependencyJobIds) {
      const source = nodeKeyByJobId.get(dependencyJobId);
      const edgeKey = `${source}>${target}`;
      if (source === undefined || target === undefined || source === target || seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);
      edges.push({ source, target });
    }
  }

  return { columns, nodeKeyByJobId, edges };
}
