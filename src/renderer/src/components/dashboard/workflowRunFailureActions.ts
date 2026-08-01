import type { GitHubWorkflowRun } from '@shared/types';

const CODEX_FAILED_LOG_LIMIT = 16_000;

type ClipboardWriter = Pick<Clipboard, 'writeText'>;

type WorkflowRunFailureContext = {
  owner: string;
  repository: string;
  run: GitHubWorkflowRun;
};

type SendWorkflowRunFailureToCodexOptions = {
  repoPath?: string;
  chooseRepositoryPath?: () => Promise<string | undefined>;
  loadFailedLog: () => Promise<string>;
  openCodexTask: (repoPath: string, prompt: string) => Promise<void>;
};

export async function copyWorkflowRunFailure(
  failedLog: string,
  clipboard: ClipboardWriter
): Promise<void> {
  await clipboard.writeText(failedLog);
}

export function buildWorkflowRunCodexPrompt(
  context: WorkflowRunFailureContext,
  failedLog: string
): string {
  const { owner, repository, run } = context;
  const log = truncateFailedLog(failedLog);
  const details = [
    `Repository: ${owner}/${repository}`,
    `Workflow: ${run.name}`,
    `Run: #${run.runNumber} — ${run.displayTitle}`,
    `URL: ${run.url}`,
    `Commit: ${run.sha}`,
    run.branch ? `Branch: ${run.branch}` : undefined,
    `Conclusion: ${run.conclusion ?? run.status}`
  ].filter((line): line is string => Boolean(line));

  return [
    'Investigate and fix this failed GitHub Actions run in the current repository.',
    'Confirm the failure against the code, make a focused fix, run the relevant checks locally, and summarize the cause and changes.',
    details.join('\n'),
    `Failed-step log:\n${log}`
  ].join('\n\n');
}

export async function sendWorkflowRunFailureToCodex(
  context: WorkflowRunFailureContext,
  options: SendWorkflowRunFailureToCodexOptions
): Promise<'opened' | 'cancelled'> {
  let repoPath = options.repoPath;

  if (!repoPath && options.chooseRepositoryPath) {
    repoPath = await options.chooseRepositoryPath();

    if (!repoPath) {
      return 'cancelled';
    }
  }

  if (!repoPath) {
    throw new Error(
      `Open the local checkout for ${context.owner}/${context.repository} to send this error to Codex.`
    );
  }

  const failedLog = await options.loadFailedLog();
  await options.openCodexTask(
    repoPath,
    buildWorkflowRunCodexPrompt(context, failedLog)
  );
  return 'opened';
}

function truncateFailedLog(failedLog: string): string {
  const normalized = failedLog.trim();

  if (normalized.length <= CODEX_FAILED_LOG_LIMIT) {
    return normalized;
  }

  return [
    '[Earlier failed-step log output omitted.]',
    normalized.slice(-CODEX_FAILED_LOG_LIMIT)
  ].join('\n');
}
