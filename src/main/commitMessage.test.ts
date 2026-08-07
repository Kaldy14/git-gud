import { describe, expect, it, vi } from 'vitest';

import type { GitCommandOptions, GitCommandResult, GitExecutor } from './git/exec';
import {
  buildCommitMessagePrompt,
  generateCommitMessage,
  normalizeCommitMessage
} from './commitMessage';

describe('AI commit messages', () => {
  it('builds a bounded staged-only prompt and normalizes fenced output', () => {
    const prompt = buildCommitMessagePrompt({
      stagedFiles: 'M\tsrc/app.ts',
      diff: 'diff --git a/src/app.ts b/src/app.ts\n+const ready = true;',
      diffTruncated: false,
      recentSubjects: 'Fix repository loading'
    });

    expect(prompt).toContain('Describe only the staged changes.');
    expect(prompt).toContain('M\tsrc/app.ts');
    expect(prompt).toContain('Fix repository loading');
    expect(normalizeCommitMessage('```text\nAdd staged change summary\n```')).toBe(
      'Add staged change summary'
    );
  });

  it('generates from the staged diff and recent repository style', async () => {
    const executor = fakeExecutor((args) => {
      if (args.includes('--name-status')) {
        return 'M\tsrc/app.ts\n';
      }
      if (args[0] === 'log') {
        return 'Polish commit details\n';
      }
      return 'diff --git a/src/app.ts b/src/app.ts\n+const ready = true;\n';
    });
    const generate = vi.fn(async () => 'Describe staged app change');

    await expect(
      generateCommitMessage(
        { path: '/repo', assignedProfileId: undefined },
        executor,
        generate
      )
    ).resolves.toBe('Describe staged app change');
    expect(generate).toHaveBeenCalledWith(
      '/repo',
      expect.stringContaining('diff --git a/src/app.ts b/src/app.ts')
    );
  });

  it('rejects when the index has no staged changes', async () => {
    const generate = vi.fn(async () => 'Should not run');

    await expect(
      generateCommitMessage(
        { path: '/repo', assignedProfileId: undefined },
        fakeExecutor(() => ''),
        generate
      )
    ).rejects.toThrow('You must have staged changes to generate a commit message.');
    expect(generate).not.toHaveBeenCalled();
  });
});

function fakeExecutor(stdout: (args: string[]) => string): Pick<GitExecutor, 'run'> {
  return {
    async run(args: string[], options: GitCommandOptions): Promise<GitCommandResult> {
      return {
        args,
        cwd: options.cwd,
        stdout: stdout(args),
        stderr: '',
        exitCode: 0
      };
    }
  };
}
