import { beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({ calls: [] as string[][], mergeError: undefined as string | undefined }));

vi.mock('./profiles', () => ({
  listProfiles: () => [{ id: 'work', ghConfigDir: '/gh', githubLogin: 'octocat' }],
  findGhExecutable: async () => 'gh'
}));

// Answers the two calls a merge makes: repository settings, then the merge itself.
vi.mock('node:child_process', () => ({
  execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    gh.calls.push(args);
    if (args.some((arg) => arg.endsWith('/merge'))) {
      if (gh.mergeError) callback(new Error('exit 1'), '', gh.mergeError);
      else callback(null, JSON.stringify({ merged: true, message: 'Pull Request successfully merged', sha: 'abc' }), '');
    } else {
      callback(null, JSON.stringify({ allow_merge_commit: true }), '');
    }
    return { stdin: { end: () => undefined } };
  }
}));

const { mergeGitHubPullRequest, PULL_REQUEST_HEAD_MOVED_MESSAGE } = await import('./github');

const input = { profileId: 'work', owner: 'o', repository: 'r', number: 5, method: 'merge' as const, headSha: 'a'.repeat(40) };

describe('mergeGitHubPullRequest', () => {
  beforeEach(() => {
    gh.calls = [];
    gh.mergeError = undefined;
  });

  it('binds the merge to the head the reviewer saw', async () => {
    await expect(mergeGitHubPullRequest(input)).resolves.toMatchObject({ merged: true });
    expect(gh.calls.at(-1)).toEqual(expect.arrayContaining([`sha=${'a'.repeat(40)}`, 'merge_method=merge']));
  });

  it('explains a merge GitHub rejected because the head moved', async () => {
    gh.mergeError = 'gh: Head branch was modified. Review and try the merge again. (HTTP 409)';
    await expect(mergeGitHubPullRequest(input)).rejects.toThrow(PULL_REQUEST_HEAD_MOVED_MESSAGE);
  });

  it('keeps other merge failures as GitHub reported them', async () => {
    gh.mergeError = 'gh: Pull Request is not mergeable (HTTP 405)';
    await expect(mergeGitHubPullRequest(input)).rejects.toThrow('not mergeable');
  });
});
