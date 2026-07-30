import type { ReviewBenchmarkCaseResult, ReviewBenchmarkReport } from './runtime';

export function formatReviewBenchmarkReport(report: ReviewBenchmarkReport): string {
  const lines = [
    '',
    'Review grouping quality benchmark',
    `Overall: ${percentage(report.score)} ${report.passed ? 'PASS' : 'FAIL'} · gate ${percentage(report.minimumScore)}`,
    `Coverage: ${report.datasets} datasets · ${report.runs} pipeline runs · ${Math.round(report.durationMs)} ms`,
    '',
    'Pipelines'
  ];

  for (const summary of report.pipelineSummaries) {
    lines.push(
      `  ${percentage(summary.score).padStart(7)}  ${summary.pipeline.padEnd(22)} ${summary.caseCount} cases`
    );
  }

  lines.push('', 'Cases');

  for (const result of report.cases) {
    const status = caseStatus(result);
    lines.push(
      `  ${status.padEnd(4)}  ${percentage(result.score).padStart(7)}  ${result.pipeline.padEnd(22)} ` +
      `${result.datasetId} (${Math.round(result.durationMs)} ms)`
    );

    if (result.error || result.score < 1) {
      lines.push(...formatFailure(result));
    }
  }

  return `${lines.join('\n')}\n`;
}

function caseStatus(result: ReviewBenchmarkCaseResult): 'PASS' | 'GAP' | 'FAIL' {
  if (
    result.error ||
    (result.minimumScore !== undefined && result.score < result.minimumScore)
  ) {
    return 'FAIL';
  }

  return result.score < 1 ? 'GAP' : 'PASS';
}

function formatFailure(result: ReviewBenchmarkCaseResult): string[] {
  if (result.error) {
    return [`        error: ${result.error}`];
  }

  const lines = [
    `        together F1 ${percentage(result.together.f1)} · apart F1 ${percentage(result.apart.f1)} · accuracy ${percentage(result.accuracy)}`
  ];

  if (result.wronglySplit.length) {
    lines.push(`        wrongly split: ${formatPairs(result.wronglySplit)}`);
  }

  if (result.wronglyMerged.length) {
    lines.push(`        wrongly merged: ${formatPairs(result.wronglyMerged)}`);
  }

  lines.push(
    `        expected: ${formatUnits(result.expectedUnits)}`,
    `        actual: ${formatUnits(result.actualUnits)}`
  );
  return lines;
}

function formatPairs(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.map(([left, right]) => `${left} ↔ ${right}`).join(', ');
}

function formatUnits(units: readonly { chunks: readonly string[] }[]): string {
  return units.map((unit) => `[${unit.chunks.join(', ')}]`).join(' ');
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
