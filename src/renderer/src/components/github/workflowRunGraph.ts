import type { GitHubWorkflowJob } from '@shared/types';

const WORKFLOW_EDGE_CORNER_RADIUS = 8;

export function workflowGraphEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  if (sourceY === targetY) {
    return `M ${sourceX} ${sourceY} H ${targetX}`;
  }

  const middleX = sourceX + Math.max(24, (targetX - sourceX) / 2);
  const verticalDirection = Math.sign(targetY - sourceY);
  const radius = Math.min(
    WORKFLOW_EDGE_CORNER_RADIUS,
    Math.abs(targetY - sourceY) / 2,
    Math.max(0, middleX - sourceX)
  );

  return [
    `M ${sourceX} ${sourceY}`,
    `H ${middleX - radius}`,
    `Q ${middleX} ${sourceY} ${middleX} ${sourceY + verticalDirection * radius}`,
    `V ${targetY - verticalDirection * radius}`,
    `Q ${middleX} ${targetY} ${middleX + radius} ${targetY}`,
    `H ${targetX}`
  ].join(' ');
}

export function arrangeWorkflowJobGraph(
  jobs: GitHubWorkflowJob[]
): GitHubWorkflowJob[][] {
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

  const columns: GitHubWorkflowJob[][] = [];
  for (const job of jobs) {
    const depth = jobDepth(job.id);
    (columns[depth] ??= []).push(job);
  }

  return columns;
}

export function isSkippedWorkflowJob(job: GitHubWorkflowJob): boolean {
  return job.status === 'completed' && job.conclusion === 'skipped';
}

export type WorkflowGraphNode =
  | { kind: 'job'; key: string; job: GitHubWorkflowJob }
  | { kind: 'skipped'; key: string; jobs: GitHubWorkflowJob[] };

export type WorkflowGraphLayout = {
  columns: WorkflowGraphNode[][];
  /** Maps every job id to the key of the node that currently represents it. */
  nodeKeyByJobId: Map<number, string>;
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

  return { columns, nodeKeyByJobId };
}
