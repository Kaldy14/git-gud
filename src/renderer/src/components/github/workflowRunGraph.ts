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
